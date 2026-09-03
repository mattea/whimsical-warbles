/**
 * The control plane of the live simulator: which policy runs, what command it
 * is given, and who takes over when the pugglenaut is on its face.
 *
 * All of it is pure. Nothing here touches MuJoCo, a worker, or a clock -- it is
 * handed the one number physics produces that matters (`upright`) and returns
 * the plan for the next tick. That separation is deliberate: contact physics is
 * not reproducible run to run (see `simWorker.ts`), so the *policy* of falling
 * and getting up is the only part that can be pinned by a test, and it should
 * be the part that is easy to pin.
 *
 * Every command encoding below is copied from `microduck/robotd/src/control.rs`.
 * They are not guessable and several are counter-intuitive -- the standing
 * command for the sit/stand policy is all-zero, which is upstream's own
 * documented trap -- so each one names its source.
 */

import {
  STANDING_ACTION_SCALE,
  STANDING_THRESHOLD,
  WALKING_ACTION_SCALE,
  twistMagnitude,
} from './observation';
import { CONTROL_DT, type BodyPose, type HeadPose, type Skill, type Twist } from './link';
import type { PolicySlot } from './simProtocol';
import type { Vec3 } from './tree';

const ZERO_TWIST: Twist = { vx: 0, vy: 0, vyaw: 0 };
const ZERO_HEAD: HeadPose = { neck: 0, pitch: 0, yaw: 0, roll: 0 };
const ZERO_BODY: BodyPose = { z: 0, roll: 0, pitch: 0 };

/** Which trained network each skill is. */
export const SKILL_POLICY: Record<Skill, PolicySlot> = {
  ground_pick: 'ground_pick',
  roulade: 'roulade',
  kick_left: 'kick_left',
  kick_right: 'kick_right',
  // Sit and stand are one policy driven by its command, not two.
  sit: 'sitstand',
  stand: 'sitstand',
};

/**
 * How long each skill is given before control hands back.
 *
 * These are measured, not guessed. Driving the real loop headless
 * (`mj_step` at 0.002 with the shipped weights) the kicks and the roulade
 * complete and settle inside three seconds; the sit reaches its final trunk
 * height of 0.061 m at about one second and holds; and the rise is the
 * interesting one -- the sit/stand policy lifts the trunk to 0.117 m by one
 * second and then *sags back* to 0.44 upright if it is left running, so it is
 * cut at one second and the standing balance policy finishes the job. Ground
 * pick is not a duration at all but a phase target, below.
 */
export const SKILL_DURATION: Record<Skill, number> = {
  ground_pick: 2.8,
  roulade: 3.0,
  kick_left: 3.0,
  kick_right: 3.0,
  sit: 2.0,
  stand: 1.0,
};

/**
 * Ground pick is commanded as a point travelling round a circle in the
 * velocity plane: `twist = [cos(2*pi*phi), sin(2*pi*phi), 0]`, with `phi`
 * advancing by `dt / 4.0` each control tick and the motion abandoned at
 * `phi = 0.7`. At 50 Hz that is 0.005 per tick, so the period is four seconds
 * and the cut lands at 2.8 -- which is where `SKILL_DURATION` gets its value.
 */
export const GROUND_PICK_PERIOD = 4.0;
export const GROUND_PICK_END_PHASE = 0.7;

/**
 * Below this the fall monitor takes the controls.
 *
 * `upright` is `-gravity[2]`: +1 standing, 0 on its side, -1 upside down. It is
 * observation slot 5, so the real robot produces it too. The margin here is
 * wide on purpose. Measured over ten seconds of walking the minimum is 0.998,
 * and the deepest legitimate dip in any skill is the ground pick's bow at
 * 0.829 -- but a genuine fall parks between 0.05 and 0.14, so anything from
 * about 0.3 to 0.7 separates them. 0.55 sits in the middle of that gap.
 */
export const FALL_UPRIGHT = 0.55;

/** Recovered, and worth handing back. Measured: a righted robot holds 1.000. */
export const RISE_UPRIGHT = 0.9;

/**
 * Both thresholds are held for a while before they count, which is the whole
 * of the hysteresis: a single bad tick during a stumble must not seize the
 * controls, and one lucky frame on the way up must not release them early.
 * 6 ticks is 0.12 s; 25 is half a second, comfortably longer than the 0.5 s the
 * standing policy needs to go from face-down to 0.97 upright.
 */
export const FALL_TICKS = 6;
export const RISE_TICKS = 25;

/**
 * Projected gravity in the trunk frame: `R^T * [0, 0, -1]`, which is the third
 * row of the rotation matrix, negated.
 *
 * This is observation slots 3..6 and it is the simulator's only orientation
 * sense, so it is worth having in one tested place rather than inline in the
 * physics loop. `quat` is MuJoCo order, w first.
 */
