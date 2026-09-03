import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CONTROL_DT, type DuckLink, type DuckState } from '../lib/duck/link';
import { createPugglenaut, PALETTE, type Rig } from '../lib/duck/pugglenaut';
import type { DuckTree } from '../lib/duck/tree';
import {
  AR_SESSION_INIT,
  detectXRSupport,
  floorHeight,
  NO_XR,
  placeContent,
  resetContent,
  resolveReferenceSpace,
  VR_DISTANCE,
  VR_SESSION_INIT,
  yawToFace,
  type LabXRMode,
  type XRSupport,
} from '../lib/duck/xr';

/**
 * The Waddle Lab viewport.
 *
 * Owns the WebGL canvas and both clocks: the control loop advances in fixed
 * 50 Hz steps (the robot's real rate) while rendering runs at display rate.
 * Keeping those separate is what lets a 90 Hz XR session drive the same link
 * without touching the playback code -- and that is now load-bearing rather
 * than aspirational, because the render loop runs through
 * `renderer.setAnimationLoop`, which hands over to the headset's own frame
 * callback the moment a session starts.
 *
 * XR is strictly additive. Everything it touches -- the content group's
 * transform, the grid's visibility, the camera's projection -- is restored on
 * session end, and none of it is reachable on a browser with no `navigator.xr`.
 */

export interface LabSceneProps {
  link: DuckLink;
  tree: DuckTree;
  running: boolean;
  reducedMotion: boolean;
  onFps?: (fps: number) => void;
}

/** Never advance more than this much simulated time in one frame. */
const MAX_CATCHUP = 0.25;

/** Gait cycle length, matching the baked clips. */
const CYCLE_TIME = 0.6;

/**
 * How far in front of the viewer an AR pugglenaut lands when the device would
 * not grant `hit-test`. Within arm's reach of a phone held out, so it reads at
 * 25 cm tall rather than as a distant speck.
 */
const AR_FALLBACK_DISTANCE = 0.6;

/** Reticle radii, sized against the pugglenaut's ~6 cm footprint. */
const RETICLE_INNER = 0.045;
const RETICLE_OUTER = 0.055;

