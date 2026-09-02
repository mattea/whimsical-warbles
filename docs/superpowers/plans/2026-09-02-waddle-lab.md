# Waddle Lab Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/lab` — a teleop console where the site's pugglenaut mascot walks, turns, kicks, rolls and sits using the real gait of Pollen Robotics' Microduck, replayed from baked trajectories.

**Architecture:** An offline Python bake drives Microduck's own 50 Hz control loop (MuJoCo + the shipped ONNX policies) and emits three small artefacts: the kinematic tree, motion clips, and an FK golden file. The browser loads them behind a `DuckLink` interface, blends clips phase-locked from the live command, and drives a procedural Three.js pugglenaut rig. Nothing in the browser knows the motion is a recording, so later phases swap the backend and keep the console.

**Tech Stack:** Astro 5 + React 18 islands, `three` (new), `vitest` (new), Python via `uv run --no-project --with mujoco --with onnxruntime --with numpy`.

**Spec:** `docs/superpowers/specs/2026-09-02-waddle-lab-design.md`

## Global Constraints

- **Upstream clones are developer-only.** `/home/mattea/projects/microduck` and `/home/mattea/projects/microduck_rl` are read by the bake script only. The site build must never reference them. Bake outputs are committed.
- **Bone lengths are copied, never invented.** All link offsets, quaternions, joint limits and the home pose are emitted programmatically by the bake from `robot_walk.xml`. Never hand-transcribe them.
- **All joint axes are local Z** (`axis="0 0 1"`); onshape-to-robot bakes orientation into each body's `quat`. FK must apply the body quaternion then rotate about local Z.
- **14 joints, in policy action order:** left leg (hip_yaw, hip_roll, hip_pitch, knee, ankle) 0-4; neck_pitch, head_pitch, head_yaw, head_roll 5-8; right leg 9-13. The mouth is *not* one of these.
- **Control rate is exactly 50 Hz** (0.02 s). MuJoCo physics is 0.002 s, so one control tick is 10 physics steps.
- **`action_scale = 0.9`** walking, **`1.0`** standing. `targets = home_pose + action_scale * action`.
- **Units are metres and radians** throughout, matching the MJCF. The pugglenaut is ~0.25 m tall.
- **Nothing animated runs by default.** `/lab` is inert until the user presses a power control, and honours `prefers-reduced-motion`.
- **Mascot palette** (from `public/favicon.svg`, `src/components/BoopMascot.tsx`): body `#cbb27a`, body stroke `#8f7a45`, bill `#3a3140`, helmet fill `rgba(255,255,255,0.16)`, helmet rim `rgba(255,255,255,0.85)`, eye `#20202a`, catchlight `#f7f4ea`, flame `#ffcf33`.
- **Node lives at `~/.local/node/bin`.** Prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"` if `node` is not found.

## File Structure

| file | responsibility |
| --- | --- |
| `scripts/bake-duck-motion.py` | create (Task 2-4) — offline bake: tree, clips, FK golden |
| `public/duck/tree.json` | generated — link offsets/quats, joint limits, home pose |
| `public/duck/clips.json` | generated — gait grid + skill one-shots, int16-quantized |
| `src/lib/duck/fk-golden.json` | generated — MuJoCo body transforms for random poses (test fixture) |
| `src/lib/duck/tree.ts` | create (Task 5) — typed loader + constants for `tree.json` |
| `src/lib/duck/fk.ts` | create (Task 5) — forward kinematics, 14 angles -> 15 body transforms |
| `src/lib/duck/clips.ts` | create (Task 6) — clip decode + phase-locked blend (pure) |
| `src/lib/duck/link.ts` | create (Task 7) — the `DuckLink` / `DuckState` contract |
| `src/lib/duck/clipLink.ts` | create (Task 7) — `ClipLink`: 50 Hz loop, root integration, skills |
| `src/lib/duck/pugglenaut.ts` | create (Task 8) — procedural Three.js rig + `apply()` |
| `src/components/LabScene.tsx` | create (Task 9) — camera, floor, lights, render loop |
| `src/components/LabConsole.tsx` | create (Task 10) — input, HUD, telemetry; owns the island |
| `src/styles/lab.css` | create (Task 10) — console chrome |
| `src/pages/lab.astro` | create (Task 11) — the page |
| `src/components/StarMap.astro` | modify (Task 11) — add the `/lab` node |
| `src/pages/game.astro` | modify (Task 11) — cross-link |
| `README.md` | modify (Task 11) — document `/lab` and the bake |
| `package.json` | modify (Task 1) — add `three`, `vitest`, `test` script |
| `vitest.config.ts` | create (Task 1) |

---

### Task 1: Test harness and dependencies

Nothing in this repo has ever been unit-tested — there is no test runner and no `test` script. Everything downstream depends on one existing, so this comes first.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Test: `src/lib/duck/smoke.test.ts` (deleted in Task 5, it only proves the runner works)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs vitest over `src/**/*.test.ts`. `three` and `@types/three` importable.

- [ ] **Step 1: Install the dependencies**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install --save three@^0.185.1
npm install --save-dev vitest@^3.2.4 @types/three@^0.185.0
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `src/lib/duck/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: PASS, 1 test.

- [ ] **Step 6: Confirm the site still builds**

```bash
npm run build
```

Expected: exit 0. Adding `three` must not break the existing zero-JS pages.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/duck/smoke.test.ts
git commit -m "Add vitest harness and three.js dependency"
```

---

### Task 2: Bake the kinematic tree

**Files:**
- Create: `scripts/bake-duck-motion.py`
- Create (generated): `public/duck/tree.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `public/duck/tree.json` with this exact shape — Task 5 parses it:

```json
{
  "jointNames": ["left_hip_yaw", "...14 total, policy action order"],
  "homePose": [14 floats, radians],
  "jointLimits": [[lo, hi], "...14 pairs"],
  "bodies": [
    {
      "name": "trunk_base",
      "parent": -1,
      "pos": [0, 0, 0.12],
      "quat": [1, 0, 0, 0],
      "jointIndex": -1
    }
  ],
  "trunkHeight": 0.12,
  "controlDt": 0.02,
  "actionScale": 0.9
}
```

`quat` is `[w, x, y, z]`, MuJoCo's order. `parent` indexes into `bodies`. `jointIndex` is the 0-13 policy slot, or `-1` for the trunk. `bodies` is ordered parents-before-children so FK is a single forward pass.

- [ ] **Step 1: Write the tree extraction**

Create `scripts/bake-duck-motion.py`:

```python
#!/usr/bin/env python3
"""Bake Microduck motion for the Waddle Lab.

Developer-only. Drives Microduck's real 50 Hz control loop headlessly and emits
the artefacts the website ships. Run:

    uv run --no-project --with mujoco --with onnxruntime --with numpy \
        scripts/bake-duck-motion.py --microduck ../../microduck \
        --microduck-rl ../../microduck_rl

Nothing in the site build depends on this script or on those checkouts; its
outputs are committed.
"""

import argparse
import json
import pathlib

import mujoco
import numpy as np

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


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
uv run --no-project --with mujoco --with onnxruntime --with numpy \
    scripts/bake-duck-motion.py \
    --microduck /home/mattea/projects/microduck \
    --microduck-rl /home/mattea/projects/microduck_rl
```

Expected: `tree.json: 15 bodies, 14 joints`.

- [ ] **Step 3: Verify the output by eye**

```bash
python3 -c "
import json; t=json.load(open('public/duck/tree.json'))
for b in t['bodies']: print(b['jointIndex'], b['name'], b['pos'])
print('trunkHeight', t['trunkHeight'])
"
```

Expected: `jointIndex -1` for `trunk_base`, and slots 0-13 each appearing exactly once. `trunkHeight` is `0.12`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bake-duck-motion.py public/duck/tree.json
git commit -m "Bake the Microduck kinematic tree from its MJCF"
```

---

### Task 3: Bake the FK golden fixture

Forward kinematics is where joint-order and sign errors hide. This fixture makes the TypeScript FK provably identical to MuJoCo's, which is a far stronger check than asserting a foot rests on the floor.

**Files:**
- Modify: `scripts/bake-duck-motion.py`
- Create (generated): `src/lib/duck/fk-golden.json`

**Interfaces:**
- Consumes: `bake_tree` from Task 2.
- Produces: `src/lib/duck/fk-golden.json`, consumed by Task 5's test:

```json
{
  "cases": [
    {
      "joints": [14 floats],
      "xpos": [[x, y, z], "...15, world, trunk freejoint at identity"],
      "xquat": [[w, x, y, z], "...15"]
    }
  ]
}
```

- [ ] **Step 1: Add the golden generator**

Insert before `main()` in `scripts/bake-duck-motion.py`:

```python
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
```

- [ ] **Step 2: Wire it into `main()`**

After the `tree.json` write in `main()`, add:

```python
    args.fixtures.mkdir(parents=True, exist_ok=True)
    golden = bake_fk_golden(model)
    (args.fixtures / "fk-golden.json").write_text(json.dumps(golden))
    print(f"fk-golden.json: {len(golden['cases'])} cases")
```

- [ ] **Step 3: Run it**

```bash
uv run --no-project --with mujoco --with onnxruntime --with numpy \
    scripts/bake-duck-motion.py \
    --microduck /home/mattea/projects/microduck \
    --microduck-rl /home/mattea/projects/microduck_rl
```

Expected: `fk-golden.json: 24 cases`.

- [ ] **Step 4: Sanity-check case 1 is the home pose**

```bash
python3 -c "
import json; g=json.load(open('src/lib/duck/fk-golden.json'))
c=g['cases'][1]
print('joints[0:5]', [round(v,4) for v in c['joints'][:5]])
print('trunk xpos', c['xpos'][0]); print('cases', len(g['cases']))
"
```

Expected: `joints[0:5]` is `[0.0, -0.0873, -0.4579, -0.0049, 0.453]`; `trunk xpos` is `[0, 0, 0.12]`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-duck-motion.py src/lib/duck/fk-golden.json
git commit -m "Bake an FK golden fixture from MuJoCo"
```

---

### Task 4: Bake the motion clips

**Files:**
- Modify: `scripts/bake-duck-motion.py`
- Create (generated): `public/duck/clips.json`

**Interfaces:**
- Consumes: `load_model` from Task 2.
- Produces: `public/duck/clips.json`, consumed by Task 6:

```json
{
  "quantScale": 10000,
  "gaits": [
    {
      "cmd": [vx, vy, vyaw],
      "frames": 30,
      "joints": [int16, "...frames*14, row-major per frame"],
      "rootDz": [int16, "...frames, trunk height minus its mean, metres"],
      "cycleTime": 0.6
    }
  ],
  "skills": [
    {
      "name": "kick_left",
      "frames": 150,
      "joints": [int16, "...frames*14"],
      "rootDz": [int16, "...frames"],
      "duration": 3.0
    }
  ]
}
```

Joint angles are stored as `round(radians * quantScale)`, so `int16` covers +-3.27 rad — wider than every joint limit. Absolute angles, not offsets from home. `rootDz` is vertical bob only; horizontal travel is integrated in the browser from the live command, so a clip does not bake in a direction.

- [ ] **Step 1: Add the control loop and clip capture**

Insert before `main()`:

```python
import onnxruntime as ort

