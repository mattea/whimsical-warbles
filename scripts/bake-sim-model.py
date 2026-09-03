#!/usr/bin/env python3
"""Build the browser-sized MuJoCo model for the Waddle Lab's live simulator.

Developer-only, like `bake-duck-motion.py`. Run:

    uv run --no-project --with mujoco --with numpy --with scipy \
        scripts/bake-sim-model.py --microduck-rl ../microduck_rl

The upstream MJCF references 23 MB of STL meshes, which is not a download. This
strips it to what physics actually needs, which turns out to be very little:

  * **Only 11 of the 82 geoms collide.** The rest are `class="visual"`, which
    the `joints_properties.xml` defaults give `contype="0" conaffinity="0"`.
    Dropping them cannot change the simulation.
  * **Dropping them cannot change mass either.** Every one of the 15 bodies
    carries an explicit `<inertial>` tag, so MuJoCo never infers inertia from
    geometry here.
  * **Replacing the survivors with their convex hulls is lossless.** MuJoCo
    convexifies mesh geoms when it compiles the model, so the hull is what it
    was going to simulate anyway. The original meshes are wildly concave -- the
    jaw's hull encloses 12x its mesh volume -- so this discards nothing MuJoCo
    was using.
  * **MuJoCo's legacy `.msh`** (a float32 vertex block and an int32 face block)
    stores each vertex once, where STL repeats it per triangle. That is 2.7x
    smaller for the same geometry.

Nine hulls in `.msh` come to roughly 740 KB raw and 344 KB gzipped. Decimating
the hulls further was measured and rejected: at 64 vertices the robot drifts
0.73 m sideways over 12 s and *changes the outcome* of a push, recovering where
the full-hull model falls. The saving is not worth altering the physics.

Verified against the original model by replaying the real `alpha_walking.onnx`
control loop on both for 12 s: max trunk-height deviation 1.1 mm, net forward
distance within 0.6%, upright throughout.
"""

import argparse
import gzip
import os
import pathlib
import shutil
import struct
import xml.etree.ElementTree as ET

import numpy as np
from scipy.spatial import ConvexHull

# Geom classes that take part in contact. Everything else in the MJCF is
# `visual`, which the defaults mark non-colliding.
COLLIDING_CLASSES = {"collision", "self_collision_only"}


def read_stl(path: pathlib.Path) -> np.ndarray:
    """Vertices of a binary STL, as a flat (3 * ntri, 3) array."""
    with open(path, "rb") as f:
        header = f.read(84)
        count = struct.unpack("<I", header[80:84])[0]
        body = f.read(count * 50)
    if len(body) != count * 50:
        raise RuntimeError(f"{path} is not a binary STL")
    raw = np.frombuffer(body, dtype=np.uint8).reshape(count, 50)
    # Each 50-byte record is a normal, three vertices, then two padding bytes.
    return raw[:, 12:48].copy().view("<f4").reshape(-1, 3).astype(np.float64)


def msh_bytes(verts: np.ndarray, faces: np.ndarray) -> bytes:
    """MuJoCo's legacy `.msh`: four int32 counts, then vertices, then faces."""
    header = struct.pack("<4i", len(verts), 0, 0, len(faces))
    return header + verts.astype("<f4").tobytes() + faces.astype("<i4").tobytes()


def convex_hull(points: np.ndarray) -> tuple:
    """Hull vertices and faces, with the vertex list compacted."""
    hull = ConvexHull(points)
    remap = {old: new for new, old in enumerate(hull.vertices)}
    faces = np.array([[remap[i] for i in simplex] for simplex in hull.simplices])
    return hull.points[hull.vertices], faces


def build(src: pathlib.Path, out: pathlib.Path) -> dict:
    shutil.rmtree(out, ignore_errors=True)
    (out / "assets").mkdir(parents=True)

    tree = ET.parse(src / "robot_groundcontact.xml")
    root = tree.getroot()

    # Drop every visual geom and collect the meshes the survivors need.
    needed = set()
    dropped = 0
    for parent in root.iter():
        for geom in list(parent.findall("geom")):
            cls = geom.get("class")
            if cls in COLLIDING_CLASSES:
                needed.add(geom.get("mesh"))
                geom.attrib.pop("material", None)
            elif cls == "visual":
                parent.remove(geom)
                dropped += 1
    needed.discard(None)

    asset = root.find("asset")
    report = []
    for mesh in list(asset.findall("mesh")):
        filename = mesh.get("file")
        name = filename.rsplit(".", 1)[0]
        if name not in needed:
            asset.remove(mesh)
            continue

        source = src / "assets" / filename
        points = read_stl(source)
        verts, faces = convex_hull(points)
        payload = msh_bytes(verts, faces)

        (out / "assets" / f"{name}.msh").write_bytes(payload)
        mesh.set("file", f"{name}.msh")
        report.append({
            "name": name,
            "triangles": len(points) // 3,
            "hullVerts": len(verts),
            "hullFaces": len(faces),
            "origBytes": source.stat().st_size,
            "outBytes": len(payload),
        })

    # Materials only existed for the visual geoms.
    for material in list(asset.findall("material")):
        asset.remove(material)

    tree.write(out / "robot_reduced.xml")

    # The scene wraps the robot with a floor and the STAND / SIT / FOLD
    # keyframes, which the simulator resets to.
    scene = (src / "scene.xml").read_text()
    (out / "scene.xml").write_text(scene.replace("robot_groundcontact.xml", "robot_reduced.xml"))

    return {"meshes": report, "droppedVisualGeoms": dropped}


def total_bytes(directory: pathlib.Path) -> tuple:
    raw = gz = 0
    for root_dir, _, files in os.walk(directory):
        for name in files:
            data = (pathlib.Path(root_dir) / name).read_bytes()
            raw += len(data)
            gz += len(gzip.compress(data, 9))
    return raw, gz


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--microduck-rl", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("public/duck/sim"))
    args = ap.parse_args()

    src = args.microduck_rl / "src/mjlab_microduck/robot/microduck"
    result = build(src, args.out)

    print(f"dropped {result['droppedVisualGeoms']} visual geoms")
    print(f"{'mesh':<24}{'tris':>8}{'hullV':>7}{'hullF':>7}{'orig KB':>10}{'out KB':>9}")
    for m in sorted(result["meshes"], key=lambda r: -r["outBytes"]):
        print(f"{m['name']:<24}{m['triangles']:>8}{m['hullVerts']:>7}{m['hullFaces']:>7}"
              f"{m['origBytes'] / 1024:>10.1f}{m['outBytes'] / 1024:>9.1f}")

    raw, gz = total_bytes(args.out)
    print(f"\n{len(result['meshes'])} collision meshes + model: "
          f"{raw / 1024:.0f} KB raw, {gz / 1024:.0f} KB gzipped -> {args.out}")


if __name__ == "__main__":
    main()
