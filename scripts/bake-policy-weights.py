#!/usr/bin/env python3
"""Extract Microduck policy weights for the browser.

Developer-only, like the other bake scripts. Run:

    uv run --no-project --with onnx --with numpy \
        scripts/bake-policy-weights.py --microduck ../microduck

Every shipped policy is the same tiny network: an input normalizer baked into
the graph, then a four-layer MLP with ELU activations.

    Sub(obs, mean) -> Div(_, std)
      -> Gemm 61->512  -> Elu
      -> Gemm 512->256 -> Elu
      -> Gemm 256->128 -> Elu
      -> Gemm 128->14

Nine nodes and 197,896 parameters. Running that in the browser does not need an
inference runtime: `onnxruntime-web` would add a 14 MB wasm (3.4 MB gzipped) to
evaluate four matrix multiplies. So the weights are extracted to a flat float32
blob and `src/lib/duck/mlp.ts` does the forward pass directly, which is exactly
as accurate and costs nothing but the weights themselves.

Weights stay float32. They gzip to the same size the `.onnx` file does, so
there is nothing to win by re-encoding, and float16 was rejected: three decimal
digits accumulated across 512-wide sums is the kind of small numeric change
that alters a gait without failing anything loudly.

This script REFUSES a graph it does not recognise. That refusal is the point --
if upstream retrains with a different architecture, the bake fails with a
message naming what it found, rather than the site silently mis-running a
network whose shape it guessed.

Correctness is not taken on trust: `src/lib/duck/mlp.test.ts` checks the
TypeScript forward pass against `policy-golden.json`, which was produced by
real `onnxruntime` running these same graphs.
"""

import argparse
import json
import pathlib
import struct

import numpy as np
import onnx
from onnx import numpy_helper

# The exact node sequence every alpha policy has. Anything else is refused.
EXPECTED_OPS = ["Sub", "Div", "Gemm", "Elu", "Gemm", "Elu", "Gemm", "Elu", "Gemm"]

# Initializers in the order the blob stores them.
BLOB_ORDER = [
    "obs_normalizer._mean",
    "onnx::Div_24",
    "mlp.0.weight",
    "mlp.0.bias",
    "mlp.2.weight",
    "mlp.2.bias",
    "mlp.4.weight",
    "mlp.4.bias",
    "mlp.6.weight",
    "mlp.6.bias",
]

EXPECTED_SHAPES = {
    "obs_normalizer._mean": (1, 61),
    "onnx::Div_24": (1, 61),
    "mlp.0.weight": (512, 61),
    "mlp.0.bias": (512,),
    "mlp.2.weight": (256, 512),
    "mlp.2.bias": (256,),
    "mlp.4.weight": (128, 256),
    "mlp.4.bias": (128,),
    "mlp.6.weight": (14, 128),
    "mlp.6.bias": (14,),
}

# Which policies the lab needs, and which of them the browser fetches up front.
#
# The walk drives it and the stand is what gets it back on its feet -- the
# walking policy cannot do that on its own, and from a fallen state it stays
# down indefinitely. Those two are the whole fall-and-recover story, so they
# load with the simulator.
#
# The rest are skills, fetched only when someone asks for one. 773 KB each is
# not worth spending on a kick nobody presses.
POLICIES = [
    ("walk", "alpha_walking.onnx", True),
    ("stand", "alpha_stand.onnx", True),
    ("sitstand", "alpha_sitstand.onnx", False),
    ("ground_pick", "alpha_ground_pick.onnx", False),
    ("kick_left", "ball_kick_left.onnx", False),
    ("kick_right", "ball_kick_right.onnx", False),
    ("roulade", "roulade.onnx", False),
]


def extract(path: pathlib.Path) -> tuple:
    model = onnx.load(str(path))
    ops = [n.op_type for n in model.graph.node]
    if ops != EXPECTED_OPS:
        raise SystemExit(
            f"{path.name}: unrecognised graph.\n"
            f"  expected {EXPECTED_OPS}\n"
            f"  found    {ops}\n"
            "The browser-side forward pass in src/lib/duck/mlp.ts implements the "
            "expected sequence only. Update both together, or this bake will keep "
            "refusing -- which is the intent."
        )

    weights = {i.name: numpy_helper.to_array(i) for i in model.graph.initializer}
    missing = [n for n in BLOB_ORDER if n not in weights]
    if missing:
        raise SystemExit(f"{path.name}: missing initializers {missing}")

    for name, want in EXPECTED_SHAPES.items():
        got = tuple(weights[name].shape)
        if got != want:
            raise SystemExit(f"{path.name}: {name} has shape {got}, expected {want}")

    # The normalizer divides by this, so a zero would produce infinities on a
    # slot that happens to be constant in training.
    std = weights["onnx::Div_24"]
    if not np.all(np.isfinite(std)) or np.any(std == 0):
        raise SystemExit(f"{path.name}: normalizer std has a zero or non-finite entry")

    blob = b"".join(
        np.ascontiguousarray(weights[name], dtype="<f4").tobytes() for name in BLOB_ORDER
    )
    return blob, sum(int(np.prod(EXPECTED_SHAPES[n])) for n in BLOB_ORDER)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--microduck", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("public/duck/policies"))
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {
        "layout": BLOB_ORDER,
        "shapes": {k: list(v) for k, v in EXPECTED_SHAPES.items()},
        "dtype": "float32-le",
        "policies": {},
    }

    for slot, filename, eager in POLICIES:
        src = args.microduck / "policies" / filename
        blob, params = extract(src)
        target = args.out / f"{slot}.bin"
        target.write_bytes(blob)
        manifest["policies"][slot] = {
            "source": filename,
            "params": params,
            "bytes": len(blob),
            "eager": eager,
        }
        when = "up front" if eager else "on demand"
        print(f"{slot:<12} {filename:<24} {params:>8,} params  "
              f"{len(blob) / 1024:>7.1f} KB  {when}")

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