# microduck/duck-control/src/obs.rs documents these indices exactly.
OBS_LEN = 61
GRAVITY_VEC = np.array([0.0, 0.0, -1.0])

# The gait grid. Ranges chosen inside what the walking policy was trained on.
GAIT_VX = [-0.15, 0.0, 0.15, 0.3]
GAIT_VY = [-0.1, 0.0, 0.1]
GAIT_VYAW = [-1.0, 0.0, 1.0]

SETTLE_TICKS = 150   # 3 s at 50 Hz -- let the gait reach steady state
CAPTURE_TICKS = 30   # ~one gait cycle
QUANT = 10000


def build_obs(data, model, prev_action, cmd) -> np.ndarray:
    """The 61-slot observation, laid out per obs.rs.

    0..3 gyro | 3..6 projected gravity | 6..20 joint pos - home
    20..34 joint vel | 34..48 previous action | 48..61 command
    """
    obs = np.zeros(OBS_LEN, dtype=np.float32)
    quat = data.qpos[3:7]                      # w, x, y, z
    rot = np.zeros(9)
    mujoco.mju_quat2Mat(rot, quat)
    rot = rot.reshape(3, 3)

    obs[0:3] = data.qvel[3:6]                  # angular velocity, trunk frame
    obs[3:6] = rot.T @ GRAVITY_VEC             # projected gravity
    obs[6:20] = data.qpos[7:21] - HOME_POSE
    obs[20:34] = data.qvel[6:20]
    obs[34:48] = prev_action
    obs[48:51] = cmd                           # vx, vy, vyaw
    # 51..55 head, 55..61 body pose: zero is the nominal command, per obs.rs.
    return obs


def run_policy(model, session, cmd, settle, capture, action_scale=ACTION_SCALE):
    """Drive the real control loop and record `capture` ticks after settling."""
    data = mujoco.MjData(model)
    key = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
    mujoco.mj_resetDataKeyframe(model, data, key)

    prev_action = np.zeros(14, dtype=np.float32)
    joints, root_z = [], []

    for tick in range(settle + capture):
        obs = build_obs(data, model, prev_action, cmd)
        action = session.run(None, {"obs": obs.reshape(1, OBS_LEN)})[0][0]
        prev_action = action.astype(np.float32)
        data.ctrl[:] = HOME_POSE + action_scale * action

        for _ in range(10):                    # 0.002 s physics x10 = 0.02 s
            mujoco.mj_step(model, data)

        if tick >= settle:
            joints.append(data.qpos[7:21].copy())
            root_z.append(float(data.qpos[2]))

    return np.array(joints), np.array(root_z)


def quantize(values: np.ndarray) -> list[int]:
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
                joints, root_z = run_policy(model, walk, cmd, SETTLE_TICKS, CAPTURE_TICKS)
                gaits.append({
                    "cmd": [vx, vy, vyaw],
                    "frames": len(joints),
                    "joints": quantize(joints),
                    "rootDz": quantize(root_z - root_z.mean()),
                    "cycleTime": len(joints) * CONTROL_DT,
                })
                print(f"  gait {vx:+.2f} {vy:+.2f} {vyaw:+.2f}: {len(joints)} frames")

    # Skills: one-shots, captured from the standing pose with a zero command.
    # Standing tuning is action_scale 1.0 (robotd/src/control.rs).
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
        joints, root_z = run_policy(
            model, session, np.zeros(3), settle=0, capture=ticks, action_scale=1.0
        )
        skills.append({
            "name": name,
            "frames": len(joints),
            "joints": quantize(joints),
            "rootDz": quantize(root_z - root_z[0]),
            "duration": len(joints) * CONTROL_DT,
        })
        print(f"  skill {name}: {len(joints)} frames")

    return {"quantScale": QUANT, "gaits": gaits, "skills": skills}
```

- [ ] **Step 2: Wire it into `main()`**

After the `fk-golden.json` write, add:

```python
    clips = bake_clips(model, args.microduck)
    path = args.out / "clips.json"
    path.write_text(json.dumps(clips, separators=(",", ":")))
    print(f"clips.json: {len(clips['gaits'])} gaits, {len(clips['skills'])} skills, "
          f"{path.stat().st_size / 1024:.0f} KB")
```

- [ ] **Step 3: Run it**

```bash
uv run --no-project --with mujoco --with onnxruntime --with numpy \
    scripts/bake-duck-motion.py \
    --microduck /home/mattea/projects/microduck \
    --microduck-rl /home/mattea/projects/microduck_rl
```

Expected: 36 gaits, 6 skills. Note the reported size.

- [ ] **Step 4: Check the duck stayed upright**

A fallen robot bakes a useless clip, so verify trunk height stayed near `0.12` and nothing is NaN:

```bash
python3 -c "
import json; c=json.load(open('public/duck/clips.json')); q=c['quantScale']
for g in c['gaits'][:6]:
    j=[v/q for v in g['joints']]
    print(g['cmd'], 'frames', g['frames'], 'joint range', round(min(j),2), round(max(j),2))
print('gaits', len(c['gaits']), 'skills', [s['name'] for s in c['skills']])
"
```

Expected: joint ranges inside roughly -1.6..1.6 rad, no zeros-everywhere clip.

If a clip is flat or the joint range collapses, the duck fell during settle. Stop and report it rather than shipping the clip — the likely cause is an observation-layout error, and `obs.rs` warns that this exact bug looks like a tuning problem.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-duck-motion.py public/duck/clips.json
git commit -m "Bake Microduck gait and skill clips from the shipped policies"
```

---

### Task 5: Forward kinematics in TypeScript

**Files:**
- Create: `src/lib/duck/tree.ts`
- Create: `src/lib/duck/fk.ts`
- Test: `src/lib/duck/fk.test.ts`
- Delete: `src/lib/duck/smoke.test.ts`

**Interfaces:**
- Consumes: `public/duck/tree.json` (Task 2), `src/lib/duck/fk-golden.json` (Task 3).
- Produces:

```ts
// tree.ts
export interface DuckBody { name: string; parent: number; pos: Vec3; quat: Quat; jointIndex: number }
export interface DuckTree {
  jointNames: string[]; homePose: number[]; jointLimits: [number, number][];
  bodies: DuckBody[]; trunkHeight: number; controlDt: number; actionScale: number;
}
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];   // w, x, y, z
export const JOINT_COUNT = 14;
export function loadTree(json: unknown): DuckTree;

// fk.ts
export interface BodyTransform { pos: Vec3; quat: Quat }
export function forwardKinematics(tree: DuckTree, joints: ArrayLike<number>): BodyTransform[];
export function quatMul(a: Quat, b: Quat): Quat;
export function quatRotate(q: Quat, v: Vec3): Vec3;
export function quatFromAxisZ(angle: number): Quat;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/duck/fk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import treeJson from '../../../public/duck/tree.json';
import golden from './fk-golden.json';
import { loadTree, JOINT_COUNT } from './tree';
import { forwardKinematics } from './fk';

const tree = loadTree(treeJson);

describe('tree.json', () => {
  it('has 15 bodies and 14 joints', () => {
    expect(tree.bodies).toHaveLength(15);
    expect(tree.jointNames).toHaveLength(JOINT_COUNT);
  });

  it('assigns every policy slot exactly once', () => {
    const slots = tree.bodies.map((b) => b.jointIndex).filter((i) => i >= 0).sort((a, b) => a - b);
    expect(slots).toEqual([...Array(JOINT_COUNT).keys()]);
  });

  it('lists parents before children', () => {
    tree.bodies.forEach((b, i) => expect(b.parent).toBeLessThan(i));
  });
});

describe('forwardKinematics', () => {
  it('matches MuJoCo on every golden case', () => {
    for (const [c, kase] of golden.cases.entries()) {
      const got = forwardKinematics(tree, kase.joints);
      expect(got).toHaveLength(kase.xpos.length);

      for (let b = 0; b < got.length; b++) {
        const name = tree.bodies[b].name;
        for (let k = 0; k < 3; k++) {
          expect(got[b].pos[k], `case ${c} body ${name} pos[${k}]`)
            .toBeCloseTo(kase.xpos[b][k], 6);
        }
        // A quaternion and its negation are the same rotation.
        const dot = got[b].quat.reduce((s, v, k) => s + v * kase.xquat[b][k], 0);
        const sign = dot < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) {
          expect(sign * got[b].quat[k], `case ${c} body ${name} quat[${k}]`)
            .toBeCloseTo(kase.xquat[b][k], 6);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: FAIL — cannot resolve `./tree` or `./fk`.

If it instead fails on importing JSON, add `"resolveJsonModule": true` to `tsconfig.json`'s `compilerOptions`. Vitest resolves JSON natively; this only affects editor typechecking.

- [ ] **Step 3: Implement `tree.ts`**

```ts
/**
 * The Microduck kinematic tree, as data.
 *
 * Every number here is emitted by `scripts/bake-duck-motion.py` from
 * microduck_rl's `robot_walk.xml` -- never hand-written. A wrong offset does
 * not fail loudly, it produces a plausible pugglenaut that walks wrong.
 */

export type Vec3 = [number, number, number];
/** MuJoCo order: w, x, y, z. */
export type Quat = [number, number, number, number];

/** Joints a policy drives. The mouth is not one of them. */
export const JOINT_COUNT = 14;

export interface DuckBody {
  name: string;
  /** Index into `DuckTree.bodies`, or -1 for the trunk. Always < own index. */
  parent: number;
  pos: Vec3;
  quat: Quat;
  /** Policy action slot 0-13, or -1 if this body carries no joint. */
  jointIndex: number;
}

export interface DuckTree {
  jointNames: string[];
  homePose: number[];
  jointLimits: [number, number][];
  bodies: DuckBody[];
  trunkHeight: number;
  controlDt: number;
  actionScale: number;
}

