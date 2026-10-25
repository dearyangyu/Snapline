import { describe, expect, it } from 'vitest';
import { ISLAND_PERIMETER, IslandRimMotion, lightAt, newerLightState } from './islandRimMotion';

describe('shared island edge and halo clock', () => {
  it('keeps the approved 16-second idle lap and changes hover speed without a phase jump', () => {
    const motion = new IslandRimMotion(1000);
    motion.update(false, true, 1000);
    expect(lightAt(motion.state, 17000).phase).toBeCloseTo(26);
    const before = lightAt(motion.state, 2450);
    motion.update(true, true, 2450);
    expect(lightAt(motion.state, 2450)).toEqual(before);
    const accelerated = lightAt(motion.state, 5450);
    expect(accelerated.velocity).toBeCloseTo(2.6, 4);
    expect(accelerated.brightness).toBeCloseTo(1.32, 4);
    motion.update(false, true, 5450);
    expect(lightAt(motion.state, 5450)).toEqual(accelerated);
  });
  it('gives identical positions to two windows regardless of their RAF frequency or start time', () => {
    const motion = new IslandRimMotion(1000);
    motion.update(true, true, 1000);
    const shared = structuredClone(motion.state);
    let frequentlySampled = structuredClone(shared);
    for (let now = 1010; now <= 2000; now += 10) frequentlySampled = { ...frequentlySampled, ...lightAt(frequentlySampled, now), at: now };
    expect(lightAt(shared, 2000).phase).toBeCloseTo(lightAt(frequentlySampled, 2000).phase, 9);
    expect(lightAt(shared, 2000).brightness).toBeCloseTo(lightAt(frequentlySampled, 2000).brightness, 9);
    expect(ISLAND_PERIMETER / 2).toBeGreaterThan(190);
  });
  it('holds its current phase while hidden, dragging or reduced motion, then resumes without catching up', () => {
    const motion = new IslandRimMotion(1000);
    motion.update(false, true, 1000);
    const phase = lightAt(motion.state, 2500).phase;
    motion.update(false, false, 2500);
    expect(lightAt(motion.state, 150000).phase).toBe(phase);
    motion.update(false, true, 150000);
    expect(lightAt(motion.state, 150000).phase).toBe(phase);
  });
  it('rejects delayed states from a previous mount or older interaction revision', () => {
    const motion = new IslandRimMotion(1000), first = structuredClone(motion.state);
    motion.update(true, true, 1200);
    expect(newerLightState(first, motion.state)).toBe(false);
    expect(newerLightState({ ...motion.state, owner: 999, revision: 999 }, motion.state)).toBe(false);
    expect(newerLightState({ ...motion.state, owner: 2000, revision: 0 }, motion.state)).toBe(true);
    expect(newerLightState({ ...motion.state, phase: NaN }, motion.state)).toBe(false);
  });
});
