import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the generated simulation model.
 *
 * These are cheap and they exist because the failure they catch is expensive:
 * the model is a build artefact, and the one attribute the browser depends on
 * is invisible in every local check that does not involve a browser.
 */

const MODEL_DIR = 'public/duck/sim';
const robot = readFileSync(`${MODEL_DIR}/robot_reduced.xml`, 'utf8');
const scene = readFileSync(`${MODEL_DIR}/scene.xml`, 'utf8');

describe('the shipped MuJoCo model', () => {
  it('compiles single-threaded', () => {
    // Threaded mesh compilation needs wasm pthreads, which need
    // SharedArrayBuffer, which needs COOP/COEP headers GitHub Pages cannot
    // send. Without this the model loads fine under node and fails in every
    // browser with "thread constructor failed" -- so no test that skips a real
    // browser would notice. Hence asserting on the text.
    expect(robot).toMatch(/<compiler[^>]*usethread="false"/);
  });

  it('points the scene at the reduced robot', () => {
    expect(scene).toContain('robot_reduced.xml');
    expect(scene).not.toContain('robot_groundcontact.xml');
  });

  it('keeps the keyframes the simulator resets to', () => {
    for (const key of ['STAND', 'SIT', 'FOLD']) expect(scene).toContain(`name="${key}"`);
  });

  it('references only meshes that were actually shipped', () => {
    const shipped = new Set(readdirSync(`${MODEL_DIR}/assets`));
    const referenced = [...robot.matchAll(/file="([^"]+)"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) expect(shipped.has(file), file).toBe(true);
  });

  it('ships only collision meshes, and few of them', () => {
    // 82 geoms in the original, 71 of them non-colliding visuals. If this
    // starts growing, the 348 KB download is growing with it.
    const meshes = readdirSync(`${MODEL_DIR}/assets`).filter((f) => f.endsWith('.msh'));
    expect(meshes.length).toBe(9);
  });
});