export function loadTree(json: unknown): DuckTree {
  const t = json as DuckTree;
  if (t.jointNames.length !== JOINT_COUNT) {
    throw new Error(`tree has ${t.jointNames.length} joints, expected ${JOINT_COUNT}`);
  }
  return t;
}
```

- [ ] **Step 4: Implement `fk.ts`**

```ts
/**
 * Forward kinematics for the Microduck tree.
 *
 * Every joint's axis in the MJCF is local Z -- onshape-to-robot bakes each
 * joint's orientation into its body quaternion instead. So a body's local
 * rotation is `body.quat * Rz(angle)`, in that order.
 *
 * Verified against MuJoCo's own `mj_kinematics` output by `fk.test.ts`.
 */

import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

export interface BodyTransform {
  pos: Vec3;
  quat: Quat;
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // t = 2 * (q_vec x v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Rotation of `angle` radians about local Z. */
export function quatFromAxisZ(angle: number): Quat {
  const h = angle / 2;
  return [Math.cos(h), 0, 0, Math.sin(h)];
}

/**
 * World transforms for every body, given the 14 joint angles.
 *
 * The trunk is placed at its MJCF rest pose with identity rotation, matching
 * the golden fixture. Callers compose the live root transform themselves.
 */
export function forwardKinematics(
  tree: DuckTree,
  joints: ArrayLike<number>,
): BodyTransform[] {
  if (joints.length !== JOINT_COUNT) {
    throw new Error(`expected ${JOINT_COUNT} joint angles, got ${joints.length}`);
  }

  const out: BodyTransform[] = [];
  for (const body of tree.bodies) {
    let localQuat = body.quat;
    if (body.jointIndex >= 0) {
      localQuat = quatMul(localQuat, quatFromAxisZ(joints[body.jointIndex]));
    }

    if (body.parent < 0) {
      out.push({ pos: [...body.pos], quat: localQuat });
      continue;
    }

    const parent = out[body.parent];
    const offset = quatRotate(parent.quat, body.pos);
    out.push({
      pos: [
        parent.pos[0] + offset[0],
        parent.pos[1] + offset[1],
        parent.pos[2] + offset[2],
      ],
      quat: quatMul(parent.quat, localQuat),
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: PASS — all 24 golden cases, all 15 bodies.

If positions match but quaternions do not, the joint rotation is being applied on the wrong side: it must be `quatMul(body.quat, Rz)`, not `quatMul(Rz, body.quat)`.

- [ ] **Step 6: Delete the smoke test**

```bash
git rm src/lib/duck/smoke.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/duck/tree.ts src/lib/duck/fk.ts src/lib/duck/fk.test.ts
git commit -m "Add Microduck forward kinematics, verified against MuJoCo"
```

---

### Task 6: Clip decoding and phase-locked blending

**Files:**
- Create: `src/lib/duck/clips.ts`
- Test: `src/lib/duck/clips.test.ts`

**Interfaces:**
- Consumes: `public/duck/clips.json` (Task 4), `JOINT_COUNT` from `tree.ts`.
- Produces:

```ts
export interface Gait { cmd: Vec3; frames: number; joints: Float32Array; rootDz: Float32Array; cycleTime: number }
export interface SkillClip { name: string; frames: number; joints: Float32Array; rootDz: Float32Array; duration: number }
export interface ClipSet { gaits: Gait[]; skills: Map<string, SkillClip> }
export function decodeClips(json: unknown): ClipSet;
export function sampleClip(joints: Float32Array, frames: number, phase: number, out: Float32Array): void;
export function pickGaits(gaits: Gait[], cmd: Vec3): { gait: Gait; weight: number }[];
export function blendGaits(gaits: Gait[], cmd: Vec3, phase: number, out: Float32Array): void;
```

`phase` is always in `[0, 1)` — position within the gait cycle. Blending at equal phase is what stops feet teleporting mid-stride.

- [ ] **Step 1: Write the failing test**

Create `src/lib/duck/clips.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import clipsJson from '../../../public/duck/clips.json';
import { JOINT_COUNT } from './tree';
import { blendGaits, decodeClips, pickGaits, sampleClip } from './clips';

const clips = decodeClips(clipsJson);

describe('decodeClips', () => {
  it('decodes 36 gaits and 6 skills', () => {
    expect(clips.gaits).toHaveLength(36);
    expect([...clips.skills.keys()].sort()).toEqual(
      ['ground_pick', 'kick_left', 'kick_right', 'roulade', 'sit', 'stand'],
    );
  });

  it('sizes every joint track to frames * 14', () => {
    for (const g of clips.gaits) expect(g.joints).toHaveLength(g.frames * JOINT_COUNT);
    for (const s of clips.skills.values()) expect(s.joints).toHaveLength(s.frames * JOINT_COUNT);
  });

  it('dequantizes into plausible radians', () => {
    for (const g of clips.gaits) {
      for (const v of g.joints) expect(Math.abs(v)).toBeLessThan(3.2);
    }
  });

  it('includes a standing-still gait', () => {
    expect(clips.gaits.some((g) => g.cmd.every((v) => v === 0))).toBe(true);
  });
});

describe('sampleClip', () => {
  const frames = 4;
  const joints = new Float32Array(frames * JOINT_COUNT);
  // Joint 0 ramps 0, 1, 2, 3 across the four frames; the rest stay zero.
  for (let f = 0; f < frames; f++) joints[f * JOINT_COUNT] = f;
  const out = new Float32Array(JOINT_COUNT);

  it('returns exact frames at exact phases', () => {
    sampleClip(joints, frames, 0, out);
    expect(out[0]).toBeCloseTo(0, 6);
    sampleClip(joints, frames, 0.5, out);
    expect(out[0]).toBeCloseTo(2, 6);
  });

  it('interpolates between frames', () => {
    sampleClip(joints, frames, 0.125, out);   // halfway between frame 0 and 1
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('wraps the last frame back to the first', () => {
    sampleClip(joints, frames, 0.875, out);   // halfway between frame 3 and 0
    expect(out[0]).toBeCloseTo(1.5, 6);
  });
});

describe('pickGaits', () => {
  it('returns weights summing to one', () => {
    for (const cmd of [[0, 0, 0], [0.3, 0, 0], [0.07, -0.05, 0.4]] as const) {
      const picked = pickGaits(clips.gaits, [...cmd]);
      const total = picked.reduce((s, p) => s + p.weight, 0);
      expect(total).toBeCloseTo(1, 6);
      for (const p of picked) expect(p.weight).toBeGreaterThan(0);
    }
  });

  it('picks a single clip when the command sits on a grid point', () => {
    const picked = pickGaits(clips.gaits, [0.3, 0, 0]);
    expect(picked).toHaveLength(1);
    expect(picked[0].gait.cmd).toEqual([0.3, 0, 0]);
  });
});

describe('blendGaits', () => {
  it('reproduces a grid-point clip exactly', () => {
    const gait = clips.gaits.find((g) => g.cmd.every((v) => v === 0))!;
    const out = new Float32Array(JOINT_COUNT);
    const want = new Float32Array(JOINT_COUNT);
    blendGaits(clips.gaits, [0, 0, 0], 0.25, out);
    sampleClip(gait.joints, gait.frames, 0.25, want);
    for (let j = 0; j < JOINT_COUNT; j++) expect(out[j]).toBeCloseTo(want[j], 5);
  });

  it('stays finite and bounded for off-grid commands', () => {
    const out = new Float32Array(JOINT_COUNT);
    for (let i = 0; i <= 10; i++) {
      blendGaits(clips.gaits, [0.05 * i - 0.15, 0.02, -0.3], i / 11, out);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(3.2);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: FAIL — cannot resolve `./clips`.

- [ ] **Step 3: Implement `clips.ts`**

```ts
/**
 * Baked Microduck motion: decoding, sampling, and phase-locked blending.
 *
 * All pure functions over plain arrays -- no WebGL, no timers -- so the part
 * of the lab most likely to look subtly wrong is the part that is fully
 * testable headlessly.
 *
 * Clips are produced by `scripts/bake-duck-motion.py`.
 */

import { JOINT_COUNT, type Vec3 } from './tree';

export interface Gait {
  cmd: Vec3;
  frames: number;
  /** frames * JOINT_COUNT absolute angles, row-major per frame. */
  joints: Float32Array;
  /** frames vertical offsets, metres, mean-centred. */
  rootDz: Float32Array;
  cycleTime: number;
}

export interface SkillClip {
  name: string;
  frames: number;
  joints: Float32Array;
  rootDz: Float32Array;
  duration: number;
}

export interface ClipSet {
  gaits: Gait[];
  skills: Map<string, SkillClip>;
}

interface RawClip {
  cmd?: number[];
  name?: string;
  frames: number;
  joints: number[];
  rootDz: number[];
  cycleTime?: number;
  duration?: number;
}

interface RawClipSet {
  quantScale: number;
  gaits: RawClip[];
  skills: RawClip[];
}

function dequantize(values: number[], scale: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / scale;
  return out;
}

export function decodeClips(json: unknown): ClipSet {
  const raw = json as RawClipSet;
  const scale = raw.quantScale;

  const gaits: Gait[] = raw.gaits.map((c) => ({
    cmd: c.cmd as Vec3,
    frames: c.frames,
    joints: dequantize(c.joints, scale),
    rootDz: dequantize(c.rootDz, scale),
    cycleTime: c.cycleTime as number,
  }));

  const skills = new Map<string, SkillClip>();
  for (const c of raw.skills) {
    skills.set(c.name as string, {
      name: c.name as string,
      frames: c.frames,
      joints: dequantize(c.joints, scale),
      rootDz: dequantize(c.rootDz, scale),
      duration: c.duration as number,
    });
  }

  return { gaits, skills };
}

/**
 * Sample a looping joint track at `phase` in [0, 1), linearly interpolating
 * and wrapping the last frame back to the first.
 */
export function sampleClip(
  joints: Float32Array,
  frames: number,
  phase: number,
  out: Float32Array,
): void {
  const wrapped = phase - Math.floor(phase);
  const t = wrapped * frames;
  const f0 = Math.floor(t) % frames;
  const f1 = (f0 + 1) % frames;
  const frac = t - Math.floor(t);

  const a = f0 * JOINT_COUNT;
  const b = f1 * JOINT_COUNT;
  for (let j = 0; j < JOINT_COUNT; j++) {
    out[j] = joints[a + j] + (joints[b + j] - joints[a + j]) * frac;
  }
}

/** Normalizing scales per command axis, so vyaw does not dominate distance. */
const CMD_SCALE: Vec3 = [0.3, 0.1, 1.0];

/**
 * The clips nearest a command, with blend weights summing to one.
 *
 * Inverse-distance weighting over the four nearest grid points. An exact grid
 * hit short-circuits to a single clip so a held command replays one recording
 * rather than a blend of itself.
 */
export function pickGaits(gaits: Gait[], cmd: Vec3): { gait: Gait; weight: number }[] {
  const distances = gaits.map((gait) => {
    let d2 = 0;
    for (let k = 0; k < 3; k++) {
      const d = (gait.cmd[k] - cmd[k]) / CMD_SCALE[k];
      d2 += d * d;
    }
    return { gait, dist: Math.sqrt(d2) };
  });

  const exact = distances.find((d) => d.dist < 1e-6);
  if (exact) return [{ gait: exact.gait, weight: 1 }];

  distances.sort((a, b) => a.dist - b.dist);
  const near = distances.slice(0, 4);
  const weights = near.map((n) => 1 / (n.dist * n.dist));
  const total = weights.reduce((s, w) => s + w, 0);

  return near.map((n, i) => ({ gait: n.gait, weight: weights[i] / total }));
}

/** Blend the nearest gaits at a shared phase into `out`. */
export function blendGaits(
  gaits: Gait[],
  cmd: Vec3,
  phase: number,
  out: Float32Array,
): void {
  out.fill(0);
  const scratch = new Float32Array(JOINT_COUNT);

  for (const { gait, weight } of pickGaits(gaits, cmd)) {
    sampleClip(gait.joints, gait.frames, phase, scratch);
    for (let j = 0; j < JOINT_COUNT; j++) out[j] += scratch[j] * weight;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/duck/clips.ts src/lib/duck/clips.test.ts
git commit -m "Add clip decoding and phase-locked gait blending"
```

---

### Task 7: The DuckLink contract and ClipLink backend

**Files:**
- Create: `src/lib/duck/link.ts`
- Create: `src/lib/duck/clipLink.ts`
- Test: `src/lib/duck/clipLink.test.ts`

**Interfaces:**
- Consumes: `clips.ts` (Task 6), `tree.ts` (Task 5).
- Produces:

```ts
// link.ts
export type Skill = 'ground_pick' | 'roulade' | 'kick_left' | 'kick_right' | 'sit' | 'stand';
export interface Twist { vx: number; vy: number; vyaw: number }
export interface HeadPose { neck: number; pitch: number; yaw: number; roll: number }
export interface BodyPose { z: number; roll: number; pitch: number }
export interface DuckState {
  joints: Float32Array; root: { pos: Vec3; quat: Quat };
  gyro: Vec3; gravity: Vec3;
  health: 'playback' | 'live' | 'real';
  activeSkill: Skill | null; mouth: number;
}
export interface DuckLink {
  move(t: Twist): void; head(p: HeadPose): void; do(s: Skill): void;
  pose(b: BodyPose): void; mouth(open: number): void; stop(): void;
  subscribe(cb: (s: DuckState) => void): () => void;
  tick(dt: number): void; dispose(): void;
}
export const CONTROL_HZ = 50;
export const CONTROL_DT = 1 / CONTROL_HZ;

// clipLink.ts
export function createClipLink(tree: DuckTree, clips: ClipSet): DuckLink;
```

`tick(dt)` is driven by the host, not by an internal timer — that is what makes the 50 Hz loop testable without fake timers, and what lets the render loop own the clock.

- [ ] **Step 1: Write the failing test**

Create `src/lib/duck/clipLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import clipsJson from '../../../public/duck/clips.json';
import treeJson from '../../../public/duck/tree.json';
import { decodeClips } from './clips';
import { createClipLink } from './clipLink';
import { CONTROL_DT } from './link';
import { JOINT_COUNT, loadTree } from './tree';

const tree = loadTree(treeJson);
const clips = decodeClips(clipsJson);

function make() {
  return createClipLink(tree, clips);
}

/** Advance `seconds` of simulated time in exact control ticks. */
function advance(link: ReturnType<typeof make>, seconds: number) {
  const ticks = Math.round(seconds / CONTROL_DT);
  for (let i = 0; i < ticks; i++) link.tick(CONTROL_DT);
}

describe('createClipLink', () => {
  it('reports playback health and 14 joints', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.tick(CONTROL_DT);
    expect(state.health).toBe('playback');
    expect(state.joints).toHaveLength(JOINT_COUNT);
  });

  it('starts at the origin and stays there with no command', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    advance(link, 2);
    expect(state.root.pos[0]).toBeCloseTo(0, 3);
    expect(state.root.pos[1]).toBeCloseTo(0, 3);
  });

  it('integrates forward travel from a held command', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.move({ vx: 0.15, vy: 0, vyaw: 0 });
    advance(link, 2);
    // 0.15 m/s for 2 s, minus the first tick.
    expect(state.root.pos[0]).toBeGreaterThan(0.25);
    expect(state.root.pos[0]).toBeLessThan(0.31);
  });

  it('turns in place on a yaw command without translating', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.move({ vx: 0, vy: 0, vyaw: 1.0 });
    advance(link, 1);
    const [w, , , z] = state.root.quat;
    expect(Math.abs(2 * Math.atan2(z, w))).toBeGreaterThan(0.8);
    expect(Math.hypot(state.root.pos[0], state.root.pos[1])).toBeLessThan(0.02);
  });

  it('drives forward along its heading after turning', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.move({ vx: 0, vy: 0, vyaw: 1.0 });
    advance(link, Math.PI / 2);          // ~90 degrees
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 1);
    // Heading is +90 degrees, so travel is along +Y, not +X.
    expect(state.root.pos[1]).toBeGreaterThan(0.2);
    expect(Math.abs(state.root.pos[0])).toBeLessThan(0.1);
  });

  it('stop() halts travel', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 1);
    const parked = state.root.pos[0];
    link.stop();
    advance(link, 1);
    expect(state.root.pos[0]).toBeCloseTo(parked, 3);
  });

