import { describe, expect, it } from 'vitest';
import { IslandPetMotion, petTravel, type PetPose } from './islandPetMotion';

function seeded(seed = 123) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function untilWalking(motion: IslandPetMotion) {
  let pose: PetPose = motion.advance(0);
  for (let index = 0; index < 4000 && (pose.activity !== 'walk' || Math.abs(pose.y) < .1); index++) pose = motion.advance(16);
  expect(pose.activity).toBe('walk');
  return pose;
}

describe('small island companion motion', () => {
  it('keeps all planned positions inside the fixed pet button and produces different destinations and dwell times', () => {
    const motion = new IslandPetMotion(seeded());
    const stops = new Set<string>(), rests = new Set<number>();
    let prior: PetPose = motion.advance(0), restFrames = 0, looks = 0;
    for (let index = 0; index < 15000; index++) {
      const pose = motion.advance(16);
      expect(Math.abs(pose.x)).toBeLessThanOrEqual(petTravel);
      expect(Object.values(pose).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
      expect(pose.eyeOpen).toBeGreaterThanOrEqual(.05 - 1e-10);
      expect(pose.eyeOpen).toBeLessThanOrEqual(1);
      if (pose.activity === 'rest') restFrames++;
      if (pose.activity !== 'rest' && prior.activity === 'rest') { rests.add(restFrames); restFrames = 0; }
      if (pose.activity === 'rest' && prior.activity === 'walk') stops.add(pose.x.toFixed(2));
      if (pose.activity === 'look' && prior.activity !== 'look') looks++;
      prior = pose;
    }
    expect(stops.size).toBeGreaterThan(12); expect(rests.size).toBeGreaterThan(12); expect(looks).toBeGreaterThan(2);
  });
  it('spends most time in varied finite actions, with brief rests and direct action handoffs', () => {
    let restFrames = 0, totalFrames = 0, directHandoffs = 0;
    const counts = new Map<string, number>();
    for (const seed of [12, 94, 711, 2026]) {
      const motion = new IslandPetMotion(seeded(seed));
      let previous = motion.advance(0), continuousRest = 0;
      for (let index = 0; index < 7500; index++) {
        const pose = motion.advance(16);
        counts.set(pose.activity, (counts.get(pose.activity) ?? 0) + 1); totalFrames++;
        if (pose.activity === 'rest') { restFrames++; continuousRest += 16; } else continuousRest = 0;
        expect(continuousRest).toBeLessThanOrEqual(1120);
        if (previous.activity !== pose.activity && pose.activity !== 'rest' && previous.activity !== 'rest') directHandoffs++;
        previous = pose;
      }
    }
    const restRatio = restFrames / totalFrames;
    expect(restRatio).toBeGreaterThan(.15); expect(restRatio).toBeLessThan(.3);
    expect(directHandoffs).toBeGreaterThan(50);
    for (const activity of ['look', 'stretch', 'wiggle', 'hop']) {
      expect(counts.get(activity)).toBeGreaterThan(100);
      expect(counts.get('walk')!).toBeGreaterThan(counts.get(activity)!);
    }
  });
  it('keeps new gestures inside the visual stage and brings their body and feet back continuously', () => {
    const motion = new IslandPetMotion(seeded(2026));
    let previous = motion.advance(0), airborne = 0;
    const checked = new Set<string>();
    for (let index = 0; index < 15000; index++) {
      const pose = motion.advance(16);
      expect(pose.lift).toBeGreaterThanOrEqual(-3.2); expect(pose.lift).toBeLessThanOrEqual(0);
      expect(pose.scaleX).toBeGreaterThanOrEqual(.935); expect(pose.scaleX).toBeLessThanOrEqual(1.1);
      expect(pose.scaleY).toBeGreaterThanOrEqual(.9); expect(pose.scaleY).toBeLessThanOrEqual(1.12);
      // At the actual 26×28 render size, conservatively include body rotation,
      // stretch and shared lift against the 96×36 stationary button.
      const radians = Math.abs(pose.lean) * Math.PI / 180;
      const headTop = 4 + (28 - 26 * pose.scaleY * Math.cos(radians) - 13 * pose.scaleX * Math.sin(radians) + pose.y + pose.lift) * 28 / 34;
      expect(headTop).toBeGreaterThan(0);
      expect(Math.abs(pose.x) + 14 * pose.scaleX + 26 * Math.sin(radians)).toBeLessThan(48);
      if (pose.activity === 'hop' && pose.lift < -1) {
        airborne++;
        expect(pose.leftFootY).toBe(0); expect(pose.rightFootY).toBe(0); // Both inherit shared lift, not a body-only jump.
      }
      if (pose.activity !== previous.activity && ['stretch', 'hop', 'wiggle', 'look'].includes(previous.activity)) {
        checked.add(previous.activity);
        expect(previous.lean).toBeCloseTo(0, 5); expect(previous.lift).toBeCloseTo(0, 5);
        expect(previous.scaleX).toBeCloseTo(1, 5); expect(previous.scaleY).toBeCloseTo(1, 5);
        expect(Math.abs(pose.x - previous.x)).toBeLessThan(.005);
      }
      previous = pose;
    }
    expect(airborne).toBeGreaterThan(20);
    expect([...checked].sort()).toEqual(['hop', 'look', 'stretch', 'wiggle']);
  });
  it('pauses the whole pose and random schedule, then resumes the same trajectory without catching up', () => {
    const motion = new IslandPetMotion(seeded(94)), reference = new IslandPetMotion(seeded(94));
    const before = untilWalking(motion); untilWalking(reference);
    for (let index = 0; index < 200; index++) expect(motion.advance(900, { paused: true })).toEqual(before);
    expect(motion.advance(0)).toEqual(before);
    expect(motion.advance(16)).toEqual(reference.advance(16));
  });
  it('clamps a delayed frame and ignores invalid elapsed values', () => {
    const motion = new IslandPetMotion(seeded(94)), reference = new IslandPetMotion(seeded(94));
    const before = untilWalking(motion); untilWalking(reference);
    expect(motion.advance(NaN)).toEqual(before); expect(motion.advance(-200)).toEqual(before);
    expect(motion.advance(60_000)).toEqual(reference.advance(40));
  });
  it('reduces motion to an open-eyed resting pose in place and resumes from that exact position', () => {
    const motion = new IslandPetMotion(seeded(94)), walking = untilWalking(motion);
    const still = motion.advance(16, { reducedMotion: true });
    expect(still.x).toBe(walking.x); expect(still.eyeOpen).toBe(1); expect(still.lean).toBe(0); expect(still.y).toBe(0);
    expect(motion.advance(1000, { reducedMotion: true })).toEqual(still);
    expect(motion.advance(0)).toEqual(still);
    for (let index = 0; index < 40; index++) expect(motion.advance(16).x).toBe(still.x);
  });
  it('uses eased starts/stops and opposing feet driven by traveled distance', () => {
    const motion = new IslandPetMotion(seeded(94));
    let previous = motion.advance(0), previousStep = 0, checked = false;
    for (let index = 0; index < 4000; index++) {
      const pose = motion.advance(16), step = Math.abs(pose.x - previous.x);
      if (pose.activity === 'walk') {
        expect(pose.leftFootX).toBeCloseTo(-pose.rightFootX, 8);
        if (previous.activity === 'rest') expect(step).toBeLessThan(.005);
      }
      if (pose.activity === 'rest' && previous.activity === 'walk') {
        expect(previousStep).toBeLessThan(.02); expect(pose.leftFootY).toBe(0); checked = true; break;
      }
      previous = pose; previousStep = step;
    }
    expect(checked).toBe(true);
  });
  it('varies blink spacing and sometimes double blinks without endlessly closing the eyes', () => {
    const motion = new IslandPetMotion(seeded(9));
    const intervals: number[] = []; let closed = false, lastClosed = -1;
    for (let elapsed = 0; elapsed < 180_000; elapsed += 16) {
      const eyes = motion.advance(16).eyeOpen;
      if (eyes < .35 && !closed) { if (lastClosed >= 0) intervals.push(elapsed - lastClosed); lastClosed = elapsed; }
      closed = eyes < .35;
    }
    expect(intervals.some(value => value < 500)).toBe(true);
    expect(new Set(intervals.filter(value => value > 1000)).size).toBeGreaterThan(12);
  });
  it.each([0, 1, -1, 2, NaN, Infinity])('keeps a malformed or constant RNG (%s) finite and bounded', value => {
    const motion = new IslandPetMotion(() => value);
    for (let index = 0; index < 1400; index++) {
      const pose = motion.advance(40);
      expect(Math.abs(pose.x)).toBeLessThanOrEqual(petTravel);
      expect(Object.values(pose).filter(entry => typeof entry === 'number').every(Number.isFinite)).toBe(true);
    }
  });
});