export function projectedGravityFromQuat(quat: ArrayLike<number>, out: Vec3): Vec3 {
  const w = quat[0];
  const x = quat[1];
  const y = quat[2];
  const z = quat[3];
  out[0] = -2 * (x * z - w * y);
  out[1] = -2 * (y * z + w * x);
  out[2] = -(1 - 2 * (x * x + y * y));
  return out;
}

/** How upright the trunk is, from projected gravity. +1 up, -1 inverted. */
export function uprightFromGravity(gravity: ArrayLike<number>): number {
  return -gravity[2];
}

/**
 * The command a skill is given at `elapsed` seconds in.
 *
 * Table-driven rather than a switch with side effects, because the encodings
 * are the part most likely to be wrong and a test should be able to walk them.
 */
export function skillTwist(skill: Skill, elapsed: number): Twist {
  if (skill === 'ground_pick') {
    const phase = Math.min(elapsed / GROUND_PICK_PERIOD, GROUND_PICK_END_PHASE);
    const angle = 2 * Math.PI * phase;
    return { vx: Math.cos(angle), vy: Math.sin(angle), vyaw: 0 };
  }
  // Sitting is the only non-zero constant command in the set.
  if (skill === 'sit') return { vx: 1, vy: 0, vyaw: 0 };
  // Kicks, the roulade and the rise are all triggered by *selection*: the
  // policy has one thing to do and an all-zero command is how it is asked.
  return { vx: 0, vy: 0, vyaw: 0 };
}

/** Action scale for a slot. `observation.ts` owns both numbers. */
export function actionScaleForSlot(slot: PolicySlot): number {
  return slot === 'stand' ? STANDING_ACTION_SCALE : WALKING_ACTION_SCALE;
}

/** Which of the two locomotion policies a live command selects. */
export function locomotionSlot(twist: Twist): PolicySlot {
  return twistMagnitude(twist) <= STANDING_THRESHOLD ? 'stand' : 'walk';
}

/**
 * Fall detection with hysteresis in both directions.
 *
 * Separate from the controller so it can be driven by a plain array of numbers
 * in a test. `update` returns whether recovery should be in force *after* this
 * tick.
 */
export interface FallMonitor {
  update(upright: number): boolean;
  /** Called while a skill owns the robot; clears the counters and stands down. */
  suspend(): void;
  reset(): void;
  readonly recovering: boolean;
}

export function createFallMonitor(options?: {
  fallUpright?: number;
  riseUpright?: number;
  fallTicks?: number;
  riseTicks?: number;
}): FallMonitor {
  const fallUpright = options?.fallUpright ?? FALL_UPRIGHT;
  const riseUpright = options?.riseUpright ?? RISE_UPRIGHT;
  const fallTicks = options?.fallTicks ?? FALL_TICKS;
  const riseTicks = options?.riseTicks ?? RISE_TICKS;

  let recovering = false;
  let down = 0;
  let up = 0;

  return {
    get recovering() {
      return recovering;
    },
    update(upright: number) {
      if (recovering) {
        // A tick that is not clearly upright resets the count outright rather
        // than decaying it, so "held for half a second" means exactly that.
        up = upright > riseUpright ? up + 1 : 0;
        if (up >= riseTicks) {
          recovering = false;
          up = 0;
          down = 0;
        }
      } else {
        down = upright < fallUpright ? down + 1 : 0;
        if (down >= fallTicks) {
          recovering = true;
          down = 0;
          up = 0;
        }
      }
      return recovering;
    },
    suspend() {
      recovering = false;
      down = 0;
      up = 0;
    },
    reset() {
      recovering = false;
      down = 0;
      up = 0;
    },
  };
}

/** Everything the physics loop needs in order to run one control tick. */
export interface ControlPlan {
  slot: PolicySlot;
  twist: Twist;
  head: HeadPose;
  body: BodyPose;
  actionScale: number;
  /** The skill running this tick, for the telemetry readout. */
  skill: Skill | null;
  seated: boolean;
  recovering: boolean;
}

export interface SimController {
  move(t: Twist): void;
  head(p: HeadPose): void;
  pose(b: BodyPose): void;
  /** Returns false if the skill was refused -- no policy, or busy. */
  do(s: Skill): boolean;
  stop(): void;
  reset(): void;
  /** Tell the controller a policy has arrived. Skills gate on this. */
  provide(slot: PolicySlot): void;
  has(slot: PolicySlot): boolean;
  /** Advance one control tick and return what to drive. */
  plan(upright: number, dt?: number): ControlPlan;
}

/**
 * The state machine that sits between the console's buttons and the physics.
 *
 * It owns: the smoothed drive command, the active skill and its clock, the
 * seated flag, and the fall monitor. It owns no physics and no time source --
 * `plan` is handed the tick length, so a test can step it a hundred times
 * without a timer.
 */