  it('runs a skill once and hands back', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.do('kick_left');
    link.tick(CONTROL_DT);
    expect(state.activeSkill).toBe('kick_left');
    advance(link, clips.skills.get('kick_left')!.duration + 0.2);
    expect(state.activeSkill).toBe(null);
  });

  it('ignores a velocity command while a skill is running', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.do('roulade');
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 0.5);
    expect(state.activeSkill).toBe('roulade');
    expect(state.root.pos[0]).toBeCloseTo(0, 3);
  });

  it('applies head commands over the blended pose', () => {
    const link = make();
    let a: any = null;
    link.subscribe((s) => { a = s; });
    link.tick(CONTROL_DT);
    const before = a.joints[7];                  // head_yaw
    link.head({ neck: 0, pitch: 0, yaw: 0.5, roll: 0 });
    link.tick(CONTROL_DT);
    expect(a.joints[7]).not.toBeCloseTo(before, 3);
    expect(a.joints[7]).toBeCloseTo(0.5, 3);
  });

  it('clamps mouth to 0..1', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    link.mouth(3);
    link.tick(CONTROL_DT);
    expect(state.mouth).toBe(1);
    link.mouth(-2);
    link.tick(CONTROL_DT);
    expect(state.mouth).toBe(0);
  });

  it('keeps every joint finite and in range across a long drive', () => {
    const link = make();
    let state: any = null;
    link.subscribe((s) => { state = s; });
    for (let i = 0; i < 500; i++) {
      link.move({ vx: 0.3 * Math.sin(i / 40), vy: 0, vyaw: Math.cos(i / 30) });
      link.tick(CONTROL_DT);
      for (let j = 0; j < JOINT_COUNT; j++) {
        expect(Number.isFinite(state.joints[j])).toBe(true);
        const [lo, hi] = tree.jointLimits[j];
        expect(state.joints[j]).toBeGreaterThanOrEqual(lo - 1e-3);
        expect(state.joints[j]).toBeLessThanOrEqual(hi + 1e-3);
      }
    }
  });

  it('unsubscribe stops delivery', () => {
    const link = make();
    let count = 0;
    const off = link.subscribe(() => { count++; });
    link.tick(CONTROL_DT);
    const seen = count;
    off();
    link.tick(CONTROL_DT);
    expect(count).toBe(seen);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: FAIL — cannot resolve `./clipLink`.

- [ ] **Step 3: Implement `link.ts`**

```ts
/**
 * The one contract between the console and whatever is moving the pugglenaut.
 *
 * Named after the methods Microduck's own WebRTC console permits over its
 * datachannel (`microduck/docs/design/webrtc-console.md`): move, head, look,
 * pose, mouth, do, sound, enable, init, relax, stop, subscribe. Keeping that
 * vocabulary means the console written against baked clips can later drive a
 * simulation, or real hardware, unchanged.
 */

import type { Quat, Vec3 } from './tree';

export type Skill =
  | 'ground_pick'
  | 'roulade'
  | 'kick_left'
  | 'kick_right'
  | 'sit'
  | 'stand';

export interface Twist {
  /** Forward, m/s. */
  vx: number;
  /** Left, m/s. */
  vy: number;
  /** Yaw rate, rad/s. */
  vyaw: number;
}

export interface HeadPose {
  neck: number;
  pitch: number;
  yaw: number;
  roll: number;
}

export interface BodyPose {
  z: number;
  roll: number;
  pitch: number;
}

export interface DuckState {
  /** 14 absolute joint angles, radians, in policy action order. */
  joints: Float32Array;
  root: { pos: Vec3; quat: Quat };
  /** Observation slots 0..3 -- angular velocity, trunk frame, rad/s. */
  gyro: Vec3;
  /** Observation slots 3..6 -- projected gravity, trunk frame, unit vector. */
  gravity: Vec3;
  /** Which backend is driving. Surfaced in the UI rather than hidden. */
  health: 'playback' | 'live' | 'real';
  activeSkill: Skill | null;
  /** 0 closed, 1 fully open. */
  mouth: number;
}

export interface DuckLink {
  move(t: Twist): void;
  head(p: HeadPose): void;
  do(s: Skill): void;
  pose(b: BodyPose): void;
  mouth(open: number): void;
  stop(): void;
  subscribe(cb: (s: DuckState) => void): () => void;
  /** Advance one control step. The host owns the clock. */
  tick(dt: number): void;
  dispose(): void;
}

/** The robot's real control rate. */
export const CONTROL_HZ = 50;
export const CONTROL_DT = 1 / CONTROL_HZ;
```

- [ ] **Step 4: Implement `clipLink.ts`**

```ts
/**
 * `DuckLink` backed by baked motion.
 *
 * Joint motion is replayed from clips recorded off the real policies; world
 * position and heading are integrated from the command being held. So the
 * pugglenaut goes where you point it while its legs do what the trained gait
 * actually does.
 *
 * What this cannot do, by construction: fall over, be pushed, or kick a ball
 * that reacts. There is no physics here, only a recording. `health` reports
 * `'playback'` so the UI can say so.
 */

import { blendGaits, sampleClip, type ClipSet } from './clips';
import {
  CONTROL_DT,
  type BodyPose,
  type DuckLink,
  type DuckState,
  type HeadPose,
  type Skill,
  type Twist,
} from './link';
import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

/** Joint slots the head command owns: neck_pitch, head_pitch, head_yaw, head_roll. */
const HEAD_SLOTS = [5, 6, 7, 8] as const;

/** Cycle time used when a blend spans clips of differing length. */
const NOMINAL_CYCLE = 0.6;

/** How fast a released command decays, so stopping is not a jolt. */
const COMMAND_SMOOTHING = 12;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createClipLink(tree: DuckTree, clips: ClipSet): DuckLink {
  const listeners = new Set<(s: DuckState) => void>();

  // Commanded, and the smoothed value actually used.
  let wanted: Twist = { vx: 0, vy: 0, vyaw: 0 };
  let twist: Twist = { vx: 0, vy: 0, vyaw: 0 };
  let head: HeadPose | null = null;
  let body: BodyPose = { z: 0, roll: 0, pitch: 0 };
  let mouthOpen = 0;

  let phase = 0;
  let yaw = 0;
  const pos: Vec3 = [0, 0, tree.trunkHeight];

  let skill: Skill | null = null;
  let skillElapsed = 0;

  const joints = new Float32Array(JOINT_COUNT);
  const gyro: Vec3 = [0, 0, 0];
  const gravity: Vec3 = [0, 0, -1];

  let lastYaw = 0;

  function emit(): void {
    const half = yaw / 2;
    const quat: Quat = [Math.cos(half), 0, 0, Math.sin(half)];
    const state: DuckState = {
      joints,
      root: { pos: [pos[0], pos[1], pos[2]], quat },
      gyro,
      gravity,
      health: 'playback',
      activeSkill: skill,
      mouth: mouthOpen,
    };
    for (const cb of listeners) cb(state);
  }

  function tick(dt: number): void {
    const step = dt > 0 ? dt : CONTROL_DT;

    if (skill) {
      const clip = clips.skills.get(skill);
      if (!clip) {
        skill = null;
      } else {
        skillElapsed += step;
        if (skillElapsed >= clip.duration) {
          skill = null;
          skillElapsed = 0;
        } else {
          // A skill owns the whole body and does not travel.
          const p = skillElapsed / clip.duration;
          sampleClip(clip.joints, clip.frames, clamp(p, 0, 0.999999), joints);
          pos[2] = tree.trunkHeight + clip.rootDz[
            Math.min(clip.frames - 1, Math.floor(p * clip.frames))
          ];
          gyro[0] = 0;
          gyro[1] = 0;
          gyro[2] = 0;
          emit();
          return;
        }
      }
    }

    // Ease the command so releasing a key does not snap the gait.
    const k = Math.min(1, COMMAND_SMOOTHING * step);
    twist = {
      vx: twist.vx + (wanted.vx - twist.vx) * k,
      vy: twist.vy + (wanted.vy - twist.vy) * k,
      vyaw: twist.vyaw + (wanted.vyaw - twist.vyaw) * k,
    };

    // Advance gait phase with speed, so faster commands step faster.
    const speed = Math.hypot(twist.vx, twist.vy) + Math.abs(twist.vyaw) * 0.1;
    const rate = speed > 1e-4 ? 1 / NOMINAL_CYCLE : 1 / (NOMINAL_CYCLE * 2);
    phase = (phase + rate * step) % 1;

    const cmd: Vec3 = [twist.vx, twist.vy, twist.vyaw];
    blendGaits(clips.gaits, cmd, phase, joints);

    // Head targets ride over the blended pose. obs.rs is explicit that head
    // targets are a command and must not be double-applied; here the clip was
    // baked with a zero head command, so writing the slots is the whole of it.
    if (head) {
      const values = [head.neck, head.pitch, head.yaw, head.roll];
      HEAD_SLOTS.forEach((slot, i) => {
        joints[slot] = values[i];
      });
    }

    // Keep every angle inside the servo travel the model declares.
    for (let j = 0; j < JOINT_COUNT; j++) {
      const [lo, hi] = tree.jointLimits[j];
      joints[j] = clamp(joints[j], lo, hi);
    }

    // Integrate the root from the command, in the duck's own frame.
    yaw += twist.vyaw * step;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    pos[0] += (twist.vx * c - twist.vy * s) * step;
    pos[1] += (twist.vx * s + twist.vy * c) * step;

    const bob = clips.gaits.length
      ? blendedBob(cmd, phase)
      : 0;
    pos[2] = tree.trunkHeight + bob + body.z;

    // Gyro is the honest thing we can report: yaw rate is measured, and the
    // roll and pitch a real IMU would see are not simulated here.
    gyro[0] = 0;
    gyro[1] = 0;
    gyro[2] = (yaw - lastYaw) / step;
    lastYaw = yaw;

    // Projected gravity for an upright trunk with the commanded lean.
    gravity[0] = Math.sin(body.pitch);
    gravity[1] = -Math.sin(body.roll);
    gravity[2] = -Math.cos(body.pitch) * Math.cos(body.roll);

    emit();
  }

  function blendedBob(cmd: Vec3, at: number): number {
    // Vertical bob, blended the same way the joints are.
    let total = 0;
    let weightSum = 0;
    for (const { gait, weight } of pickNearest(cmd)) {
      const f = Math.min(gait.frames - 1, Math.floor(at * gait.frames));
      total += gait.rootDz[f] * weight;
      weightSum += weight;
    }
    return weightSum > 0 ? total / weightSum : 0;
  }

  function pickNearest(cmd: Vec3) {
    // Reuse the joint blender's neighbour choice so bob and pose agree.
    const scratch = new Float32Array(JOINT_COUNT);
    void scratch;
    return blendNeighbours(cmd);
  }

  function blendNeighbours(cmd: Vec3) {
    // Imported lazily to keep the weighting logic in one place.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return pickGaitsRef(clips.gaits, cmd);
  }

  return {
    move(t: Twist) {
      if (skill) return;
      wanted = { vx: t.vx, vy: t.vy, vyaw: t.vyaw };
    },
    head(p: HeadPose) {
      head = { ...p };
    },
    do(s: Skill) {
      if (skill) return;
      if (!clips.skills.has(s)) return;
      skill = s;
      skillElapsed = 0;
      wanted = { vx: 0, vy: 0, vyaw: 0 };
      twist = { vx: 0, vy: 0, vyaw: 0 };
    },
    pose(b: BodyPose) {
      body = { ...b };
    },
    mouth(open: number) {
      mouthOpen = clamp(open, 0, 1);
    },
    stop() {
      wanted = { vx: 0, vy: 0, vyaw: 0 };
      twist = { vx: 0, vy: 0, vyaw: 0 };
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    tick,
    dispose() {
      listeners.clear();
    },
  };
}
```

Then replace the `pickNearest` / `blendNeighbours` / `pickGaitsRef` indirection with a direct import — add `pickGaits` to the `./clips` import at the top of the file and simplify:

```ts
  function blendedBob(cmd: Vec3, at: number): number {
    let total = 0;
    for (const { gait, weight } of pickGaits(clips.gaits, cmd)) {
      const f = Math.min(gait.frames - 1, Math.floor(at * gait.frames));
      total += gait.rootDz[f] * weight;
    }
    return total;
  }
```

and delete `pickNearest` and `blendNeighbours` entirely. Weights from `pickGaits` already sum to one, so no renormalisation is needed.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/duck/link.ts src/lib/duck/clipLink.ts src/lib/duck/clipLink.test.ts
git commit -m "Add the DuckLink contract and its baked-clip backend"
```

---

### Task 8: The procedural pugglenaut rig

**Files:**
- Create: `src/lib/duck/pugglenaut.ts`
- Test: `src/lib/duck/pugglenaut.test.ts`

**Interfaces:**
- Consumes: `fk.ts`, `tree.ts` (Task 5), `three`.
- Produces:

```ts
export interface Rig {
  root: THREE.Group;
  apply(joints: ArrayLike<number>, root: { pos: Vec3; quat: Quat }, mouth: number, phase: number): void;
  setTheme(dark: boolean): void;
  dispose(): void;
}
export function createPugglenaut(tree: DuckTree): Rig;
export const PALETTE: Readonly<Record<'body'|'bodyStroke'|'bill'|'helmet'|'helmetRim'|'eye'|'catchlight'|'flame', number>>;
```

Bodies get one `THREE.Group` each, positioned by FK. Non-articulated extras — tail, helmet, jetpack, flame — parent to the trunk group. The tail sway and flame flicker are driven by `phase` and are decorative, not policy output.

- [ ] **Step 1: Write the failing test**

Create `src/lib/duck/pugglenaut.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import treeJson from '../../../public/duck/tree.json';
import { forwardKinematics } from './fk';
import { createPugglenaut, PALETTE } from './pugglenaut';
import { JOINT_COUNT, loadTree } from './tree';

const tree = loadTree(treeJson);

describe('createPugglenaut', () => {
  it('creates one group per body', () => {
    const rig = createPugglenaut(tree);
    const named = tree.bodies.map((b) => rig.root.getObjectByName(`link:${b.name}`));
    expect(named.every(Boolean)).toBe(true);
    rig.dispose();
  });

  it('places link groups exactly where FK says', () => {
    const rig = createPugglenaut(tree);
    const joints = new Float32Array(tree.homePose);
    rig.apply(joints, { pos: [0, 0, tree.trunkHeight], quat: [1, 0, 0, 0] }, 0, 0);

    const want = forwardKinematics(tree, joints);
    tree.bodies.forEach((body, i) => {
      const group = rig.root.getObjectByName(`link:${body.name}`)!;
      const world = group.getWorldPosition(new (group.position.constructor as any)());
      expect(world.x).toBeCloseTo(want[i].pos[0], 5);
      expect(world.y).toBeCloseTo(want[i].pos[1], 5);
      expect(world.z).toBeCloseTo(want[i].pos[2], 5);
    });
    rig.dispose();
  });

  it('uses the established mascot palette', () => {
    expect(PALETTE.body).toBe(0xcbb27a);
    expect(PALETTE.bodyStroke).toBe(0x8f7a45);
    expect(PALETTE.bill).toBe(0x3a3140);
    expect(PALETTE.eye).toBe(0x20202a);
    expect(PALETTE.flame).toBe(0xffcf33);
  });

  it('rejects a wrong-width joint vector', () => {
    const rig = createPugglenaut(tree);
    expect(() => rig.apply(new Float32Array(JOINT_COUNT - 1), { pos: [0, 0, 0], quat: [1, 0, 0, 0] }, 0, 0)).toThrow();
    rig.dispose();
  });

  it('keeps the pugglenaut about 0.25 m tall', () => {
    const rig = createPugglenaut(tree);
    rig.apply(new Float32Array(tree.homePose), { pos: [0, 0, tree.trunkHeight], quat: [1, 0, 0, 0] }, 0, 0);
    const box = rig.boundingBox();
    expect(box.max.z - box.min.z).toBeGreaterThan(0.15);
    expect(box.max.z - box.min.z).toBeLessThan(0.4);
    rig.dispose();
  });
});
```

Add `boundingBox(): THREE.Box3` to the `Rig` interface to support that last test.

- [ ] **Step 2: Run it to confirm it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: FAIL — cannot resolve `./pugglenaut`.

Three.js works headlessly for scene-graph maths; only rendering needs a GL context, and these tests never render.

- [ ] **Step 3: Implement `pugglenaut.ts`**

```ts
/**
 * The pugglenaut, as Three.js primitives on Microduck's skeleton.
 *
 * The skeleton is the robot's, exactly -- link offsets come from `tree.json`
 * and must not be edited, because a baked joint angle is only meaningful on
 * the tree it was recorded on. The *skin* is ours: the site's baby-platypus
 * astronaut, built from the same stacked-ellipse vocabulary the 2D mascot uses
 * in `BoopMascot.tsx` and `favicon.svg`.
 *
 * Procedural rather than a mesh asset: zero bytes to download, colours that
 * follow the site's themes, and a primitive count that survives stereo XR.
 */

import * as THREE from 'three';
import { forwardKinematics } from './fk';
import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

/** The mascot's established colours. Do not invent new ones here. */
export const PALETTE = {
  body: 0xcbb27a,
  bodyStroke: 0x8f7a45,
  bill: 0x3a3140,
  helmet: 0xffffff,
  helmetRim: 0xffffff,
  eye: 0x20202a,
  catchlight: 0xf7f4ea,
  flame: 0xffcf33,
} as const;

/** Microduck joint 9 -- the mouth. Not a policy action; driven by robot.mouth. */
const MOUTH_CLOSED = (-5 * Math.PI) / 180;
const MOUTH_OPEN = (30 * Math.PI) / 180;

export interface Rig {
  root: THREE.Group;
  apply(
    joints: ArrayLike<number>,
    root: { pos: Vec3; quat: Quat },
    mouth: number,
    phase: number,
  ): void;
  boundingBox(): THREE.Box3;
  setTheme(dark: boolean): void;
  dispose(): void;
}

function ellipsoid(
  material: THREE.Material,
  radius: number,
  scale: [number, number, number],
  pos: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  mesh.scale.set(...scale);
  mesh.position.set(...pos);
  return mesh;
}

function capsule(
  material: THREE.Material,
  radius: number,
  length: number,
  pos: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
  mesh.position.set(...pos);
  return mesh;
}

export function createPugglenaut(tree: DuckTree): Rig {
  const disposables: { dispose(): void }[] = [];

  function track<T extends { dispose(): void }>(x: T): T {
    disposables.push(x);
    return x;
  }

  const bodyMat = track(new THREE.MeshStandardMaterial({
    color: PALETTE.body, roughness: 0.65, metalness: 0.05,
  }));
  const strokeMat = track(new THREE.MeshStandardMaterial({
    color: PALETTE.bodyStroke, roughness: 0.7,
  }));
  const billMat = track(new THREE.MeshStandardMaterial({
    color: PALETTE.bill, roughness: 0.5,
  }));
  const eyeMat = track(new THREE.MeshStandardMaterial({
    color: PALETTE.eye, roughness: 0.2,
  }));
  const catchMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.catchlight }));
  const helmetMat = track(new THREE.MeshPhysicalMaterial({
    color: PALETTE.helmet, transparent: true, opacity: 0.16,
    roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
  }));
  const rimMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE.helmetRim, transparent: true, opacity: 0.85,
  }));
  const flameMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.flame }));

  const root = new THREE.Group();
  root.name = 'pugglenaut';

  // One group per body, parented to mirror the tree so Three.js composes the
  // transforms and FK output can be written straight in as local values.
  const groups: THREE.Group[] = [];
  for (const body of tree.bodies) {
    const group = new THREE.Group();
    group.name = `link:${body.name}`;
    groups.push(group);
    if (body.parent < 0) root.add(group);
    else groups[body.parent].add(group);
  }

  const byName = (n: string) => groups[tree.bodies.findIndex((b) => b.name === n)];

  // --- Trunk: the platypus body, plus the suit and the tail. ---
  const trunk = byName('trunk_base');
  trunk.add(ellipsoid(bodyMat, 0.045, [1.15, 0.9, 0.85], [0.004, 0, 0.012]));
  trunk.add(ellipsoid(strokeMat, 0.026, [1.0, 0.8, 0.6], [-0.026, 0, 0.004]));  // pack
  // Jetpack + flame, parented to the trunk: decoration, not a robot part.
  const jet = new THREE.Group();
  jet.position.set(-0.038, 0, 0.0);
  jet.add(capsule(strokeMat, 0.011, 0.03, [0, 0, 0.01]));
  const flame = ellipsoid(flameMat, 0.009, [1, 1, 1.8], [0, 0, -0.026]);
  flame.name = 'flame';
  jet.add(flame);
  trunk.add(jet);

  // Tail: a flat paddle that sways off gait phase. Decorative.
  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(-0.05, 0, -0.004);
  tail.add(ellipsoid(strokeMat, 0.022, [1.3, 1.0, 0.28], [-0.018, 0, 0]));
  trunk.add(tail);

  // --- Head: bill, eyes, helmet. Parented to the last head link. ---
  const head = byName('jaw_soft');
  head.add(ellipsoid(bodyMat, 0.027, [1.0, 0.95, 0.85], [0, 0, 0]));

  const bill = new THREE.Group();
  bill.name = 'bill';
  bill.position.set(0.022, 0, -0.004);
  const upperBill = ellipsoid(billMat, 0.017, [1.25, 1.0, 0.34], [0.006, 0, 0]);
  bill.add(upperBill);
  const lowerBill = new THREE.Group();
  lowerBill.name = 'lowerBill';
  lowerBill.add(ellipsoid(billMat, 0.015, [1.2, 0.92, 0.26], [0.006, 0, -0.004]));
  bill.add(lowerBill);
  head.add(bill);

  for (const side of [1, -1]) {
    head.add(ellipsoid(eyeMat, 0.0055, [1, 1, 1], [0.012, 0.013 * side, 0.014]));
    head.add(ellipsoid(catchMat, 0.0018, [1, 1, 1], [0.016, 0.0155 * side, 0.017]));
  }

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 18), helmetMat);
  helmet.position.set(0.006, 0, 0.006);
  head.add(helmet);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0415, 0.0016, 6, 28), rimMat);
  rim.position.copy(helmet.position);
  rim.rotation.x = Math.PI / 2;
  head.add(rim);

  // --- Legs: a capsule per link, plus webbed feet. ---
  for (const side of ['left', 'right'] as const) {
    byName(side === 'left' ? 'upper_leg_left' : 'upper_leg_right')
      .add(capsule(bodyMat, 0.010, 0.026, [0, 0.014, 0]));
    byName(side === 'left' ? 'leg' : 'leg_2')
      .add(capsule(bodyMat, 0.009, 0.024, [0, 0.016, 0]));
    const foot = byName(side === 'left' ? 'ankle_left' : 'ankle_right');
    foot.add(ellipsoid(billMat, 0.019, [1.35, 0.85, 0.22], [0.012, 0, -0.012]));
  }

  const box = new THREE.Box3();

  function apply(
    joints: ArrayLike<number>,
    rootPose: { pos: Vec3; quat: Quat },
    mouth: number,
    phase: number,
  ): void {
    if (joints.length !== JOINT_COUNT) {
      throw new Error(`expected ${JOINT_COUNT} joint angles, got ${joints.length}`);
    }

    // Place the whole rig. MJCF is Z-up, which the scene keeps.
    root.position.set(rootPose.pos[0], rootPose.pos[1], rootPose.pos[2] - tree.trunkHeight);
    root.quaternion.set(rootPose.quat[1], rootPose.quat[2], rootPose.quat[3], rootPose.quat[0]);

    // Write each body's LOCAL transform; Three.js composes the chain.
    tree.bodies.forEach((body, i) => {
      const group = groups[i];
      group.position.set(body.pos[0], body.pos[1], body.pos[2]);
      const q = new THREE.Quaternion(body.quat[1], body.quat[2], body.quat[3], body.quat[0]);
      if (body.jointIndex >= 0) {
        q.multiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1), joints[body.jointIndex],
        ));
      }
      group.quaternion.copy(q);
    });

    // The mouth is a real robot joint, driven by robot.mouth rather than any
    // policy -- so the bill opens over the servo's actual -5..+30 degrees.
    const angle = MOUTH_CLOSED + Math.max(0, Math.min(1, mouth)) * (MOUTH_OPEN - MOUTH_CLOSED);
    lowerBill.rotation.y = angle;

    // Decorative: tail sway and flame flicker follow gait phase.
    tail.rotation.z = Math.sin(phase * Math.PI * 2) * 0.22;
    const flick = 1 + Math.sin(phase * Math.PI * 6) * 0.18;
    flame.scale.set(1, 1, 1.8 * flick);

    root.updateMatrixWorld(true);
  }

  return {
    root,
    apply,
    boundingBox() {
      return box.setFromObject(root);
    },
    setTheme(dark: boolean) {
      // Themes only shift the suit's contrast; the mascot keeps its colours.
      strokeMat.color.setHex(dark ? 0x6f5d34 : PALETTE.bodyStroke);
      rimMat.opacity = dark ? 0.95 : 0.85;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test
```

Expected: PASS. If the FK-agreement test fails, the local-transform write in `apply` disagrees with `fk.ts` — both must be `body.quat` then `Rz(angle)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/duck/pugglenaut.ts src/lib/duck/pugglenaut.test.ts
git commit -m "Add the procedural pugglenaut rig on the Microduck skeleton"
```

---

### Task 9: The 3D scene

**Files:**
- Create: `src/components/LabScene.tsx`

**Interfaces:**
- Consumes: `pugglenaut.ts` (Task 8), `link.ts` (Task 7), `three`.
- Produces:

```tsx
export interface LabSceneProps {
  link: DuckLink;
  tree: DuckTree;
  running: boolean;
  reducedMotion: boolean;
  onFps?: (fps: number) => void;
}
export default function LabScene(props: LabSceneProps): JSX.Element;
```

Owns the WebGL canvas and both clocks: it advances `link.tick` in fixed 50 Hz steps and renders at display rate.

- [ ] **Step 1: Implement it**

```tsx
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONTROL_DT, type DuckLink, type DuckState } from '../lib/duck/link';
import { createPugglenaut, type Rig } from '../lib/duck/pugglenaut';
import type { DuckTree } from '../lib/duck/tree';

export interface LabSceneProps {
  link: DuckLink;
  tree: DuckTree;
  running: boolean;
  reducedMotion: boolean;
  onFps?: (fps: number) => void;
}

/** Never advance more than this much simulated time in one frame. */
const MAX_CATCHUP = 0.25;

export default function LabScene({
  link, tree, running, reducedMotion, onFps,
}: LabSceneProps) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = holder.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    // MJCF is Z-up, and the rig is built in that frame -- so tell Three.js.
    scene.up.set(0, 0, 1);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 20);
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, -0.5, 0.9);
    scene.add(key);

    // A grid floor at z = 0, which is where the MJCF's floor plane sits.
    const grid = new THREE.GridHelper(2, 20, 0x8f7a45, 0x8f7a45);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).opacity = 0.28;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const rig: Rig = createPugglenaut(tree);
    scene.add(rig.root);

    let state: DuckState | null = null;
    const unsubscribe = link.subscribe((s) => { state = s; });

    // Seed one tick so a paused lab still shows a standing pugglenaut.
    link.tick(CONTROL_DT);
    let phase = 0;

    function resize() {
      const w = mount!.clientWidth || 1;
      const h = mount!.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let raf = 0;
    let last = performance.now();
    let backlog = 0;
    let frames = 0;
    let fpsAt = last;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, MAX_CATCHUP);
      last = now;

      if (running) {
        backlog += dt;
        // Fixed 50 Hz control, independent of display rate.
        while (backlog >= CONTROL_DT) {
          link.tick(CONTROL_DT);
          backlog -= CONTROL_DT;
          phase = (phase + CONTROL_DT / 0.6) % 1;
        }
      }

      if (state) {
        rig.apply(state.joints, state.root, state.mouth, reducedMotion ? 0 : phase);
        // Chase camera: follow the pugglenaut without spinning with it.
        const [x, y, z] = state.root.pos;
        camera.position.set(x - 0.42, y - 0.46, z + 0.26);
        camera.lookAt(x, y, z - 0.02);
      }

      renderer.render(scene, camera);

      frames++;
      if (onFps && now - fpsAt > 1000) {
        onFps(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      unsubscribe();
      rig.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [link, tree, running, reducedMotion, onFps]);

  return <div ref={holder} className="lab-viewport" aria-hidden="true" />;
}
```

- [ ] **Step 2: Confirm it typechecks and builds**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npx astro check 2>&1 | tail -20
npm run build
```

