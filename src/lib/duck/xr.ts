/**
 * WebXR entry, feature detection and placement maths for the Waddle Lab.
 *
 * Two facts drive everything in this file.
 *
 * First, **the lab scene is Z-up** because the Microduck MJCF is Z-up and the
 * rig is built in that frame (see `pugglenaut.ts`). WebXR is emphatically
 * Y-up: every reference space puts gravity along -Y, and Three.js writes the
 * headset's pose straight into the camera's matrix, so `camera.up` cannot be
 * used to fake it the way the desktop chase camera does. The fix is a single
 * rotation on a group that wraps the whole scene, computed once at placement
 * rather than per frame.
 *
 * Second, **the pugglenaut is authored in real metres** -- 0.25 m tall, the
 * real robot's height. That is the entire reason AR is worth doing here, and
 * it means there is no scale factor anywhere in this file. A scale factor
 * would be a bug.
 *
 * We deliberately do not use `three/examples/jsm/webxr/ARButton.js`. It does
 * import cleanly under Vite (the file has no imports at all and `@types/three`
 * ships a declaration for it), so that is not the objection. The objections
 * are behavioural: it appends a fixed-position button to `document.body` with
 * hard-coded inline styles that ignore the site's `--rp-*` tokens, it forces a
 * `dom-overlay` on you, it calls `navigator.xr.offerSession` unprompted, and it
 * requests no `hit-test`, which is the one feature this scene actually needs.
 * A button is cheaper to write than to fight.
 */

import * as THREE from 'three';

/** The two session modes the lab offers. */
export type LabXRMode = 'immersive-ar' | 'immersive-vr';

/** Which immersive modes this browser and device will actually grant. */
export interface XRSupport {
  ar: boolean;
  vr: boolean;
}

/** No XR at all: every desktop browser without a headset, and every test. */
export const NO_XR: XRSupport = { ar: false, vr: false };

/**
 * The sliver of `navigator.xr` we depend on.
 *
 * Declared structurally so the detection logic can be unit-tested against a
 * plain object, with no jsdom and no headset.
 */
export interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/**
 * Probe which immersive modes are available, without ever throwing.
 *
 * Three separate things can go wrong, and all three are normal rather than
 * exceptional: `navigator.xr` may be absent (any desktop browser), it may
 * exist but report the mode unsupported (Chrome on a phone with no ARCore),
 * or `isSessionSupported` may *reject* -- it does that for an insecure context
 * and for an `xr-spatial-tracking` permissions-policy denial. All three must
 * land on "no button", silently.
 */
export async function detectXRSupport(xr: XRSystemLike | undefined | null): Promise<XRSupport> {
  if (!xr || typeof xr.isSessionSupported !== 'function') return NO_XR;

  const probe = async (mode: LabXRMode) => {
    try {
      return (await xr.isSessionSupported(mode)) === true;
    } catch {
      return false;
    }
  };

  const [ar, vr] = await Promise.all([probe('immersive-ar'), probe('immersive-vr')]);
  return { ar, vr };
}

/**
 * AR session request.
 *
 * `hit-test` is optional, not required: asking for it as a required feature
 * would fail the whole session on a device that can do passthrough but not
 * plane detection, and we have a workable fallback (place at arm's length).
 * `local-floor` is also optional because the WebXR spec only guarantees
 * `viewer` and `local` for an immersive session -- see `resolveReferenceSpace`.
 */
export const AR_SESSION_INIT: XRSessionInit = {
  optionalFeatures: ['hit-test', 'local-floor'],
};

/** VR session request. No hit-test: the floor is virtual and we choose it. */
export const VR_SESSION_INIT: XRSessionInit = {
  optionalFeatures: ['local-floor'],
};

/**
 * Rotation from the lab's Z-up frame into WebXR's Y-up frame.
 *
 * -90 degrees about X: scene +Z (up) becomes XR +Y (up), scene +X (the rig's
 * forward at zero heading) stays XR +X, and scene +Y becomes XR -Z.
 *
 * Treat as read-only. It is a shared constant, not scratch space.
 */
