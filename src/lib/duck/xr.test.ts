import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  AR_SESSION_INIT,
  arSessionInit,
  detectXRSupport,
  floorHeight,
  placeContent,
  resetContent,
  resolveReferenceSpace,
  VR_DISTANCE,
  VR_SESSION_INIT,
  yawToFace,
  Z_UP_TO_XR,
} from './xr';

/**
 * What is testable here is the arithmetic and the feature detection: both are
 * pure, and both are exactly where a silent error would hide. A wrong frame
 * conversion produces a pugglenaut lying on its side, which is precisely the
 * class of bug the golden FK test exists for on the playback side.
 *
 * What is NOT testable without hardware: that a real headset reports the modes
 * we probe for, that `requestHitTestSource` returns usable results, and that
 * the render loop actually runs at the headset's rate. Those are called out in
 * the handover notes rather than faked here.
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('detectXRSupport', () => {
  it('reports nothing when navigator.xr is absent', async () => {
    // The desktop case, and the headless-browser case. Must not throw.
    expect(await detectXRSupport(undefined)).toEqual({ ar: false, vr: false });
    expect(await detectXRSupport(null)).toEqual({ ar: false, vr: false });
  });

  it('reports nothing when navigator.xr exists but is the wrong shape', async () => {
    expect(await detectXRSupport({} as never)).toEqual({ ar: false, vr: false });
  });

  it('reports each mode independently', async () => {
    const xr = {
      isSessionSupported: vi.fn(async (mode: string) => mode === 'immersive-ar'),
    };
    expect(await detectXRSupport(xr)).toEqual({ ar: true, vr: false });
    expect(xr.isSessionSupported).toHaveBeenCalledWith('immersive-ar');
    expect(xr.isSessionSupported).toHaveBeenCalledWith('immersive-vr');
  });

  it('treats a rejected probe as unsupported', async () => {
    // Chrome rejects isSessionSupported outright on an insecure origin and
    // under an xr-spatial-tracking permissions-policy denial.
    const xr = {
      isSessionSupported: vi.fn(async () => {
        throw new DOMException('denied', 'SecurityError');
      }),
    };
    expect(await detectXRSupport(xr)).toEqual({ ar: false, vr: false });
  });

  it('treats a non-boolean answer as unsupported', async () => {
    const xr = { isSessionSupported: vi.fn(async () => 'yes' as unknown as boolean) };
    expect(await detectXRSupport(xr)).toEqual({ ar: false, vr: false });
  });
});

describe('session init', () => {
  it('asks for hit-test optionally, never as a requirement', () => {
    // Required features fail the whole session, and passthrough without plane
    // detection is still worth having.
    expect(AR_SESSION_INIT.optionalFeatures).toContain('hit-test');
    expect(AR_SESSION_INIT.requiredFeatures ?? []).toEqual([]);
    expect(VR_SESSION_INIT.requiredFeatures ?? []).toEqual([]);
  });
});

describe('resolveReferenceSpace', () => {
  it('prefers local-floor', async () => {
    const session = { requestReferenceSpace: vi.fn(async () => ({}) as XRReferenceSpace) };
    expect(await resolveReferenceSpace(session)).toBe('local-floor');
    expect(session.requestReferenceSpace).toHaveBeenCalledWith('local-floor');
  });

  it('falls back to local when local-floor is not granted', async () => {
    const session = {
      requestReferenceSpace: vi.fn(async () => {
        throw new Error('not enabled');
      }),
    };
    expect(await resolveReferenceSpace(session)).toBe('local');
  });
});

describe('floorHeight', () => {
  it('is zero in local-floor', () => {
    expect(floorHeight('local-floor')).toBe(0);
  });

  it('is an eye height below the origin in local', () => {
    // `local` origin sits at the head, so the floor must be guessed.
    expect(floorHeight('local')).toBeCloseTo(-1.6, 6);
  });
});

describe('Z_UP_TO_XR', () => {
  it('maps scene up onto XR up', () => {
    const up = v(0, 0, 1).applyQuaternion(Z_UP_TO_XR);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(1, 6);
    expect(up.z).toBeCloseTo(0, 6);
  });

  it('leaves the rig forward along XR +X', () => {
    const forward = v(1, 0, 0).applyQuaternion(Z_UP_TO_XR);
    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

  it('is a pure rotation, so real metres stay real metres', () => {
    const p = v(0.3, -0.2, 0.25);
    expect(p.clone().applyQuaternion(Z_UP_TO_XR).length()).toBeCloseTo(p.length(), 9);
  });
});

describe('yawToFace', () => {
  it('turns the rig toward a viewer straight ahead of the anchor', () => {
    // Viewer at the XR origin, anchor 1.6 m along -Z: the rig must face +Z.
    const yaw = yawToFace(v(0, 0, -1.6), v(0, 0, 0));
    const facing = v(1, 0, 0).applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    );
    expect(facing.x).toBeCloseTo(0, 6);
    expect(facing.z).toBeCloseTo(1, 6);
  });

  it('needs no rotation when the viewer is already along +X', () => {
    expect(yawToFace(v(0, 0, 0), v(2, 1.5, 0))).toBeCloseTo(0, 9);
  });

  it('ignores height, so the rig never pitches off its feet', () => {
    expect(yawToFace(v(0, 0, -1), v(0, 0.1, 0))).toBeCloseTo(yawToFace(v(0, 0, -1), v(0, 9, 0)), 9);
  });

  it('returns zero for a viewer directly overhead', () => {
    expect(yawToFace(v(1, 0, -1), v(1, 2, -1))).toBe(0);
  });
});

describe('placeContent', () => {
  it('puts the character at the anchor and keeps it upright and life-sized', () => {
    const group = new THREE.Group();
    // The pugglenaut has already walked to (0.3, -0.2) in scene metres.
    placeContent(group, v(1, 0, -2), 0, 0.3, -0.2);

    // Feet land exactly on the tapped point.
    const feet = group.localToWorld(v(0.3, -0.2, 0));
    expect(feet.x).toBeCloseTo(1, 6);
    expect(feet.y).toBeCloseTo(0, 6);
    expect(feet.z).toBeCloseTo(-2, 6);

    // And the head, 0.25 m up in the Z-up scene, is 0.25 m up in XR: real
    // scale, right side up. This is the whole point of the feature.
    const head = group.localToWorld(v(0.3, -0.2, 0.25));
    expect(head.x).toBeCloseTo(1, 6);
    expect(head.y).toBeCloseTo(0.25, 6);
    expect(head.z).toBeCloseTo(-2, 6);
  });

  it('honours the floor height from the reference space', () => {
    // The VR case: a fixed standoff on a guessed floor.
    expect(VR_DISTANCE).toBeCloseTo(1.6, 6);
    const group = new THREE.Group();
    placeContent(group, v(0, floorHeight('local'), -VR_DISTANCE), 0, 0, 0);
    expect(group.localToWorld(v(0, 0, 0)).y).toBeCloseTo(-1.6, 6);
    expect(group.localToWorld(v(0, 0, 0)).z).toBeCloseTo(-1.6, 6);
  });

  it('applies yaw about XR up, not about the scene up', () => {
    const group = new THREE.Group();
    const yaw = Math.PI / 2;
    placeContent(group, v(0, 0, 0), yaw, 0, 0);
    // Scene +X yawed by +90 degrees about XR +Y lands on -Z.
    const forward = group.localToWorld(v(1, 0, 0));
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(-1, 6);
    // Up survives the yaw: a yaw that tipped the rig would be the classic bug.
    const up = group.localToWorld(v(0, 0, 1));
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('keeps the character on the anchor whatever the yaw', () => {
    const group = new THREE.Group();
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
      placeContent(group, v(-0.4, 0.9, 3), yaw, 1.7, -2.6);
      const feet = group.localToWorld(v(1.7, -2.6, 0));
      expect(feet.x).toBeCloseTo(-0.4, 6);
      expect(feet.y).toBeCloseTo(0.9, 6);
      expect(feet.z).toBeCloseTo(3, 6);
    }
  });

  it('is repeatable, so re-placing does not drift', () => {
    // The module reuses scratch vectors; a stale scratch would show up here.
    const a = new THREE.Group();
    placeContent(a, v(1, 0, -2), 0.4, 0.3, -0.2);
    const first = a.position.clone();
    placeContent(a, v(5, 1, 5), -1.2, 9, 9);
    placeContent(a, v(1, 0, -2), 0.4, 0.3, -0.2);
    expect(a.position.distanceTo(first)).toBeCloseTo(0, 9);
  });
});

describe('resetContent', () => {
  it('restores the desktop identity transform', () => {
    const group = new THREE.Group();
    placeContent(group, v(1, 0.5, -2), 1.1, 0.3, -0.2);
    resetContent(group);
    expect(group.position.toArray()).toEqual([0, 0, 0]);
    // Z-up again: a scene point comes back unchanged.
    const p = group.localToWorld(v(0.3, -0.2, 0.25));
    expect(p.x).toBeCloseTo(0.3, 9);
    expect(p.y).toBeCloseTo(-0.2, 9);
    expect(p.z).toBeCloseTo(0.25, 9);
  });
});

describe('arSessionInit', () => {
  it('is the plain init when there is nothing to overlay', () => {
    expect(arSessionInit(null)).toBe(AR_SESSION_INIT);
    expect(arSessionInit(undefined)).toBe(AR_SESSION_INIT);
  });

  it('asks for dom-overlay when given a root', () => {
    const root = { nodeType: 1 } as unknown as Element;
    const init = arSessionInit(root) as XRSessionInit & { domOverlay?: { root: Element } };
    expect(init.optionalFeatures).toContain('dom-overlay');
    expect(init.domOverlay?.root).toBe(root);
  });

  it('never requires anything, so a missing feature cannot kill the session', () => {
    // dom-overlay is unevenly supported and a headset has no use for it. A
    // required feature that is not granted fails the whole requestSession.
    const root = { nodeType: 1 } as unknown as Element;
    for (const init of [AR_SESSION_INIT, arSessionInit(root)]) {
      expect(init.requiredFeatures ?? []).toEqual([]);
    }
  });

  it('keeps hit-test and local-floor when overlaying', () => {
    const root = { nodeType: 1 } as unknown as Element;
    const init = arSessionInit(root);
    expect(init.optionalFeatures).toContain('hit-test');
    expect(init.optionalFeatures).toContain('local-floor');
  });
});