Expected: build exits 0. `astro check` may warn about the unused `reducedMotion` dependency ordering; errors must be fixed.

- [ ] **Step 3: Commit**

```bash
git add src/components/LabScene.tsx
git commit -m "Add the Waddle Lab 3D scene with a fixed 50 Hz control clock"
```

---

### Task 10: The console island

**Files:**
- Create: `src/components/LabConsole.tsx`
- Create: `src/styles/lab.css`

**Interfaces:**
- Consumes: everything above.
- Produces: `export default function LabConsole(): JSX.Element` — the single island `/lab` mounts.

- [ ] **Step 1: Implement `LabConsole.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/lab.css';
import clipsJson from '../../public/duck/clips.json';
import treeJson from '../../public/duck/tree.json';
import { decodeClips } from '../lib/duck/clips';
import { createClipLink } from '../lib/duck/clipLink';
import type { DuckState, Skill } from '../lib/duck/link';
import { loadTree } from '../lib/duck/tree';
import LabScene from './LabScene';

/**
 * The Waddle Lab console.
 *
 * Input mirrors Microduck's own gamepad table (docs/robot/cheatsheet.md) so
 * muscle memory transfers to the real robot: left stick drives, right stick
 * turns, A ground-picks, X rolls, LB/RB kick, D-pad-down sits.
 *
 * Inert until powered on -- three.js is not downloaded work this page does for
 * a visitor who only wanted to read.
 */

const SKILLS: { id: Skill; label: string; key: string }[] = [
  { id: 'ground_pick', label: 'Ground pick', key: 'A' },
  { id: 'roulade', label: 'Roulade', key: 'X' },
  { id: 'kick_left', label: 'Kick L', key: 'Q' },
  { id: 'kick_right', label: 'Kick R', key: 'E' },
  { id: 'sit', label: 'Sit', key: 'C' },
  { id: 'stand', label: 'Stand', key: 'V' },
];

const DRIVE_VX = 0.3;
const DRIVE_VY = 0.1;
const DRIVE_VYAW = 1.0;

export default function LabConsole() {
  const tree = useMemo(() => loadTree(treeJson), []);
  const clips = useMemo(() => decodeClips(clipsJson), []);
  const link = useMemo(() => createClipLink(tree, clips), [tree, clips]);

  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fps, setFps] = useState(0);
  const [state, setState] = useState<DuckState | null>(null);
  const held = useRef(new Set<string>());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Sample state for the telemetry readout at a human rate, not 50 Hz.
  useEffect(() => {
    let latest: DuckState | null = null;
    const off = link.subscribe((s) => { latest = s; });
    const id = window.setInterval(() => {
      if (latest) {
        setState({
          ...latest,
          joints: Float32Array.from(latest.joints),
          root: { pos: [...latest.root.pos], quat: [...latest.root.quat] },
          gyro: [...latest.gyro],
          gravity: [...latest.gravity],
        });
      }
    }, 100);
    return () => { off(); window.clearInterval(id); };
  }, [link]);

  useEffect(() => () => link.dispose(), [link]);

  const pushCommand = useCallback(() => {
    const keys = held.current;
    const vx = (keys.has('w') ? DRIVE_VX : 0) + (keys.has('s') ? -DRIVE_VX / 2 : 0);
    const vy = (keys.has('a') ? DRIVE_VY : 0) + (keys.has('d') ? -DRIVE_VY : 0);
    const vyaw = (keys.has('arrowleft') ? DRIVE_VYAW : 0)
      + (keys.has('arrowright') ? -DRIVE_VYAW : 0);
    link.move({ vx, vy, vyaw });
  }, [link]);

  useEffect(() => {
    if (!running) return;

    const skillFor = (k: string) =>
      SKILLS.find((s) => s.key.toLowerCase() === k)?.id;

    function down(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
        held.current.add(k);
        pushCommand();
        return;
      }
      const skill = skillFor(k);
      if (skill) { e.preventDefault(); link.do(skill); return; }
      if (k === ' ') { e.preventDefault(); link.mouth(1); }
    }

    function up(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (held.current.delete(k)) pushCommand();
      if (k === ' ') link.mouth(0);
    }

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      held.current.clear();
      link.stop();
    };
  }, [running, link, pushCommand]);

  // Real gamepads, mapped as the robot maps them.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const pressed = new Set<number>();

    function poll() {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!pad) return;

      const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      link.move({
        vx: -dead(pad.axes[1] ?? 0) * DRIVE_VX,
        vy: -dead(pad.axes[0] ?? 0) * DRIVE_VY,
        vyaw: -dead(pad.axes[2] ?? 0) * DRIVE_VYAW,
      });

      const map: [number, Skill][] = [
        [0, 'ground_pick'], [2, 'roulade'],
        [4, 'kick_left'], [5, 'kick_right'], [13, 'sit'],
      ];
      for (const [button, skill] of map) {
        if (pad.buttons[button]?.pressed) {
          if (!pressed.has(button)) { pressed.add(button); link.do(skill); }
        } else {
          pressed.delete(button);
        }
      }
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [running, link]);

  const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

  return (
    <div className="lab">
      <div className="lab-stage">
        {running ? (
          <LabScene
            link={link}
            tree={tree}
            running={running}
            reducedMotion={reduced}
            onFps={setFps}
          />
        ) : (
          <div className="lab-poster">
            <p className="lab-poster-title">Waddle Lab</p>
            <p className="lab-poster-sub">
              A pugglenaut walking on a real robot's gait. Nothing runs until you
              say so.
            </p>
          </div>
        )}

        <div className="lab-badge" data-mode={state?.health ?? 'playback'}>
          {state?.health === 'playback' ? 'SIM: PLAYBACK' : 'SIM: LIVE'}
          {running && fps > 0 ? ` · ${fps} fps` : ''}
        </div>
      </div>

      <div className="lab-controls">
        <button
          type="button"
          className="lab-power"
          aria-pressed={running}
          onClick={() => setRunning((r) => !r)}
        >
          {running ? '■ Power down' : '▶ Power up'}
        </button>

        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="lab-skill"
            disabled={!running}
            onClick={() => link.do(s.id)}
          >
            {s.label} <kbd>{s.key}</kbd>
          </button>
        ))}
      </div>

      <p className="lab-howto">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to drive,
        <kbd>←</kbd><kbd>→</kbd> to turn, <kbd>Space</kbd> for the bill. A
        gamepad works too, mapped the way the real robot maps it.
      </p>

      <dl className="lab-telemetry">
        <div>
          <dt>gyro</dt>
          <dd>{state ? state.gyro.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>gravity</dt>
          <dd>{state ? state.gravity.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>position</dt>
          <dd>{state ? state.root.pos.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>skill</dt>
          <dd>{state?.activeSkill ?? 'idle'}</dd>
        </div>
      </dl>

      <p className="lab-note">
        Joint motion is recorded from the ONNX policies that ship on
        Pollen Robotics' <strong>Microduck</strong>, replayed on its exact
        skeleton. In playback mode there is no physics, so the pugglenaut cannot
        fall over — that arrives with the live simulator.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/styles/lab.css`**

