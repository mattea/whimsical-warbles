/**
 * Spawning the physics worker.
 *
 * One line, in its own file, for one reason: `new Worker(new URL(...))` is a
 * pattern the bundler rewrites at build time, and putting it anywhere
 * importable by a test would drag a wasm bundle into vitest. `simLink.ts` takes
 * a worker rather than making one precisely so that it stays testable, and this
 * is where the untestable half lives.
 */

/** A module worker running `simWorker.ts`. Terminate it when done with it. */
export function spawnSimWorker(): Worker {
  return new Worker(new URL('./simWorker.ts', import.meta.url), {
    type: 'module',
    name: 'waddle-lab-physics',
  });
}
