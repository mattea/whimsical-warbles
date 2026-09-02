# Waddle Lab — a Microduck-driven pugglenaut in the browser

Date: 2026-09-02 · Status: approved, not yet implemented

## What this is

A teleop console at `/lab`. A 3D pugglenaut — the site's baby-platypus astronaut —
stands on a floor, and you drive it: walk, turn, kick, roll, sit, get up. Its
motion is not animated by hand. It is the real gait of
[Microduck](https://github.com/pollen-robotics/microduck), a 25 cm bipedal robot,
produced by the reinforcement-learning policies that robot actually ships.

The near-term version is fun. The architecture is chosen so the same page can
later drive a physics simulation, and later still drive a real robot on a desk,
without rewriting the console.

## Why it can be faithful

Two upstream repos, both Apache 2.0 (3D models CC BY-SA-NC — this site is
non-commercial):

- **`pollen-robotics/microduck`** — the robot's onboard runtime, in Rust. Ships
  nine trained policies as ONNX in `policies/`, ~790 KB each: walking, standing,
  sit/stand, ground pick, two ball kicks, roulade, and two roller modes. Every
  one is `obs[1,61] -> actions[1,14]`.
- **`pollen-robotics/microduck_rl`** — the training side: mjlab/MuJoCo + PPO, and
  the MJCF robot models.

Three upstream facts make this tractable rather than guesswork:

1. **The observation contract is documented index by index** in
   `duck-control/src/obs.rs`: 3 gyro, 3 projected gravity, 14 joint positions
   relative to the home pose, 14 joint velocities, 14 previous actions, 13
   command. That file also records which parts are easy to get wrong — body x, y
   and yaw are nominally zero, head targets ride in the command rather than being
   added on top of the policy output, and the body block is ordered `z, roll,
   pitch`.
2. **The control loop is five lines**, from `robotd/src/control.rs`:
   `targets = home_pose + action_scale * action`, at 50 Hz, `action_scale = 0.9`
   (`1.0` while standing). The home pose is a literal array in
   `duck-control/src/model.rs`. The observation normalizer is baked into the ONNX
   graph.
3. **A browser already talks to this robot.** `docs/design/webrtc-console.md`
   describes a console served by the robot itself, and its `route.rs` permits
   exactly `move`, `head`, `look`, `pose`, `mouth`, `do`, `sound`, `enable`,
   `init`, `relax`, `stop`, `subscribe` and `pad.input` over a WebRTC
   datachannel.

Point 3 is why the fun version is not a throwaway: the command vocabulary this
console needs in order to be a toy is the same vocabulary that drives hardware.

## Architecture: one contract, three backends

The console never knows what is moving the pugglenaut. Everything goes through
one interface, named after the methods `route.rs` permits:

```ts
interface DuckLink {
  move(twist: { vx: number; vy: number; vyaw: number }): void
  head(pose: { neck: number; pitch: number; yaw: number; roll: number }): void
  do(skill: Skill): void
  pose(body: { z: number; roll: number; pitch: number }): void
  mouth(open: number): void
  stop(): void
  subscribe(cb: (s: DuckState) => void): () => void  // 50 Hz
}

type Skill =
  | 'ground_pick' | 'roulade' | 'kick_left' | 'kick_right' | 'sit' | 'stand'

interface DuckState {
  joints: Float32Array   // 14, radians, absolute
  root: { pos: [number, number, number]; quat: [number, number, number, number] }
  gyro: [number, number, number]
  gravity: [number, number, number]  // projected gravity, trunk frame
  health: 'playback' | 'live' | 'real'
}
```

`DuckState` is deliberately the robot's own vocabulary: `gyro` and `gravity` are
observation slots 0..3 and 3..6 verbatim. A telemetry panel written against it
today displays real robot sensors in phase 4 with no changes.

| phase | backend | what moves the pugglenaut | payload |
| --- | --- | --- | --- |
| 1 | `ClipLink` | baked trajectories, blended | ~60 KB |
| 3 | `SimLink` | mujoco-wasm + the shipped ONNX policy | ~15-25 MB, lazy |
| 4 | `RtcLink` | a real Microduck over WebRTC | ~0 |

## The skeleton is fixed; only the skin is ours

`robot_walk.xml` gives a 15-body tree with 14 hinges, in exactly the policy's
action order, all dimensions in metres:

```
trunk_base                                                   freejoint, z = 0.12
├─ left leg    hip_yaw -> hip_roll -> hip_pitch -> knee -> ankle    actions 0-4
├─ neck/head   neck_pitch -> head_pitch -> head_yaw -> head_roll    actions 5-8
└─ right leg   hip_yaw -> hip_roll -> hip_pitch -> knee -> ankle    actions 9-13
```

**Link offsets are copied exactly and must not drift.** A baked joint angle is
only meaningful on the tree it was recorded on; changing a bone length silently
degrades the gait rather than breaking anything visibly. The offsets live in one
constants module, shared by the renderer and by the forward-kinematics test, so
the two cannot disagree.

Nothing about that tree is duck-shaped, which is what makes the mascot swap
cheap. The pugglenaut is **styling on Microduck proportions** — a 25 cm baby
platypus in a suit is a plausible shape, so this costs nothing visually.

Three things make the transfer lucky rather than laboured:

- A platypus has a bill, so the head chain transfers almost unchanged.
- Microduck joint 9 is the mouth. It is excluded from every policy and driven
  directly by `robot.mouth` over -5 deg to +30 deg, so an opening bill is already
  a first-class command.
- A duck's trained gait on a platypus reads as a waddle, which is what a platypus
  should do anyway.

### Geometry is procedural, not an asset

The rig is ~15 link definitions of scaled ellipsoids, capsules and boxes built in
TypeScript, in the mascot's established palette (from `public/favicon.svg` and
`src/components/BoopMascot.tsx`):