```css
/* Waddle Lab console chrome. Themed entirely through --rp-* tokens so it
   follows Paper / CRT / Sketch like the rest of the site. */

.lab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lab-stage {
  position: relative;
  aspect-ratio: 16 / 10;
  width: 100%;
  overflow: hidden;
  border: 2px solid var(--rp-color-border, #8f7a45);
  border-radius: 6px;
  background: var(--rp-color-surface, #12101a);
}

.lab-viewport {
  width: 100%;
  height: 100%;
}

.lab-poster {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  text-align: center;
}

.lab-poster-title {
  margin: 0;
  font-family: var(--rp-font-display, monospace);
  font-size: clamp(1.4rem, 4vw, 2.2rem);
}

.lab-poster-sub {
  margin: 0;
  max-width: 34ch;
  opacity: 0.75;
}

.lab-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #f7f4ea;
  font-family: var(--rp-font-mono, monospace);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
}

.lab-badge[data-mode='playback'] {
  color: #ffcf33;
}

.lab-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lab-power,
.lab-skill {
  padding: 6px 12px;
  border: 2px solid var(--rp-color-border, #8f7a45);
  border-radius: 4px;
  background: var(--rp-color-surface-raised, transparent);
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.lab-power {
  font-weight: 700;
}

.lab-skill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.lab-skill kbd {
  margin-left: 4px;
  opacity: 0.7;
  font-size: 0.75em;
}

.lab-howto {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.8;
}

.lab-howto kbd {
  margin: 0 2px;
}

.lab-telemetry {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 10px;
  border: 1px dashed var(--rp-color-border, #8f7a45);
  border-radius: 4px;
  font-family: var(--rp-font-mono, monospace);
  font-size: 0.78rem;
}

.lab-telemetry dt {
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.68rem;
}

.lab-telemetry dd {
  margin: 2px 0 0;
  white-space: pre;
}

.lab-note {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.72;
}

@media (prefers-reduced-motion: reduce) {
  .lab-stage {
    scroll-behavior: auto;
  }
}
```

