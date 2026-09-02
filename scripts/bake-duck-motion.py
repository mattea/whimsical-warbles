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

# The gait grid. Ranges chosen inside what the walking policy was trained on.
GAIT_VX = [-0.15, 0.0, 0.15, 0.3]
GAIT_VY = [-0.1, 0.0, 0.1]
GAIT_VYAW = [-1.0, 0.0, 1.0]

SETTLE_TICKS = 150   # 3 s at 50 Hz -- let the gait reach steady state
CAPTURE_TICKS = 30   # ~one gait cycle
QUANT = 10000


def build_obs(data, prev_action, cmd) -> np.ndarray:
    """The 61-slot observation, laid out per microduck's duck-control/src/obs.rs.

    0..3 gyro | 3..6 projected gravity | 6..20 joint pos - home
    20..34 joint vel | 34..48 previous action | 48..61 command
    """
    obs = np.zeros(OBS_LEN, dtype=np.float32)
    rot = np.zeros(9)
    mujoco.mju_quat2Mat(rot, data.qpos[3:7])       # w, x, y, z
    rot = rot.reshape(3, 3)

    obs[0:3] = data.qvel[3:6]                      # angular velocity, trunk frame
    obs[3:6] = rot.T @ GRAVITY_VEC                 # projected gravity
    obs[6:20] = data.qpos[7:21] - HOME_POSE
    obs[20:34] = data.qvel[6:20]
    obs[34:48] = prev_action
    obs[48:51] = cmd                               # vx, vy, vyaw
    # 51..55 head, 55..61 body pose: all-zero is the nominal command, per obs.rs.
    return obs


def tilt_of(quat) -> np.ndarray:
    """The trunk's orientation with its heading removed.

    Yaw is integrated in the browser from the command being held, so baking it
    too would double-count it. What is left -- the roll and pitch -- is
    intrinsic to the motion, and is the whole of what makes a roulade a roll
    rather than a shuffle.
    """
    w, x, y, z = (float(v) for v in quat)
    yaw = math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    h = -yaw / 2.0
    cw, cz = math.cos(h), math.sin(h)
    # Rz(-yaw) * quat
    return np.array([
        cw * w - cz * z,
        cw * x - cz * y,
        cw * y + cz * x,
        cw * z + cz * w,
    ])


def run_policy(model, session, cmd, settle, capture, action_scale=ACTION_SCALE):
    """Drive the real control loop and record `capture` ticks after settling."""
    data = mujoco.MjData(model)
    key = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
    mujoco.mj_resetDataKeyframe(model, data, key)

    prev_action = np.zeros(14, dtype=np.float32)
    joints, root_z, tilt = [], [], []

    for tick in range(settle + capture):
        obs = build_obs(data, prev_action, cmd)
        action = session.run(None, {"obs": obs.reshape(1, OBS_LEN)})[0][0]
        prev_action = action.astype(np.float32)
        data.ctrl[:] = HOME_POSE + action_scale * action

        for _ in range(10):                        # 0.002 s physics x10 = 0.02 s
            mujoco.mj_step(model, data)

        if tick >= settle:
            joints.append(data.qpos[7:21].copy())
            root_z.append(float(data.qpos[2]))
            tilt.append(tilt_of(data.qpos[3:7]))

    return np.array(joints), np.array(root_z), np.array(tilt)


def quantize(values) -> list:
    q = np.round(np.asarray(values) * QUANT).astype(np.int32)
    assert np.abs(q).max() < 32768, "quantized value overflows int16"
    return [int(v) for v in q.ravel()]


def bake_clips(model, duck_root: pathlib.Path) -> dict:
    policies = duck_root / "policies"
    walk = ort.InferenceSession(str(policies / "alpha_walking.onnx"))

    gaits = []
    for vx in GAIT_VX:
        for vy in GAIT_VY:
            for vyaw in GAIT_VYAW:
                cmd = np.array([vx, vy, vyaw])
                joints, root_z, tilt = run_policy(
                    model, walk, cmd, SETTLE_TICKS, CAPTURE_TICKS
                )
                gaits.append({
                    "cmd": [vx, vy, vyaw],
                    "frames": len(joints),
                    "joints": quantize(joints),
                    "rootDz": quantize(root_z - root_z.mean()),
                    "tilt": quantize(tilt),
                    "cycleTime": len(joints) * CONTROL_DT,
                })
                print(f"  gait {vx:+.2f} {vy:+.2f} {vyaw:+.2f}: "
                      f"{len(joints)} frames, z={root_z.mean():.3f}")

    # Skills: one-shots from the standing pose with a zero command. Standing
    # tuning is action_scale 1.0 (robotd/src/control.rs).
    skill_specs = [
        ("kick_left", "ball_kick_left.onnx", 150),
        ("kick_right", "ball_kick_right.onnx", 150),
        ("roulade", "roulade.onnx", 150),
        ("ground_pick", "alpha_ground_pick.onnx", 150),
        ("sit", "alpha_sitstand.onnx", 100),
        ("stand", "alpha_stand.onnx", 100),
    ]
    skills = []
    for name, filename, ticks in skill_specs:
        session = ort.InferenceSession(str(policies / filename))
        joints, root_z, tilt = run_policy(
            model, session, np.zeros(3), settle=0, capture=ticks, action_scale=1.0
        )
        skills.append({
            "name": name,
            "frames": len(joints),
            "joints": quantize(joints),
            "rootDz": quantize(root_z - root_z[0]),
            "tilt": quantize(tilt),
            "duration": len(joints) * CONTROL_DT,
        })
        print(f"  skill {name}: {len(joints)} frames, z={root_z.mean():.3f}")

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

    clips = bake_clips(model, args.microduck)
    path = args.out / "clips.json"
    path.write_text(json.dumps(clips, separators=(",", ":")))
    print(f"clips.json: {len(clips['gaits'])} gaits, {len(clips['skills'])} skills, "
          f"{path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