| part | colour |
| --- | --- |
| body | `#cbb27a`, stroked `#8f7a45` |
| bill | `#3a3140` |
| helmet | `rgba(255,255,255,0.16)`, rim `rgba(255,255,255,0.85)`, plus a glint arc |
| eye | `#20202a`, catchlight `#f7f4ea` |
| flame | `#ffcf33` |

The existing mascot is drawn as stacked ellipses with thick strokes, which is
already 3D primitives in two dimensions. Going procedural means zero asset bytes,
no mesh decimation, no Draco, no Blender, colours that follow `--rp-*` theme
tokens like the rest of the site, and roughly 30 primitives — a frame budget that
survives 90 Hz stereo in phase 2.

Non-articulated extras (tail, helmet bubble, jetpack, flame) are parented to the
trunk. The tail sways off gait phase; that sway is decorative and labelled as
such, not passed off as policy output.

A Microduck skin is a phase-4 concern, when seeing the real hardware matters. Not
built now.

## Phase 1: the bake

Run offline on a development machine, never at site build time. The site does not
depend on a checkout of either upstream repo.

`scripts/bake-duck-motion.py` drives the real control loop headless through
`uv run --no-project --with mujoco --with onnxruntime --with numpy`. That import
set is the whole dependency: `microduck_rl`'s own `scripts/infer_policy.py`
imports only numpy, mujoco and onnxruntime, with no mjlab and no CUDA, so the
GPU training stack is not needed to replay a policy.

The script is committed, so the output is reproducible rather than magic.

This toolchain is **verified**, not assumed. On a machine with no CUDA and no
`microduck_rl` sync, the above installs mujoco 3.12.0 and onnxruntime 1.29.0 and
loads both the scene and a policy:

```
scene.xml            nq 21 (7 freejoint + 14 joints) · nu 14 · timestep 0.002
alpha_walking.onnx   obs[1,61] -> actions[1,14]
```

Physics runs at 0.002 s, so a 50 Hz control tick is **10 physics steps**.

**Locomotion clips.** Sweep a grid of steady velocity commands — `vx` in
`{-0.15, 0, 0.15, 0.3}`, `vy` in `{-0.1, 0, 0.1}`, `vyaw` in `{-1, 0, 1}` — let
each settle, then capture exactly one gait cycle with its phase marked.

**Skill clips.** One capture each for kick left, kick right, roulade, ground pick,
sit and stand, as one-shots.

Each frame is 14 joint angles plus the root transform, quantized to int16 across
known joint limits. A gait cycle at 50 Hz is about 30 frames, roughly 900 bytes.
36 gait clips plus 6 skills lands near 40-60 KB total, committed to `public/duck/`.

### Making playback feel like driving

The live command selects the nearest clips and cross-fades them **phase-locked**,
matching position within the gait cycle so feet do not teleport mid-stride. World
position and heading integrate from the command being held. Skills interrupt, play
once, and hand back to locomotion.