- [ ] **Step 3: Build**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/LabConsole.tsx src/styles/lab.css
git commit -m "Add the Waddle Lab teleop console island"
```

---

### Task 11: The page, navigation, and docs

**Files:**
- Create: `src/pages/lab.astro`
- Modify: `src/components/StarMap.astro`
- Modify: `src/pages/game.astro`
- Modify: `README.md`

**Interfaces:**
- Consumes: `LabConsole` (Task 10).
- Produces: a reachable `/lab` route.

- [ ] **Step 1: Read the pages you are matching**

```bash
sed -n '1,40p' src/pages/doodle.astro
grep -n 'href' src/components/StarMap.astro
```

Follow whatever `Base` / `Window` / `HyperLink` idiom those use; do not invent a new page shape.

- [ ] **Step 2: Create `src/pages/lab.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import { Window, HyperLink } from '@retropolis/ui';
import LabConsole from '../components/LabConsole.tsx';

// The Waddle Lab: the pugglenaut driven by Microduck's real trained gait.
// The island is client:visible, not client:load — three.js should not be
// fetched for a visitor who never scrolls this far.
---

<Base
  title="Waddle Lab · Pugglenaut"
  description="Drive the pugglenaut using the real reinforcement-learning gait of Pollen Robotics' Microduck — walk, turn, kick, roll and sit, replayed on the robot's exact skeleton."
