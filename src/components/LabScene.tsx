import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONTROL_DT, type DuckLink, type DuckState } from '../lib/duck/link';
import { createPugglenaut, type Rig } from '../lib/duck/pugglenaut';
import type { DuckTree } from '../lib/duck/tree';

/**
 * The Waddle Lab viewport.
 *
 * Owns the WebGL canvas and both clocks: the control loop advances in fixed
 * 50 Hz steps (the robot's real rate) while rendering runs at display rate.
 * Keeping those separate is what lets a 90 Hz XR session drive the same link
 * later without touching the playback code.
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

export default function LabScene({ link, tree, running, reducedMotion, onFps }: LabSceneProps) {
  const holder = useRef<HTMLDivElement>(null);
  // Read inside the animation loop so changing them does not rebuild the scene.
  const runningRef = useRef(running);
  const reducedRef = useRef(reducedMotion);
  const fpsRef = useRef(onFps);
  runningRef.current = running;
  reducedRef.current = reducedMotion;
  fpsRef.current = onFps;

  useEffect(() => {
    const mount = holder.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 20);
    // The MJCF is Z-up and the rig is built in that frame, so the whole scene
    // stays Z-up rather than converting every transform to three's Y-up.
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, -0.5, 0.9);
    scene.add(key);

    // Floor at z = 0, where the MJCF's ground plane sits.
    const grid = new THREE.GridHelper(2, 20, 0x8f7a45, 0x8f7a45);
    grid.rotation.x = Math.PI / 2;
    const gridMat = grid.material as THREE.Material;
    gridMat.opacity = 0.28;
    gridMat.transparent = true;
    scene.add(grid);

    const rig: Rig = createPugglenaut(tree);
    scene.add(rig.root);

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

      if (runningRef.current) {
        backlog += dt;
        // Fixed 50 Hz control, independent of display rate.
        while (backlog >= CONTROL_DT) {
          link.tick(CONTROL_DT);
          backlog -= CONTROL_DT;
          phase = (phase + CONTROL_DT / CYCLE_TIME) % 1;
        }
      }

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
        camera.position.set(pos[0] + 0.40, pos[1] - 0.42, pos[2] + 0.22);
        camera.lookAt(pos[0], pos[1], pos[2] - 0.04);
      }

      renderer.render(scene, camera);

      frames++;
      if (fpsRef.current && now - fpsAt > 1000) {
        fpsRef.current(Math.round((frames * 1000) / (now - fpsAt)));
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
      grid.geometry.dispose();
      gridMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [link, tree]);

  return <div ref={holder} className="lab-viewport" aria-hidden="true" />;
}
