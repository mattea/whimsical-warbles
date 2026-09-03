#!/usr/bin/env python3
"""Bake Microduck motion for the Waddle Lab.

Developer-only. Drives Microduck's real 50 Hz control loop headlessly and emits
the artefacts the website ships. Run:

    uv run --no-project --with mujoco --with onnxruntime --with numpy \
        scripts/bake-duck-motion.py --microduck ../microduck \
        --microduck-rl ../microduck_rl

Nothing in the site build depends on this script or on those checkouts; its
outputs are committed.
"""

import argparse
import json
import math
import pathlib
import shutil

import mujoco
import numpy as np
import onnxruntime as ort

# Policy action order. The mouth (Microduck joint 9) is deliberately absent:
# no policy controls it, so it is not one of the 14 actions.
JOINT_NAMES = [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
    "neck_pitch", "head_pitch", "head_yaw", "head_roll",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
]

# From microduck/duck-control/src/model.rs DEFAULT_POSITION, mouth dropped.
HOME_POSE = np.array([
    0.0, -0.0873, -0.4579, -0.0049, 0.4530,
    0.3491, 0.3491, 0.0, 0.0,
    0.0, 0.0873, 0.4579, 0.0049, -0.4530,
])

CONTROL_DT = 0.02      # 50 Hz, robotd's rate
ACTION_SCALE = 0.9     # robotd/src/control.rs Tuning::default


def load_model(rl_root: pathlib.Path) -> mujoco.MjModel:
    xml = rl_root / "src/mjlab_microduck/robot/microduck/scene.xml"
    return mujoco.MjModel.from_xml_path(str(xml))


def bake_tree(model: mujoco.MjModel) -> dict:
    """Read the kinematic tree straight out of the compiled model.

    Extracted rather than transcribed: a wrong offset does not fail loudly, it
    produces a plausible robot that walks wrong.
    """
    qadr = {}
    for slot, name in enumerate(JOINT_NAMES):
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        assert jid >= 0, f"joint {name} not in model"
        qadr[model.jnt_bodyid[jid]] = slot

    bodies = []
    index_of = {}
    # Body 0 is the world; skip it. MuJoCo orders bodies parents-first.
    for bid in range(1, model.nbody):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, bid)
        parent = model.body_parentid[bid]
        index_of[bid] = len(bodies)
        bodies.append({
            "name": name,
            "parent": -1 if parent == 0 else index_of[parent],
            "pos": [float(v) for v in model.body_pos[bid]],
            "quat": [float(v) for v in model.body_quat[bid]],
            "jointIndex": qadr.get(bid, -1),
        })

    limits = []
    for name in JOINT_NAMES:
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        lo, hi = model.jnt_range[jid]
        limits.append([float(lo), float(hi)])

    return {
        "jointNames": JOINT_NAMES,
        "homePose": [float(v) for v in HOME_POSE],
        "jointLimits": limits,
        "bodies": bodies,
        "trunkHeight": float(model.body_pos[1][2]),
        "controlDt": CONTROL_DT,
        "actionScale": ACTION_SCALE,
    }


OBS_LEN = 61
GRAVITY_VEC = np.array([0.0, 0.0, -1.0])

# The gait grid, chosen from what the shipped walking policy ACTUALLY does
# rather than from the ranges it was trained over. Measured cold-start response
# of alpha_walking.onnx:
#
#   vx   below 0.25 the policy holds its stance and does not step at all;
#        0.25 -> 0.099 m/s, 0.40 -> 0.158 m/s, -0.40 -> -0.212 m/s
#   vyaw below ~1.5 nothing happens; +-1.5 -> +-0.7..0.9, +-2.0 -> +-1.0..1.1
#   vy   does not work in either direction (+0.3 gives exactly nothing, -0.3
#        gives 0.05 m/s of drift plus a yaw error), so strafing is not baked:
#        it is not a capability this policy has.
#
# Commanding anything inside the dead zone bakes a standing pose, which is what
# made an earlier grid slide around instead of walking.
GAIT_VX = [-0.4, 0.0, 0.25, 0.4]
GAIT_VYAW = [-2.0, 0.0, 2.0]

SETTLE_TICKS = 200   # 4 s at 50 Hz -- the gait needs a while to commit
PERIOD_WINDOW = 120  # ticks searched for the gait period
QUANT = 10000