export const Z_UP_TO_XR: THREE.Quaternion = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);

/** Assumed eye height when the device will not give us a floor. */
const DEFAULT_EYE_HEIGHT = 1.6;

/** How far in front of the viewer the VR pugglenaut stands, metres. */
export const VR_DISTANCE = 1.6;

/**
 * Pick a reference space, preferring one whose origin is on the floor.
 *
 * `local-floor` is not a default-enabled feature, so `requestReferenceSpace`
 * can reject even when the session started happily. Falling back to `local`
 * is not merely a courtesy: it is the difference between an AR session that
 * works on a fussy device and one that dies inside Three.js's `setSession`.
 */
export async function resolveReferenceSpace(
  session: Pick<XRSession, 'requestReferenceSpace'>,
): Promise<XRReferenceSpaceType> {
  try {
    await session.requestReferenceSpace('local-floor');
    return 'local-floor';
  } catch {
    return 'local';
  }
}

/**
 * Where the virtual floor sits, in the chosen reference space.
 *
 * `local-floor` puts its origin on the floor, so zero. `local` puts it
 * wherever the viewer's head was when the session began, so the floor is an
 * eye height below -- a guess, and flagged as one, but a much better guess
 * than zero, which would leave the pugglenaut standing in mid-air at face
 * height.
 */
export function floorHeight(spaceType: XRReferenceSpaceType): number {
  return spaceType === 'local-floor' ? 0 : -DEFAULT_EYE_HEIGHT;
}

/**
 * The yaw, about XR up, that turns the scene's +X toward the viewer.
 *
 * Purely horizontal: pitching the pugglenaut to look up at a tall user would
 * tip it off its feet. Returns 0 when the viewer is directly overhead, which
 * has no meaningful facing.
 */
export function yawToFace(anchor: THREE.Vector3, viewer: THREE.Vector3): number {
  const dx = viewer.x - anchor.x;
  const dz = viewer.z - anchor.z;
  if (dx === 0 && dz === 0) return 0;
  // A rotation of theta about +Y sends +X to (cos t, 0, -sin t), so the yaw
  // that points +X along (dx, dz) is atan2(-dz, dx).
  return Math.atan2(-dz, dx);
}

// Scratch, so placement allocates nothing. Placement runs on a tap rather
// than per frame, so this is tidiness rather than necessity -- but the same
// vectors are used by the frame loop's fallback path, which is why they live
// at module scope.
const scratchYaw = new THREE.Quaternion();
const scratchOffset = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Anchor the whole Z-up scene at a point in XR space.
 *
 * The subtlety is `characterX`/`characterY`: by the time the user taps, the
 * pugglenaut has usually walked some distance from the scene origin, and
 * anchoring the origin would drop it that same distance away from the reticle.
 * So we anchor the point *under its feet* instead. Solving
 * `world = position + rotation * scene` for `world(character) = anchor` gives
 * `position = anchor - rotation * (characterX, characterY, 0)`. The character's
 * own Z is excluded so it stands on the surface rather than sinking into it.
 *
 * From then on the link keeps integrating world motion exactly as on the
 * desktop, so the pugglenaut walks around the anchor with no XR-specific
 * playback code at all.
 */
export function placeContent(
  group: THREE.Object3D,
  anchor: THREE.Vector3,
  yaw: number,
  characterX: number,
  characterY: number,
): void {
  scratchYaw.setFromAxisAngle(yAxis, yaw);
  group.quaternion.copy(scratchYaw).multiply(Z_UP_TO_XR);
  scratchOffset.set(characterX, characterY, 0).applyQuaternion(group.quaternion);
  group.position.copy(anchor).sub(scratchOffset);
  group.updateMatrixWorld(true);
}

/**
 * Return the content group to its desktop identity transform.
 *
 * Called on session end, so the flat view is exactly as it was: Z-up, at the
 * origin, unrotated.
 */
export function resetContent(group: THREE.Object3D): void {
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.updateMatrixWorld(true);
}