**What phase 1 cannot do:** fall over, be knocked down, or kick a ball that
reacts. There is no physics, only recorded motion. That absence is exactly what
phase 2 buys, so the UI states which mode it is in — a `PLAYBACK` / `LIVE` badge —
rather than papering over it.

## Phase 1: the browser runtime

Four units behind `DuckLink`, each independently testable:

| unit | responsibility | depends on |
| --- | --- | --- |
| `src/lib/duck/clipLink.ts` | load clips, phase-locked blend, integrate root motion, run skill one-shots | clip data |
| `src/lib/duck/pugglenaut.ts` | build the primitive rig; `apply(joints, root)` -> transforms | three, tree constants |
| `src/components/LabScene.tsx` | camera, floor, lights, render loop; later the XR button | three, `pugglenaut` |
| `src/components/LabConsole.tsx` | input -> `DuckLink` calls; telemetry readout | `DuckLink` |

`src/lib/duck/tree.ts` holds the link offsets, joint axes, home pose and joint
limits — the numbers copied from upstream, in one place.

**Two clocks.** Control advances at a fixed 50 Hz, the robot's real rate. Render
runs at display rate and interpolates between control ticks. That split is what
lets phase 2 hit 90 Hz stereo without touching `clipLink`.

**Input** mirrors the upstream gamepad table so muscle memory transfers: WASD or
the left stick drives, arrows or the right stick turn, and `A` / `X` / `LB` / `RB`
/ D-pad-down map to ground pick / roulade / kicks / sit-stand. A real gamepad
works through the Gamepad API.

**Opt-in.** `three` is around 150 KB gzipped, and this site's rule is that nothing
animated runs by default. So `/lab` shows a still blueprint poster until you press
a power button, following the existing ControlDeck pattern. Honours
`prefers-reduced-motion`.

`/lab` is a new page, linked from the StarMap and from `/game`.

## Later phases

- **Phase 2 — XR.** `renderer.xr.enabled`, plus an AR hit-test to place a
  real-scale 25 cm pugglenaut on a desk. Touches `LabScene` only. Deliberately
  ordered before the physics simulation: AR playback is much cheaper than AR plus
  WASM physics, and it is the bigger payoff.
- **Phase 3 — real simulation.** Add `simLink.ts`. `mujoco` (the DeepMind WASM
  build on npm) loads the MJCF; `onnxruntime-web` runs the shipped policy; the
  61-slot observation from `obs.rs` is built in roughly 40 lines. Lazy-loaded
  behind an explicit control. Now it falls, recovers, and kicks a ball that
  reacts. Renderer and console unchanged.
- **Phase 4 — real robot.** Add `rtcLink.ts`, speaking the WebRTC datachannel
  `remote-webrtc.md` defines. The console drives hardware and the phase-1
  telemetry panel shows real sensors, because `DuckState` was the robot's
  vocabulary from the start.

## Testing

Clip blending and root integration are pure functions, unit-tested headlessly
with no WebGL.

The bake gets a golden test: replay a recorded clip through forward kinematics and
assert the stance foot stays within a millimetre of the floor. This is aimed
squarely at joint-order and sign errors, which `obs.rs` warns are silent — they
produce a plausible-looking robot that falls over, and the symptom reads as a
tuning problem rather than an indexing one.

A rig test asserts the pugglenaut's bone lengths equal the values in `tree.ts`,
so styling changes cannot quietly retarget the skeleton.

## Risks

1. **Blended gaits may foot-skate** when cross-fading between distant commands.
   Phase-locking and a denser grid reduce it; only real physics removes it.
2. **Retarget drift.** If the pugglenaut's proportions wander from the Microduck's,
   the gait degrades subtly rather than obviously. Guarded by the single
   constants module and the rig test.
3. ~~**The bake toolchain must work headless.**~~ **Retired.** Verified before any
   site code was written: mujoco and onnxruntime install and run headless with no
   CUDA, the scene loads with the expected dimensions, and the policy graph is
   `[1,61] -> [1,14]` as documented.

## Out of scope

Training in the browser. Reinforcement learning for a 61-dimensional biped needs a
GPU and hours; it is not a page. The practical path to "personal robotics
training" is phases 3 and 4 — the site becomes the console and the viewer for
policies trained elsewhere, including ones published to the Hugging Face Hub by
`microduck_rl`'s `publish` command.