# Ground pick: robotd/src/control.rs drives a rotating phase through the twist
# slots over a 4 s period and hands back at 0.7 of it.
GROUND_PICK_PERIOD = 4.0
GROUND_PICK_END_PHASE = 0.7

# Sitstand: the posture flag rides the twist vx slot, 1 = sit, 0 = stand.
SIT_TICKS = 120      # settle into the seat
RISE_TICKS = 100     # robotd gives the rise 1 s before handing back


def sense_of(data) -> tuple:
    """The four sensed blocks, read out of a MuJoCo state.

    Split out so the observation golden fixture records exactly the inputs the
    observation was built from, rather than a second computation of them that
    could drift.
    """
    rot = np.zeros(9)
    mujoco.mju_quat2Mat(rot, data.qpos[3:7])       # w, x, y, z
    rot = rot.reshape(3, 3)
    return (
        data.qvel[3:6].copy(),                     # angular velocity, trunk frame
        rot.T @ GRAVITY_VEC,                       # projected gravity
        data.qpos[7:21].copy(),                    # absolute joint angles
        data.qvel[6:20].copy(),
    )


def assemble_obs(gyro, gravity, joint_pos, joint_vel, prev_action, twist,
                 head=None, body=None) -> np.ndarray:
    """The 61-slot observation, laid out per microduck's duck-control/src/obs.rs.

    0..3 gyro | 3..6 projected gravity | 6..20 joint pos - home
    20..34 joint vel | 34..48 previous action | 48..61 command

    The command block is 48..51 twist, 51..55 head, 55..57 body x/y, then body
    z, roll, pitch and yaw one slot each. Body x, y and yaw are unbound in
    training, so they stay zero whatever the caller asks for -- all-zero is the
    nominal encoding there, not a placeholder. Note the body order is
    z, roll, pitch, which obs.rs flags as easy to get backwards.
    """
    obs = np.zeros(OBS_LEN, dtype=np.float32)
    obs[0:3] = gyro
    obs[3:6] = gravity
    obs[6:20] = np.asarray(joint_pos) - HOME_POSE
    obs[20:34] = joint_vel
    obs[34:48] = prev_action
    obs[48:51] = twist                             # vx, vy, vyaw (raw m/s, rad/s)
    if head is not None:
        obs[51:55] = head                          # neck_pitch, head_pitch, head_yaw, head_roll
    if body is not None:
        obs[57], obs[58], obs[59] = body           # z, roll, pitch
    return obs


def build_obs(data, prev_action, cmd) -> np.ndarray:
    """The observation for a live MuJoCo state and a velocity command.

    Head and body commands stay at their nominal zero: the bake drives
    locomotion and skills, neither of which moves the head independently.
    """
    return assemble_obs(*sense_of(data), prev_action, cmd)


def yaw_of(quat) -> float:
    w, x, y, z = (float(v) for v in quat)
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def tilt_of(quat) -> np.ndarray:
    """The trunk's orientation with its heading removed.

    Yaw is integrated in the browser from the achieved turn rate, so baking it
    too would double-count it. What is left -- the roll and pitch -- is
    intrinsic to the motion, and is the whole of what makes a roulade a roll
    rather than a shuffle.
    """
    w, x, y, z = (float(v) for v in quat)
    h = -yaw_of(quat) / 2.0
    cw, cz = math.cos(h), math.sin(h)
    return np.array([
        cw * w - cz * z,
        cw * x - cz * y,
        cw * y + cz * x,
        cw * z + cz * w,
    ])


class Recording:
    """Per-tick trunk and joint state from one policy run."""

    def __init__(self):
        self.joints = []
        self.pos = []
        self.yaw = []
        self.tilt = []

    def sample(self, data):
        self.joints.append(data.qpos[7:21].copy())
        self.pos.append([float(data.qpos[0]), float(data.qpos[1]), float(data.qpos[2])])
        self.yaw.append(yaw_of(data.qpos[3:7]))
        self.tilt.append(tilt_of(data.qpos[3:7]))

    def arrays(self):
        return (np.array(self.joints), np.array(self.pos),
                np.unwrap(np.array(self.yaw)), np.array(self.tilt))