>
  <main class="page stack">
    <header class="stack" style="gap: 8px;">
      <h1 class="hero-title" style="font-size: clamp(2rem, 6vw, 3.2rem);">Waddle Lab</h1>
      <p class="hero-tagline" style="margin: 0;">
        A pugglenaut with a robot's legs. Every step here was recorded from the
        neural policies that ship on <em>Microduck</em>, a 25 cm bipedal robot —
        replayed on its exact skeleton.
      </p>
    </header>

    <Window title="waddle-lab.exe" icon="rocket">
      <LabConsole client:visible />
    </Window>

    <Window title="how-it-works.txt" icon="star" status="Ship schematics.">
      <div class="stack" style="gap: 10px;">
        <p style="margin: 0;">
          <strong>Microduck</strong> walks by neural network: a 50 Hz control
          loop feeds 61 numbers — gyro, gravity, joint angles, its own last
          move, and your command — into a policy that answers with 14 joint
          targets. Those policies were trained in simulation and ship on the
          real robot.
        </p>
        <p style="margin: 0;">
          To get them here, the robot's control loop was run offline and the
          resulting joint angles recorded. The lab blends those recordings to
          follow your command. It is the real gait, on the real skeleton, with
          a platypus in a helmet where the duck used to be.
        </p>
        <p style="margin: 0;">
          <HyperLink href="https://github.com/pollen-robotics/microduck">
            pollen-robotics/microduck →
          </HyperLink>
        </p>
      </div>
    </Window>

    <p class="site-footer" style="margin: 0;">
      <HyperLink href="/">← back to home base</HyperLink>
    </p>
  </main>
</Base>
```

- [ ] **Step 3: Add the StarMap node**

Add a `/lab` node to `src/components/StarMap.astro`, matching the existing nodes' markup exactly — same element shape, same class names, a free coordinate that does not overlap a neighbour, and the label `Waddle Lab`.

- [ ] **Step 4: Cross-link from the arcade**

In `src/pages/game.astro`, after the `comet-snake.exe` `Window`, add:

```astro
    <Window title="waddle-lab.exe" icon="rocket" status="Cabinet three.">
      <div class="cluster" style="justify-content: space-between; gap: 12px;">
        <p style="margin: 0;">
          <strong>Waddle Lab</strong> — drive the pugglenaut on a real robot's
          reinforcement-learning gait.
        </p>
        <HyperLink href="/lab">Open the Waddle Lab →</HyperLink>
      </div>
    </Window>
```

- [ ] **Step 5: Document it in `README.md`**

In the "What's on the site" list, after the `/game` entry, add:

```markdown
- **`/lab`** — "Waddle Lab": drive the pugglenaut with the real gait of
  [Microduck](https://github.com/pollen-robotics/microduck), a 25 cm bipedal
  robot. Joint motion is baked offline from the ONNX policies that ship on that
  robot and replayed on its exact skeleton by `src/lib/duck/`. The 3D rig is
  procedural Three.js (`src/lib/duck/pugglenaut.ts`) — no mesh assets. The
  island is `client:visible`, and nothing animates until you power it on.
```

Then add a new section before "Deployment":

```markdown
### Re-baking the duck motion

`public/duck/` is generated, not hand-written. To regenerate it you need
checkouts of [`microduck`](https://github.com/pollen-robotics/microduck) (for
`policies/*.onnx`) and
[`microduck_rl`](https://github.com/pollen-robotics/microduck_rl) (for the MJCF
model), plus [`uv`](https://docs.astral.sh/uv/). No GPU is needed — the bake
replays policies on CPU MuJoCo:

```bash
uv run --no-project --with mujoco --with onnxruntime --with numpy \
    scripts/bake-duck-motion.py \
    --microduck ../microduck --microduck-rl ../microduck_rl
```

That writes `public/duck/tree.json`, `public/duck/clips.json` and the
`src/lib/duck/fk-golden.json` test fixture. The site build never runs it and
does not depend on those checkouts.

Both upstream repos are Apache 2.0; their 3D models are CC BY-SA-NC, and this
site ships no upstream mesh data.
```

- [ ] **Step 6: Build and verify the route exists**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run build
ls dist/lab/index.html
npm test
```

Expected: build exits 0, `dist/lab/index.html` exists, all tests pass.

- [ ] **Step 7: Check the shipped payload**

```bash
du -sh dist/duck/ && du -sh dist/_astro/ | tail -1
```

Expected: `dist/duck/` well under 1 MB. Report the numbers.

- [ ] **Step 8: Commit**

```bash
git add src/pages/lab.astro src/components/StarMap.astro src/pages/game.astro README.md
git commit -m "Add the /lab page, navigation, and bake documentation"
```

---

### Task 12: Verify it in a browser

Tests prove the maths; they cannot prove the pugglenaut looks right. This task is the one that catches a duck walking on its face.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run dev
```

- [ ] **Step 2: Open `/lab` and power it up**

Use the `run` skill if a browser driver is available; otherwise ask the human partner to look. Check, in order:

1. The poster shows before power-up, and no WebGL canvas exists yet.
2. On power-up, a pugglenaut stands upright on the grid — helmet up, feet down, bill forward.
3. Holding `W` walks it forward with visible leg motion, and it goes the way it faces.
4. `←` / `→` turn it in place; then `W` drives along the new heading.
5. Each skill button plays a distinct motion and returns to standing.
6. `Space` opens the bill.
7. The badge reads `SIM: PLAYBACK` and fps is 50+.
8. Telemetry numbers change while driving.

- [ ] **Step 3: Fix what looks wrong, not what tests say**

Common failures and their causes:

| symptom | cause |
| --- | --- |
| pugglenaut lies flat or faces up | scene `up` is not Z; check `scene.up` and `camera.up` |
| legs bend backwards | joint sign, or `Rz` applied before `body.quat` in `pugglenaut.ts` |
| feet sink below the grid | `root.position.z` is not offset by `tree.trunkHeight` |
| head detached from body | the head extras are parented to the wrong link group |
| walks but slides without stepping | `blendGaits` is returning the standing clip; check `CMD_SCALE` |

- [ ] **Step 4: Re-run the full suite and commit any fixes**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm test && npm run build
```

- [ ] **Step 5: Report to the human partner**

State plainly what works, what does not, and the shipped byte count. Do not claim phase 1 is done without having seen it move.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the `DuckLink` contract and `DuckState` (Task 7); the fixed skeleton and its single constants module (Tasks 2, 5); procedural geometry in the mascot palette (Task 8); the bake, gait grid and skill clips (Tasks 2-4); phase-locked blending and root integration (Tasks 6-7); two clocks (Task 9); the gamepad-mirroring input, `PLAYBACK` badge and opt-in power control (Task 10); `/lab` as a new page with StarMap and arcade links (Task 11); FK-golden and pure-function tests (Tasks 3, 5, 6, 7, 8).

**Two deliberate improvements on the spec.** The spec proposed a foot-on-floor FK test; Task 3 replaces it with exact equivalence against MuJoCo's own `mj_kinematics`, which is strictly stronger and catches sign errors a floor test cannot. The spec also implied hand-written tree constants; Tasks 2 and 5 emit them programmatically instead, because `obs.rs` is explicit that a wrong offset fails silently.

**Deferred from the spec, intentionally.** The rig test asserting bone lengths equal `tree.ts` is subsumed by Task 8's FK-agreement test, which is stronger — it checks placement, not just lengths. XR, `SimLink` and `RtcLink` are phases 2-4 and out of scope here.

**Known soft spot.** Clip lengths may vary between gait grid points, in which case `NOMINAL_CYCLE` in `clipLink.ts` makes blending approximate. Task 4 Step 4 prints frame counts; if they differ materially across the grid, resample clips to a common frame count during the bake rather than patching the blender.
