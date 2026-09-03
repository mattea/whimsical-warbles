# Driving a real Microduck from the Waddle Lab

Date: 2026-09-03 · Status: **blocked on transport**, design recorded

## Why this page exists

The Waddle Lab was built around one contract, `DuckLink`, precisely so the
console could later drive real hardware without being rewritten. Three backends
were planned: baked clips, live simulation, and a real robot over WebRTC. The
first two are built. This page records why the third is not, because the
obstacle is not effort and someone will otherwise try it and lose an afternoon.

The short version: **a page served from `https://pugglenaut.com` cannot reach a
Microduck on your LAN**, and no amount of client-side work changes that.

## What upstream provides

The robot already runs everything needed on its side, and it is good:

- `mediad` serves a console over plain HTTP on port 8080 and runs a WebRTC
  signalling server on 8443 (`docs/design/webrtc-console.md`).
- A `control` datachannel arrives alongside the video, and `mediad/src/route.rs`
  permits exactly the vocabulary this console already speaks: `move`, `head`,
  `look`, `pose`, `mouth`, `do`, `sound`, `enable`, `init`, `relax`, `stop`,
  `subscribe`, and `pad.input`.
- It is proven on hardware — a Radxa Zero 3W streaming through the hardware
  encoder to a browser on the LAN, as of 2026-08-25.

So `DuckState` already matches: `gyro` and `gravity` are observation slots 0..3
and 3..6, which is what `robot.subscribe` reports. The telemetry panel written
for phase 1 would display real sensors unchanged.

## The blocker: mixed content

Signalling is `ws://<robot>:8443`, and the robot has no TLS. Browsers refuse an
insecure WebSocket from a secure origin, so an HTTPS page cannot open it. This
is not a policy that can be relaxed per-site; there is no user-facing override.

Upstream sidesteps it by serving the console *from the robot*, over `http://`,
which also makes the origin private and dodges Private Network Access — their
design page records both traps explicitly, including that a `file://` page
failed for the same family of reason.

GitHub Pages serves this site over HTTPS with HSTS. There is no `http://`
version to fall back to, and there should not be.

## The second problem: there is no authorisation

`remote-webrtc.md` §4 is titled *"Authorisation: none on the robot, and why
that holds both locally and remotely"*. Any peer that reaches the signalling
server can start a session and drive the robot. The BLE pairing PIN is a shared
`000000`, which as that page says "authenticates nobody".

Upstream's reasoning is sound for their threat model — authorisation lives in
the bridge for remote access, and locally you are on your own LAN. But it means
a public web page that could reach robots would be a genuinely bad idea, not
merely an awkward one. Any design here has to be opt-in, explicit, and local.

## Three ways it could work

### 1. Serve the console from the robot (simplest, and upstream's own answer)

Build the lab as a static bundle and let `mediad` serve it, or serve it from a
laptop on the same network over `http://localhost`. Same origin as the
signalling target, no TLS needed, no mixed content.

Cost: it is no longer *this website*. It is a separate artifact that happens to
share code. Astro can produce it — the lab is already a self-contained island —
but `/lab` on pugglenaut.com would still only offer playback and simulation.

This is the honest option and the one to build first if hardware appears.

### 2. Tailscale, for TLS without a public endpoint

A tailnet can issue a real certificate for a `*.ts.net` name
(`tailscale cert`, or `tailscale serve` terminating TLS). With the robot on the
tailnet behind a valid cert, `wss://duck.<tailnet>.ts.net` is a secure
WebSocket, and an HTTPS page may open it. Cross-origin, but WebSocket is not
subject to CORS in the way `fetch` is, and the datachannel rides the same
session.

This is the only route that keeps the console on pugglenaut.com. It needs:
- the robot joined to the tailnet, with `tailscale serve` in front of 8443;
- the visitor also on the tailnet — so it is a private feature, not a public
  one, which is the correct shape given §4 above;
- a UI that asks for the robot's hostname rather than discovering it, since
  nothing on a public page should be scanning a private network.

Worth doing only if the robot is going to live on the tailnet anyway.

### 3. A local bridge

A small process on the visitor's machine that terminates TLS locally and
forwards to the robot. Works, and is what several vendor tools do. It is also a
piece of software to install, sign and maintain, for one page. Not worth it
here.

## What it would take once transport is solved

The remaining work is genuinely small, which is the point of having built the
contract first:

- `src/lib/duck/rtcLink.ts` — a `DuckLink` whose methods JSON-RPC over the
  datachannel and whose `subscribe` forwards `robot.subscribe` notifications.
  `health` reports `'real'`.
- Session setup: list producers via the signalling server, start a session,
  wait for the `control` channel.
- A deadman: `robotd` stops the robot when intents stop arriving, so the
  console must re-send the held command every tick rather than only on change.
  The existing console already drives from held keys, so this is a small change.
- The video track is a bonus — `mediad` streams the head camera, and the lab
  already has a canvas to put it behind.

Deliberately unbuilt for now: writing an untestable transport against hardware
that is not here would produce code that looks finished and has never once run.

## What the simulator gives us in the meantime

The fall detection the live simulator uses keys off `-gravity[2]`, projected
gravity's z in the trunk frame — observation slot 5. That is a signal the real
robot produces too, so the recovery logic is not sim-only scaffolding: it is the
same rule that would run against hardware.