def drive(model, session, cmd_at, ticks, action_scale=ACTION_SCALE, data=None,
          prev_action=None, record_from=0):
    """Run the real control loop for `ticks`, recording from `record_from`.

    `cmd_at(tick)` returns the 3-value twist for that tick, which is how the
    ground pick's rotating phase and the sitstand posture flag are expressed.
    """
    if data is None:
        data = mujoco.MjData(model)
        key = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
        mujoco.mj_resetDataKeyframe(model, data, key)
    if prev_action is None:
        prev_action = np.zeros(14, dtype=np.float32)

    rec = Recording()
    for tick in range(ticks):
        obs = build_obs(data, prev_action, cmd_at(tick))
        action = session.run(None, {"obs": obs.reshape(1, OBS_LEN)})[0][0]
        prev_action = action.astype(np.float32)
        data.ctrl[:] = HOME_POSE + action_scale * action

        for _ in range(10):                        # 0.002 s physics x10 = 0.02 s
            mujoco.mj_step(model, data)

        if tick >= record_from:
            rec.sample(data)

    return rec, data, prev_action


def gait_period(joints: np.ndarray) -> int:
    """Length of one gait cycle, in ticks, by autocorrelation on the legs.

    Capturing a whole number of cycles is what lets a clip loop without a
    visible hitch. A standing clip has no cycle, so it falls back to a fixed
    window -- every frame is the same anyway.
    """
    legs = joints[:, [2, 3, 4, 11, 12, 13]]
    legs = legs - legs.mean(axis=0)
    if np.abs(legs).max() < 0.01:
        return 30                                  # standing: no cycle to find

    best, best_score = 30, -1e9
    for lag in range(12, min(90, len(legs) // 2)):
        a = legs[:-lag]
        b = legs[lag:]
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        score = float((a * b).sum() / denom) if denom > 1e-9 else -1.0
        if score > best_score:
            best, best_score = lag, score
    return best


def achieved(rec: Recording, period: int) -> tuple:
    """Mean body-frame velocity over the captured window."""
    _, pos, yaw, _ = rec.arrays()
    span = period * CONTROL_DT
    dx = pos[period - 1][0] - pos[0][0]
    dy = pos[period - 1][1] - pos[0][1]
    y0 = yaw[0]
    vx = (dx * math.cos(y0) + dy * math.sin(y0)) / span
    vy = (-dx * math.sin(y0) + dy * math.cos(y0)) / span
    vyaw = (yaw[period - 1] - yaw[0]) / span
    return float(vx), float(vy), float(vyaw)


def quantize(values) -> list:
    q = np.round(np.asarray(values) * QUANT).astype(np.int32)
    assert np.abs(q).max() < 32768, "quantized value overflows int16"
    return [int(v) for v in q.ravel()]


def bake_clips(model, duck_root: pathlib.Path) -> dict:
    policies = duck_root / "policies"
    walk = ort.InferenceSession(str(policies / "alpha_walking.onnx"))

    gaits = []
    for vx in GAIT_VX:
        for vyaw in GAIT_VYAW:
            cmd = np.array([vx, 0.0, vyaw])
            rec, _, _ = drive(model, walk, lambda _t: cmd,
                              SETTLE_TICKS + PERIOD_WINDOW, record_from=SETTLE_TICKS)
            joints, pos, _, tilt = rec.arrays()
            period = gait_period(joints)
            vel = achieved(rec, period)
            z = pos[:period, 2]
            gaits.append({
                "cmd": [vx, 0.0, vyaw],
                "vel": [round(v, 5) for v in vel],
                "frames": period,
                "joints": quantize(joints[:period]),
                "rootDz": quantize(z - z.mean()),
                "tilt": quantize(tilt[:period]),
                "cycleTime": period * CONTROL_DT,
            })
            print(f"  gait vx={vx:+.2f} vyaw={vyaw:+.2f}: {period:>2} frames "
                  f"({period * CONTROL_DT:.2f}s)  achieved "
                  f"vx={vel[0]:+.3f} vy={vel[1]:+.3f} vyaw={vel[2]:+.3f}")

    skills = []

    def add_skill(name, rec, ticks, note=""):
        # Heading is deliberately not baked for skills. At the top of a roulade
        # the trunk passes through +-90 degrees of pitch, where yaw is
        # gimbal-locked and unwrapping it produces garbage -- and a forward roll
        # does not change which way the robot faces anyway.
        joints, pos, yaw, tilt = rec.arrays()
        # Path relative to the start, rotated into the starting heading, so the
        # browser can replay it under whatever heading the pugglenaut has.
        y0 = yaw[0]
        dx = pos[:, 0] - pos[0, 0]
        dy = pos[:, 1] - pos[0, 1]
        path = np.stack([
            dx * math.cos(y0) + dy * math.sin(y0),
            -dx * math.sin(y0) + dy * math.cos(y0),
            pos[:, 2] - pos[0, 2],
        ], axis=1)
        skills.append({
            "name": name,
            "frames": len(joints),
            "joints": quantize(joints),
            "rootPath": quantize(path),
            "tilt": quantize(tilt),
            "duration": len(joints) * CONTROL_DT,
        })
        print(f"  skill {name}: {len(joints)} frames "
              f"({len(joints) * CONTROL_DT:.2f}s) travel={path[-1][0]:+.3f}m {note}")

    # Kicks and the roulade take an all-zero command: being selected is the
    # trigger (robotd/src/control.rs).
    zero = np.zeros(3)
    for name, filename, ticks in [
        ("kick_left", "ball_kick_left.onnx", 150),
        ("kick_right", "ball_kick_right.onnx", 150),
        ("roulade", "roulade.onnx", 150),
    ]:
        sess = ort.InferenceSession(str(policies / filename))
        rec, _, _ = drive(model, sess, lambda _t: zero, ticks, action_scale=1.0)
        add_skill(name, rec, ticks)

    # Ground pick: a rotating phase through the twist slots, truncated at 0.7 of
    # its period, exactly as robotd does it. An all-zero command here is what
    # made the earlier clip crouch and never come back up.
    gp = ort.InferenceSession(str(policies / "alpha_ground_pick.onnx"))
    gp_ticks = int(round(GROUND_PICK_END_PHASE * GROUND_PICK_PERIOD / CONTROL_DT))

    def gp_cmd(tick):
        angle = 2.0 * math.pi * (tick * CONTROL_DT / GROUND_PICK_PERIOD)
        return np.array([math.cos(angle), math.sin(angle), 0.0])

    rec, _, _ = drive(model, gp, gp_cmd, gp_ticks, action_scale=1.0)
    add_skill("ground_pick", rec, gp_ticks, "(phase-encoded)")

    # Sit and stand are one policy driven by a posture flag in the vx slot:
    # 1 sits, 0 rises. The rise has to start from a seated robot, so it is baked
    # as a continuation of the sit rather than from the standing keyframe.
    sitstand = ort.InferenceSession(str(policies / "alpha_sitstand.onnx"))
    sit_cmd = np.array([1.0, 0.0, 0.0])
    sit_rec, seated, seated_action = drive(
        model, sitstand, lambda _t: sit_cmd, SIT_TICKS, action_scale=1.0
    )
    add_skill("sit", sit_rec, SIT_TICKS, "(posture flag 1)")

    rise_rec, _, _ = drive(
        model, sitstand, lambda _t: zero, RISE_TICKS, action_scale=1.0,
        data=seated, prev_action=seated_action,
    )
    add_skill("stand", rise_rec, RISE_TICKS, "(posture flag 0, from the seat)")

    return {"quantScale": QUANT, "gaits": gaits, "skills": skills}


def bake_fk_golden(model: mujoco.MjModel, n: int = 24) -> dict:
    """MuJoCo's own body transforms for random joint poses.

    The trunk freejoint is pinned to the identity pose so the fixture isolates
    articulation from root placement -- the TS side composes the root itself.
    """
    data = mujoco.MjData(model)
    rng = np.random.default_rng(20260902)
    limits = model.jnt_range[[
        mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, n_) for n_ in JOINT_NAMES
    ]]

    cases = []
    for case in range(n):
        if case == 0:
            joints = np.zeros(14)          # all-zero
        elif case == 1:
            joints = HOME_POSE.copy()      # the pose everything is relative to
        else:
            joints = rng.uniform(limits[:, 0], limits[:, 1])

        data.qpos[:] = 0.0
        data.qpos[3] = 1.0                 # identity quaternion, w first
        data.qpos[7:21] = joints
        mujoco.mj_kinematics(model, data)

        cases.append({
            "joints": [float(v) for v in joints],
            "xpos": [[float(v) for v in data.xpos[b]] for b in range(1, model.nbody)],
            "xquat": [[float(v) for v in data.xquat[b]] for b in range(1, model.nbody)],
        })
    return {"cases": cases}


# Body pose command values for the observation golden. Upstream leaves body z,
# roll and pitch unbound -- obs.rs calls them "not commandable in slice 2",
# carried so the layout is complete -- so there is no upstream range to draw
# from. These are arbitrary nonzero values, whose only job is to pin slots
# 57..59 and prove the block is ordered z, roll, pitch rather than z, pitch,
# roll. Nothing physical depends on them.
GOLDEN_BODY = [
    (0.0, 0.0, 0.0),
    (-0.02, 0.1, -0.15),
    (0.03, -0.2, 0.25),
    (0.01, 0.05, 0.4),
]


def bake_obs_golden(model: mujoco.MjModel, duck_root: pathlib.Path,
                    n: int = 20) -> dict:
    """Observation inputs and the resulting 61 floats, for the TS side to match.

    The point of this fixture is offsets, not physics: obs.rs warns that a
    misplaced block does not fail loudly, it produces a plausible robot that
    falls over. So the recorded inputs are deliberately all distinct, and the
    cases include the home pose, whose joint position block is fourteen exact
    zeroes, and an all-zero input, whose joint position block is exactly minus
    the home pose -- between them those pin the sign and the offset of the one
    block that is not copied through verbatim.

    The rest are real states. Half are random joint poses within the model's own
    `jnt_range` at a random trunk attitude, as bake_fk_golden does; half are
    snapshots of the walking policy actually walking, which is the only way to
    get a previous action, a gyro and a projected gravity that belong together.
    """
    rng = np.random.default_rng(20260903)
    joint_ids = [
        mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        for name in JOINT_NAMES
    ]
    limits = model.jnt_range[joint_ids]
    # The head command is a joint target, so the head joints' own limits are the
    # range it can meaningfully take.
    head_limits = model.jnt_range[joint_ids[5:9]]

    twists = [np.array([vx, 0.0, vyaw]) for vx in GAIT_VX for vyaw in GAIT_VYAW]

    # Walk first: the rollout supplies both the in-distribution snapshots and
    # the velocity scale the random cases are drawn from, so no joint velocity
    # bound has to be invented here.
    walk = ort.InferenceSession(str(duck_root / "policies/alpha_walking.onnx"))
    snapshots = []
    data = mujoco.MjData(model)
    key = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
    mujoco.mj_resetDataKeyframe(model, data, key)
    prev_action = np.zeros(14, dtype=np.float32)
    for tick in range(SETTLE_TICKS + 60):
        twist = twists[(tick // 40) % len(twists)]
        obs = build_obs(data, prev_action, twist)
        action = walk.run(None, {"obs": obs.reshape(1, OBS_LEN)})[0][0]
        # Snapshot before the step, so the sensed state and the previous action
        # are the pair the policy was handed on this tick.
        if tick >= SETTLE_TICKS and tick % 6 == 0:
            snapshots.append((sense_of(data), prev_action.copy(), twist))
        prev_action = action.astype(np.float32)
        data.ctrl[:] = HOME_POSE + ACTION_SCALE * action
        for _ in range(10):
            mujoco.mj_step(model, data)
    vel_scale = float(np.abs([s[0][3] for s in snapshots]).max())

    cases = []
    for case in range(n):
        if case == 0:
            # Every input zero. Not a valid robot state -- gravity has no
            # magnitude -- but a useful one, because the joint position block
            # then comes out as exactly minus the home pose, which is what
            # catches the subtraction being done the wrong way round.
            sense = (np.zeros(3), np.zeros(3), np.zeros(14), np.zeros(14))
            prev, twist, head, body = np.zeros(14), np.zeros(3), np.zeros(4), GOLDEN_BODY[0]
        elif case == 1:
            # The home pose, upright, at rest. Joint positions must read as
            # exactly fourteen zeroes -- they are observed relative to this.
            data.qpos[:] = 0.0
            data.qpos[3] = 1.0                     # identity quaternion, w first
            data.qpos[7:21] = HOME_POSE
            data.qvel[:] = 0.0
            mujoco.mj_kinematics(model, data)
            sense = sense_of(data)
            prev, twist, head, body = np.zeros(14), np.zeros(3), np.zeros(4), GOLDEN_BODY[0]
        elif case < 2 + (n - 2) // 2:
            # A random attitude, so projected gravity is a genuine unit vector
            # rather than three loose numbers. Normalising a Gaussian is the
            # standard way to sample orientations uniformly.
            quat = rng.normal(size=4)
            quat /= np.linalg.norm(quat)
            rot = np.zeros(9)
            mujoco.mju_quat2Mat(rot, quat)
            sense = (
                rng.uniform(-vel_scale, vel_scale, 3),
                rot.reshape(3, 3).T @ GRAVITY_VEC,
                rng.uniform(limits[:, 0], limits[:, 1]),
                rng.uniform(-vel_scale, vel_scale, 14),
            )
            prev = rng.uniform(-1.0, 1.0, 14)      # a policy output is bounded
            twist = twists[case % len(twists)]
            head = rng.uniform(head_limits[:, 0], head_limits[:, 1])
            body = GOLDEN_BODY[case % len(GOLDEN_BODY)]
        else:
            sense, prev, twist = snapshots[case % len(snapshots)]
            head = rng.uniform(head_limits[:, 0], head_limits[:, 1])
            body = GOLDEN_BODY[case % len(GOLDEN_BODY)]

        gyro, gravity, joint_pos, joint_vel = sense
        obs = assemble_obs(gyro, gravity, joint_pos, joint_vel, prev, twist,
                           head=head, body=body)
        cases.append({
            "gyro": [float(v) for v in gyro],
            "gravity": [float(v) for v in gravity],
            "jointPos": [float(v) for v in joint_pos],
            "jointVel": [float(v) for v in joint_vel],
            "prevAction": [float(v) for v in prev],
            "twist": [float(v) for v in twist],
            "head": [float(v) for v in head],
            "body": [float(v) for v in body],
            "obs": [float(v) for v in obs],
        })

    return {"homePose": [float(v) for v in HOME_POSE], "cases": cases}


def bake_policy_golden(duck_root: pathlib.Path, obs_golden: dict,
                       n: int = 8) -> dict:
    """What alpha_walking.onnx answers to a handful of the golden observations.

    Reuses the observation fixture's own vectors so the two tests chain: if the
    TS builder reproduces the observation and onnxruntime-web reproduces the
    action, the whole path from robot state to joint target is pinned against
    Python.

    Only the walking policy, and only a few cases: this is a check that the
    browser runtime agrees with the desktop one, not a survey of the policies.
    """
    name = "alpha_walking.onnx"
    path = duck_root / "policies" / name
    session = ort.InferenceSession(str(path))

    cases = obs_golden["cases"]
    step = max(1, len(cases) // n)
    picked = cases[::step][:n]

    out = []
    for kase in picked:
        obs = np.array(kase["obs"], dtype=np.float32).reshape(1, OBS_LEN)
        action = session.run(None, {"obs": obs})[0][0]
        out.append({
            "obs": kase["obs"],
            "action": [float(v) for v in action],
        })

    return {"policy": name, "bytes": path.stat().st_size, "cases": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--microduck", type=pathlib.Path, required=True)
    ap.add_argument("--microduck-rl", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("public/duck"))
    ap.add_argument("--fixtures", type=pathlib.Path, default=pathlib.Path("src/lib/duck"))
    args = ap.parse_args()

    model = load_model(args.microduck_rl)
    args.out.mkdir(parents=True, exist_ok=True)

    tree = bake_tree(model)
    (args.out / "tree.json").write_text(json.dumps(tree, indent=1))
    print(f"tree.json: {len(tree['bodies'])} bodies, {len(tree['jointNames'])} joints")

    args.fixtures.mkdir(parents=True, exist_ok=True)
    golden = bake_fk_golden(model)
    (args.fixtures / "fk-golden.json").write_text(json.dumps(golden))
    print(f"fk-golden.json: {len(golden['cases'])} cases")

    obs_golden = bake_obs_golden(model, args.microduck)
    (args.fixtures / "obs-golden.json").write_text(json.dumps(obs_golden))
    print(f"obs-golden.json: {len(obs_golden['cases'])} cases")

    policy_golden = bake_policy_golden(args.microduck, obs_golden)
    (args.fixtures / "policy-golden.json").write_text(json.dumps(policy_golden))
    print(f"policy-golden.json: {len(policy_golden['cases'])} cases "
          f"of {policy_golden['policy']}")

    # The policy itself, beside its fixture. onnxruntime-web has to be handed the
    # real graph for the golden test to mean anything, and a test that depends on
    # a checkout of microduck being present is a test that stops being run.
    shutil.copyfile(args.microduck / "policies" / policy_golden["policy"],
                    args.fixtures / policy_golden["policy"])
    print(f"{policy_golden['policy']}: {policy_golden['bytes'] / 1024:.0f} KB")

    clips = bake_clips(model, args.microduck)
    path = args.out / "clips.json"
    path.write_text(json.dumps(clips, separators=(",", ":")))
    print(f"clips.json: {len(clips['gaits'])} gaits, {len(clips['skills'])} skills, "
          f"{path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
