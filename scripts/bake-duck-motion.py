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