export function createSimController(options?: {
  monitor?: FallMonitor;
  /** Slots already loaded at construction. Normally walk and stand. */
  available?: PolicySlot[];
}): SimController {
  const monitor = options?.monitor ?? createFallMonitor();
  const available = new Set<PolicySlot>(options?.available ?? []);

  let wanted: Twist = { ...ZERO_TWIST };
  let head: HeadPose = { ...ZERO_HEAD };
  let body: BodyPose = { ...ZERO_BODY };

  let skill: Skill | null = null;
  let elapsed = 0;
  let seated = false;
  /** Asked for while seated: runs once the rise finishes. */
  let pending: Skill | null = null;

  function begin(s: Skill): void {
    skill = s;
    elapsed = 0;
    // A skill drives the whole robot; a leftover drive command would ride
    // along in the observation and pull it off the motion.
    wanted = { ...ZERO_TWIST };
    // The roulade genuinely inverts -- measured to -0.975 upright, mid-roll --
    // so the fall monitor has to stand down or it would "rescue" the trick.
    monitor.suspend();
  }

  function finish(): void {
    const done = skill;
    skill = null;
    elapsed = 0;
    if (done === 'sit') seated = true;
    else if (done === 'stand') seated = false;
    if (pending) {
      const next = pending;
      pending = null;
      begin(next);
    }
  }

  return {
    move(t: Twist) {
      // Accepted while recovering, just not acted on: a visitor holding W
      // through a tumble should walk away from it once it is up, rather than
      // having to notice that the key stopped counting.
      if (skill || seated) return;
      wanted = { vx: t.vx, vy: t.vy, vyaw: t.vyaw };
    },
    head(p: HeadPose) {
      head = { ...p };
    },
    pose(b: BodyPose) {
      body = { ...b };
    },
    do(s: Skill) {
      // Being on your back is not the moment to attempt a roulade.
      if (skill || monitor.recovering) return false;
      if (!available.has(SKILL_POLICY[s])) return false;

      // Sit and stand are a pair: you can only sit while standing and only
      // stand while seated. Same rule the playback backend enforces.
      if (s === 'sit' && seated) return false;
      if (s === 'stand' && !seated) return false;

      // Anything else asked for while seated stands up first, then runs. The
      // real runtime refuses outright; this is the same rule, answered nicely.
      if (seated && s !== 'stand') {
        pending = s;
        begin('stand');
        return true;
      }
      begin(s);
      return true;
    },
    stop() {
      wanted = { ...ZERO_TWIST };
    },
    reset() {
      wanted = { ...ZERO_TWIST };
      head = { ...ZERO_HEAD };
      body = { ...ZERO_BODY };
      skill = null;
      pending = null;
      elapsed = 0;
      seated = false;
      monitor.reset();
    },
    provide(slot: PolicySlot) {
      available.add(slot);
    },
    has(slot: PolicySlot) {
      return available.has(slot);
    },
    plan(upright: number, dt = CONTROL_DT): ControlPlan {
      if (skill) {
        const running = skill;
        const twist = skillTwist(running, elapsed);
        elapsed += dt;
        if (elapsed >= SKILL_DURATION[running]) finish();
        const slot = SKILL_POLICY[running];
        return {
          slot,
          twist,
          head,
          body,
          actionScale: actionScaleForSlot(slot),
          skill: running,
          seated,
          recovering: false,
        };
      }

      const recovering = monitor.update(upright);
      if (recovering) {
        // Hand everything to the standing policy. Head and body offsets are
        // dropped for the duration too: they are commands the policy will try
        // to honour, and a robot on its face should be doing exactly one
        // thing. The drive command is only suppressed, not forgotten.
        return {
          slot: 'stand',
          twist: { ...ZERO_TWIST },
          head: { ...ZERO_HEAD },
          body: { ...ZERO_BODY },
          actionScale: actionScaleForSlot('stand'),
          skill: null,
          seated: false,
          recovering: true,
        };
      }

      if (seated) {
        // The seat is a posture the sit/stand policy holds, not a pose it
        // reaches and abandons, so the sitting command keeps being sent.
        return {
          slot: 'sitstand',
          twist: skillTwist('sit', 0),
          head,
          body,
          actionScale: actionScaleForSlot('sitstand'),
          skill: null,
          seated: true,
          recovering: false,
        };
      }

      // Normal driving. If the walking policy has not arrived yet -- it always
      // has in practice, both locomotion policies are eager -- fall back to
      // standing rather than driving with weights that are not there.
      let slot = locomotionSlot(wanted);
      if (!available.has(slot)) slot = 'stand';
      // The standing policy is trained on a zero command; sending it the
      // dead-zone remnant of a released key would be feeding it noise.
      const twist = slot === 'stand' ? { ...ZERO_TWIST } : { ...wanted };
      return {
        slot,
        twist,
        head,
        body,
        actionScale: actionScaleForSlot(slot),
        skill: null,
        seated: false,
        recovering: false,
      };
    },
  };
}