export default function LabScene({ link, tree, running, reducedMotion, onFps }: LabSceneProps) {
  const holder = useRef<HTMLDivElement>(null);
  // Read inside the animation loop so changing them does not rebuild the scene.
  const runningRef = useRef(running);
  const reducedRef = useRef(reducedMotion);
  const fpsRef = useRef(onFps);
  runningRef.current = running;
  reducedRef.current = reducedMotion;
  fpsRef.current = onFps;

  // Which immersive modes this device will grant. Starts at "none", so the
  // control is absent until a probe says otherwise -- the desktop default.
  const [xrSupport, setXrSupport] = useState<XRSupport>(NO_XR);
  // The mode currently presenting, for the button's label.
  const [xrMode, setXrMode] = useState<LabXRMode | null>(null);
  const [xrError, setXrError] = useState<string | null>(null);
  // The scene lives inside an effect, so the button reaches it through refs
  // rather than the other way around.
  const enterRef = useRef<((mode: LabXRMode) => void) | null>(null);
  const exitRef = useRef<(() => void) | null>(null);

  // Feature-detect once, in its own effect: it must not re-run when the link
  // changes, and it must never throw on a browser with no XR at all.
  useEffect(() => {
    let live = true;
    void detectXRSupport(typeof navigator === 'undefined' ? undefined : navigator.xr).then(
      (support) => {
        if (live) setXrSupport(support);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const mount = holder.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Harmless when no session is ever requested: WebGLRenderer only consults
    // the XR manager once `isPresenting` is true.
    renderer.xr.enabled = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sceneBackground = scene.background;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 20);
    // The MJCF is Z-up and the rig is built in that frame, so the whole scene
    // stays Z-up rather than converting every transform to three's Y-up.
    camera.up.set(0, 0, 1);
    const desktopFov = camera.fov;

    // The hemisphere light stays in the scene frame. Its default sky direction
    // is +Y, which is up in XR and merely a convention here, so leaving it
    // where it is happens to be right in both.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.5));

    // Everything authored in the robot's Z-up metres hangs off one group, so
    // entering XR is a single transform on the group rather than a rewrite of
    // the rig. Identity on the desktop, so the flat view is unchanged.
    const content = new THREE.Group();
    content.name = 'lab-content';
    scene.add(content);

    // The key light lives INSIDE the content group, with its target, so that
    // "above and to the side" keeps meaning that after the XR rotation. Left
    // in the scene frame its +Z would become XR forward and the pugglenaut
    // would be lit from the user's face. A directional light's direction runs
    // from its world position to its target's, so both have to move together.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, -0.5, 0.9);
    content.add(key);
    content.add(key.target);

    // Floor at z = 0, where the MJCF's ground plane sits.
    //
    // Six metres, in 10 cm cells. The cell size is the same as it always was
    // and is deliberately real -- it reads as scale, and in VR it is a floor
    // someone is standing on. The extent grew for the live simulator: playback
    // ambles, but a shove sends the pugglenaut a metre or more, and off the old
    // two-metre grid the chase camera showed it lying in an empty void with no
    // floor to have fallen onto. MuJoCo's own plane is infinite, so nothing
    // about the physics changes here; only how much of it you can see.
    const grid = new THREE.GridHelper(6, 60, 0x8f7a45, 0x8f7a45);
    grid.rotation.x = Math.PI / 2;
    const gridMat = grid.material as THREE.Material;
    gridMat.opacity = 0.42;
    gridMat.transparent = true;
    content.add(grid);

    // A faint solid ground under the wireframe. Thin grid lines alias away at
    // the grazing angles the chase camera reaches when it drops to follow a
    // fallen robot, and without them the pugglenaut reads as tumbling through a
    // void rather than lying on a floor. Unlit and behind everything, so it
    // says "ground" without competing with the character. Hidden in AR, where
    // the real floor is already there.
    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x161226,
      transparent: true,
      opacity: 0.85,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.z = -0.001; // just below the grid, so the lines stay crisp
    floor.renderOrder = -1;
    content.add(floor);

    const rig: Rig = createPugglenaut(tree);
    content.add(rig.root);

    // The placement reticle. It is parented to the SCENE, not to `content`:
    // hit-test poses arrive already in the XR reference space, so putting it
    // under the Z-up group would rotate it out from under the surface it is
    // supposed to be lying on.
    const reticleGeo = new THREE.RingGeometry(RETICLE_INNER, RETICLE_OUTER, 32).rotateX(
      -Math.PI / 2,
    );
    // Unlit on purpose: while the user is still choosing a spot the content
    // group is hidden, which takes the key light with it, and a lit reticle
    // would go black at exactly the moment it has to be seen.
    const reticleMat = new THREE.MeshBasicMaterial({
      color: PALETTE.flame,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // The feet are our decorative geometry, not the robot's, so measure once
    // how far they sit off the floor in the home stance and drop the rig by
    // that much. Styling is aligned to the floor; the skeleton is untouched.
    rig.apply(
      new Float32Array(tree.homePose),
      { pos: [0, 0, tree.trunkHeight], quat: [1, 0, 0, 0] },
      0,
      0,
    );
    const groundOffset = rig.boundingBox().min.z;

    let state: DuckState | null = null;
    const unsubscribe = link.subscribe((s) => {
      state = s;
    });

    // Seed one tick so a powered-down lab still shows a standing pugglenaut.
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
    // While presenting, the drawing buffer belongs to the XR compositor and
    // three sizes it from the session's framebuffer, so a layout change behind
    // the session must not touch it. Entering XR reflows the page on a phone,
    // which is exactly when this fires.
    const observer = new ResizeObserver(() => {
      if (!renderer.xr.isPresenting) resize();
    });
    observer.observe(mount);

    // --- XR session state --------------------------------------------------
    //
    // Plain closure variables rather than React state: the frame loop reads
    // them every frame and must not depend on a render having happened.
    let disposed = false;
    let xrSession: XRSession | null = null;
    let xrSessionMode: LabXRMode | null = null;
    let xrStarting = false;
    let hitTestSource: XRHitTestSource | null = null;
    /** Floor height in the reference space we actually got. */
    let floorY = 0;
    /** Has the user chosen where the pugglenaut stands? */
    let placed = false;
    /** A tap happened; the frame loop acts on it, where the poses are live. */
    let selectPending = false;
    /** Is the reticle currently on a real surface? */
    let hitReady = false;

    // Scratch for the XR frame path. The XRFrame pose objects themselves are
    // allocated by the browser and there is no API to preallocate them, but
    // they are only requested while the pugglenaut is UNPLACED -- once it is
    // standing somewhere, the XR branch of the frame loop allocates nothing.
    const hitPoint = new THREE.Vector3();
    const viewerPos = new THREE.Vector3();
    const viewerQuat = new THREE.Quaternion();
    const forward = new THREE.Vector3();
    const anchor = new THREE.Vector3();

    /**
     * Fill `anchor` with a floor point `distance` metres in front of the
     * viewer, and `viewerPos` with where the viewer is.
     *
     * Used for VR, which has no real surface to hit-test, and as the AR
     * fallback for a device that granted a session but not `hit-test`.
     */
    function anchorInFrontOf(pose: XRViewerPose, distance: number): void {
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      viewerPos.set(p.x, p.y, p.z);
      viewerQuat.set(o.x, o.y, o.z, o.w);
      // -Z is forward in every XR pose. Flattened, because we want a point on
      // the floor rather than one along the user's line of sight.
      forward.set(0, 0, -1).applyQuaternion(viewerQuat);
      forward.y = 0;
      // Looking straight up or down leaves no horizontal forward at all.
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      anchor.copy(viewerPos).addScaledVector(forward, distance);
      anchor.y = floorY;
    }

    /** Anchor the Z-up scene at `at`, facing `viewer`, and stop searching. */
    function placeAt(at: THREE.Vector3, viewer: THREE.Vector3): void {
      // Anchor the point under the pugglenaut's feet rather than the scene
      // origin: by now it has usually walked some way from it.
      const pos = state ? state.root.pos : [0, 0, 0];
      placeContent(content, at, yawToFace(at, viewer), pos[0], pos[1]);
      placed = true;
      hitReady = false;
      reticle.visible = false;
      content.visible = true;
    }

    /**
     * The XR half of a frame: hit-testing, the reticle, and placement.
     *
     * Everything here is skipped entirely once placed, which is both a
     * performance property and the reason the reticle does not hover over the
     * scene for the rest of the session.
     */
    function updateXR(frame: XRFrame): void {
      const refSpace = renderer.xr.getReferenceSpace();
      if (!refSpace) return;

      if (placed) {
        // A second tap re-arms the search, so the pugglenaut can be moved to
        // another table without leaving the session.
        if (selectPending) {
          selectPending = false;
          placed = false;
          content.visible = false;
        }
        return;
      }

      const viewerPose = frame.getViewerPose(refSpace);
      if (!viewerPose) return;

      if (xrSessionMode === 'immersive-vr') {
        // No surfaces to find: stand it on the virtual floor, a couple of
        // metres out, facing whoever just put the headset on.
        anchorInFrontOf(viewerPose, VR_DISTANCE);
        placeAt(anchor, viewerPos);
        return;
      }

      // AR. Track the surface under the device's aim.
      if (hitTestSource) {
        const hits = frame.getHitTestResults(hitTestSource);
        const pose = hits.length > 0 ? hits[0].getPose(refSpace) : undefined;
        if (pose) {
          // The pose is a full transform, so the reticle lies flat on the
          // surface even if it is a sloping table. Written straight into the
          // matrix, which is why `matrixAutoUpdate` is off.
          reticle.matrix.fromArray(pose.transform.matrix);
          reticle.visible = true;
          hitReady = true;
          hitPoint.set(
            pose.transform.position.x,
            pose.transform.position.y,
            pose.transform.position.z,
          );
        } else {
          reticle.visible = false;
          hitReady = false;
        }
      }

      if (!selectPending) return;
      selectPending = false;
      if (hitReady) {
        // viewerPos was filled only on the fallback path, so read it here.
        const p = viewerPose.transform.position;
        viewerPos.set(p.x, p.y, p.z);
        placeAt(hitPoint, viewerPos);
      } else {
        anchorInFrontOf(viewerPose, AR_FALLBACK_DISTANCE);
        placeAt(anchor, viewerPos);
      }
    }

    function onSelect(): void {
      // Deferred rather than handled here: inside the frame callback the
      // viewer and hit poses are live, and here they are not.
      selectPending = true;
    }

    function onSessionEnd(): void {
      if (xrSession) {
        xrSession.removeEventListener('select', onSelect);
        xrSession = null;
      }
      hitTestSource?.cancel();
      hitTestSource = null;
      xrSessionMode = null;
      placed = false;
      selectPending = false;
      hitReady = false;
      reticle.visible = false;

      // Put the flat scene back exactly as it was.
      resetContent(content);
      content.visible = true;
      grid.visible = true;
      floor.visible = true;
      scene.background = sceneBackground;
      // Three.js copies the headset's projection matrix over ours and
      // decomposes its pose into camera.position/quaternion every XR frame,
      // so the desktop camera has to be rebuilt. Position and orientation the
      // chase camera will fix on the next frame; the projection is ours.
      camera.fov = desktopFov;
      camera.zoom = 1;
      camera.scale.set(1, 1, 1);
      resize();

      if (!disposed) {
        setXrMode(null);
      }
    }

    async function enterXR(mode: LabXRMode): Promise<void> {
      // `xrStarting` guards the window between the click and the session
      // being attached: a second tap in there would ask for two sessions.
      if (disposed || xrSession || xrStarting || !navigator.xr) return;
      xrStarting = true;
      setXrError(null);
      try {
        const session = await navigator.xr.requestSession(
          mode,
          mode === 'immersive-ar' ? AR_SESSION_INIT : VR_SESSION_INIT,
        );
        // Settle the reference space BEFORE handing the session over: three's
        // setSession awaits requestReferenceSpace and rejects if the type is
        // not available, which would strand us with a live session and no
        // renderer attached to it.
        const spaceType = await resolveReferenceSpace(session);
        renderer.xr.setReferenceSpaceType(spaceType);
        floorY = floorHeight(spaceType);

        session.addEventListener('select', onSelect);
        await renderer.xr.setSession(session);

        xrSession = session;
        xrSessionMode = mode;
        placed = false;
        selectPending = false;
        // Nothing is drawn until the user has chosen a spot. Without this the
        // Z-up rig would spend the first frames lying on its side at the XR
        // origin, which looks like a broken robot rather than an unplaced one.
        content.visible = false;

        if (mode === 'immersive-ar') {
          // The real floor is right there, and our grid would only argue with
          // it. The background goes too, so the clear colour stays fully
          // transparent and passthrough shows through.
          grid.visible = false;
          floor.visible = false;
          scene.background = null;
          // The hit-test ray rides on the viewer space, so it comes out of the
          // phone or headset and lands wherever it is pointed.
          const viewerSpace = await session.requestReferenceSpace('viewer');
          hitTestSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null;
        }

        if (!disposed) setXrMode(mode);
      } catch (err) {
        // A denied camera permission, an insecure origin and a device that
        // changed its mind all land here. None of them should break the page.
        setXrError(err instanceof Error ? err.message : 'the session would not start');
        // A session may already be live -- `requestHitTestSource` can throw
        // after `setSession` succeeded -- so end it if so. Ending fires
        // `sessionend`, which runs `onSessionEnd` again; it is idempotent.
        onSessionEnd();
        void renderer.xr.getSession()?.end().catch(() => undefined);
      } finally {
        xrStarting = false;
      }
    }

    renderer.xr.addEventListener('sessionend', onSessionEnd);
    enterRef.current = (mode) => void enterXR(mode);
    exitRef.current = () => void xrSession?.end().catch(() => undefined);

    let last = performance.now();
    let backlog = 0;
    let frames = 0;
    let fpsAt = last;

    /**
     * One frame. Driven by `renderer.setAnimationLoop`, which uses
     * `window.requestAnimationFrame` on the desktop and the session's own
     * `XRSession.requestAnimationFrame` while presenting -- the swap is
     * invisible here beyond the extra `xrFrame` argument.
     */
    function frame(now: number, xrFrame?: XRFrame) {
      const dt = Math.min((now - last) / 1000, MAX_CATCHUP);
      last = now;

      if (runningRef.current) {
        backlog += dt;
        // Fixed 50 Hz control, independent of display rate. Unchanged in XR:
        // a 90 Hz session simply arrives here with a smaller dt.
        while (backlog >= CONTROL_DT) {
          link.tick(CONTROL_DT);
          backlog -= CONTROL_DT;
          phase = (phase + CONTROL_DT / CYCLE_TIME) % 1;
        }
      }

      if (xrFrame) updateXR(xrFrame);

      if (state) {
        const pos = state.root.pos;
        rig.apply(
          state.joints,
          { pos: [pos[0], pos[1], pos[2] - groundOffset], quat: state.root.quat },
          state.mouth,
          reducedRef.current ? 0 : phase,
        );
        // Chase camera: follows the pugglenaut without spinning with it, so
        // driving stays legible and nobody gets motion sick. Positioned in
        // front-quarter rather than behind: the commands are in the robot's
        // own frame (vx is *its* forward, exactly as on the real Microduck),
        // so an external view is the honest one -- and it keeps the bill in
        // shot, which is the whole point of a platypus.
        //
        // Suppressed while presenting. In XR the headset owns the camera:
        // three overwrites these values from the pose anyway, and a view that
        // yanked itself around the room would be actively unpleasant.
        if (!renderer.xr.isPresenting) {
          camera.position.set(pos[0] + 0.4, pos[1] - 0.42, pos[2] + 0.22);
          camera.lookAt(pos[0], pos[1], pos[2] - 0.04);
        }
      }

      renderer.render(scene, camera);

      frames++;
      if (fpsRef.current && now - fpsAt > 1000) {
        fpsRef.current(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }
    }
    renderer.setAnimationLoop(frame);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      enterRef.current = null;
      exitRef.current = null;
      // End a live session before the canvas goes: the compositor would
      // otherwise keep asking a disposed renderer for frames.
      void xrSession?.end().catch(() => undefined);
      hitTestSource?.cancel();
      observer.disconnect();
      unsubscribe();
      rig.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      grid.geometry.dispose();
      gridMat.dispose();
      reticleGeo.dispose();
      reticleMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [link, tree]);

  // Prefer AR when the device offers both: on a passthrough headset a
  // duck-sized robot on the actual carpet beats one in a void.
  const offered: LabXRMode | null = xrSupport.ar
    ? 'immersive-ar'
    : xrSupport.vr
      ? 'immersive-vr'
      : null;

  return (
    <>
      <div ref={holder} className="lab-viewport" aria-hidden="true" />
      {offered ? (
        <div className="lab-xr">
          <button
            type="button"
            className="lab-xr-enter"
            onClick={() => {
              if (xrMode) exitRef.current?.();
              else enterRef.current?.(offered);
            }}
            title={
              offered === 'immersive-ar'
                ? 'Places a 25 cm pugglenaut on your floor or desk, at real scale'
                : 'Stands a 25 cm pugglenaut on a virtual floor in front of you'
            }
          >
            {xrMode
              ? 'Exit immersive'
              : offered === 'immersive-ar'
                ? 'View in AR'
                : 'View in VR'}
          </button>
          <span className="lab-xr-hint">
            {xrError
              ? `XR would not start: ${xrError}`
              : offered === 'immersive-ar'
                ? 'Tap a surface to place it, tap again to move it.'
                : 'It stands a couple of metres in front of you.'}
          </span>
        </div>
      ) : null}
    </>
  );
}
