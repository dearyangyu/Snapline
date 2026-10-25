import { describe, expect, it } from 'vitest';
import { IslandPetGroupMotion, groupPetLayout, type GroupPetPose } from './islandPetGroupMotion';
import { PET_CATALOG } from './petCatalog';

function seeded(seed = 123) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function moving(motion: IslandPetGroupMotion) {
  let poses = motion.advance(0);
  for (let i = 0; i < 2000 && !poses.some(pose => Math.abs(pose.lean) > .2 || pose.lift < -.2); i++) poses = motion.advance(16);
  expect(poses.some(pose => Math.abs(pose.lean) > .2 || pose.lift < -.2)).toBe(true);
  return poses;
}

describe('shared island pet stage', () => {
  it.each([2, 3])('keeps %s different bodies ordered, separated and inside the unchanged 96px button', count => {
    const layout = groupPetLayout(count);
    let minGap = Infinity, maxExtent = 0, maxStep = 0;
    const destinations = new Set<string>();
    for (const seed of [12, 241, 2026]) {
      const motion = new IslandPetGroupMotion(count, true, seeded(seed), PET_CATALOG.slice(3, 3 + count).map(pet => pet.personality));
      let prior = motion.advance(0);
      for (let frame = 0; frame < 9000; frame++) {
        const poses = motion.advance(16);
        for (let i = 0; i < poses.length; i++) {
          const pose = poses[i], halfWidth = layout.width * pose.scaleX / 2 + layout.height * Math.sin(Math.abs(pose.lean) * Math.PI / 180);
          maxExtent = Math.max(maxExtent, Math.abs(pose.x) + halfWidth);
          maxStep = Math.max(maxStep, Math.abs(pose.x - prior[i].x));
          if (i) {
            minGap = Math.min(minGap, pose.x - poses[i - 1].x);
            const previous = poses[i - 1], previousHalf = layout.width * previous.scaleX / 2 + layout.height * Math.sin(Math.abs(previous.lean) * Math.PI / 180);
            expect(pose.x - halfWidth).toBeGreaterThan(previous.x + previousHalf);
          }
          expect(Object.values(pose).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
        }
        if (frame % 100 === 0) destinations.add(poses.map(pose => pose.x.toFixed(1)).join(','));
        prior = poses;
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(layout.separation - 1e-9);
    expect(maxExtent).toBeLessThan(48); expect(maxStep).toBeLessThan(.75);
    expect(destinations.size).toBeGreaterThan(70);
  });

  it('makes neighboring pets look at each other and answer after the first hop, with different initiators', () => {
    const motion = new IslandPetGroupMotion(3, true, seeded(29));
    const leaders = new Set<number>(), respondents = new Set<number>();
    let greeted: number | null = null, replies = 0, yielding = 0;
    for (let frame = 0; frame < 16000; frame++) {
      const poses = motion.advance(16);
      const leader = poses.findIndex(pose => pose.interaction === 'greet');
      if (leader < 0) greeted = null;
      else {
        const first = poses[leader], other = first.partner!;
        expect(Math.abs(other - leader)).toBe(1);
        if (first.lift < -1) { greeted = leader; leaders.add(leader); expect(poses[other].lift).toBeCloseTo(0); }
        if (poses[other].lift < -1) {
          expect(greeted).toBe(leader); expect(first.lift).toBeCloseTo(0); replies++; respondents.add(other);
          expect(Math.sign(first.gazeX)).toBe(Math.sign(other - leader));
          expect(Math.sign(poses[other].gazeX)).toBe(Math.sign(leader - other));
        }
      }
      if (poses.some(pose => pose.interaction === 'yield' && pose.activity === 'walk')) yielding++;
    }
    expect(leaders.size).toBe(3); expect(respondents.size).toBe(3);
    expect(replies).toBeGreaterThan(40); expect(yielding).toBeGreaterThan(40);
  });

  it('freezes the complete interaction, blink and random schedule across pause/hidden time', () => {
    const motion = new IslandPetGroupMotion(3, true, seeded(241)), reference = new IslandPetGroupMotion(3, true, seeded(241));
    const before = moving(motion); moving(reference);
    for (let i = 0; i < 100; i++) expect(motion.advance(60_000, { paused: true })).toEqual(before);
    expect(motion.advance(0)).toEqual(before);
    for (let i = 0; i < 600; i++) expect(motion.advance(16)).toEqual(reference.advance(16));
  });

  it('reduces the whole group to a quiet pose in place and resumes without catching up or a closed-eye jump', () => {
    const motion = new IslandPetGroupMotion(3, true, seeded(51)), before = moving(motion);
    const still = motion.advance(16, { reducedMotion: true });
    still.forEach((pose, i) => { expect(pose.x).toBe(before[i].x); expect(pose.lift).toBe(0); expect(pose.eyeOpen).toBe(1); expect(pose.interaction).toBe('none'); });
    expect(motion.advance(3000, { reducedMotion: true })).toEqual(still);
    expect(motion.advance(0)).toEqual(still);
  });

  it('keeps walking when social interactions are disabled, and lets a current reply finish without a teleport', () => {
    const motion = new IslandPetGroupMotion(2, true, seeded(19));
    let poses: GroupPetPose[] = motion.advance(0);
    for (let i = 0; i < 4000 && !poses.some(pose => pose.interaction === 'greet' && pose.lift < -1); i++) poses = motion.advance(16);
    expect(poses.some(pose => pose.interaction === 'greet')).toBe(true);
    motion.setInteractions(false);
    expect(motion.advance(0)).toEqual(poses);
    for (let i = 0; i < 300; i++) motion.advance(16);
    let walking = 0;
    for (let i = 0; i < 4000; i++) {
      const quiet = motion.advance(16);
      expect(quiet.every(pose => pose.interaction === 'none')).toBe(true);
      if (quiet.some(pose => pose.activity === 'walk')) walking++;
    }
    expect(walking).toBeGreaterThan(100);
  });
});
