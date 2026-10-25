import { describe, expect, it } from 'vitest';
import { arrivalMotion, clotheslineAttachment, clotheslineLayout, clotheslineTilt, continueClotheslineMotion, dampedSpring, fitClotheslinePhoto, ropePath, ropeY, sampleClotheslineMotion, settledClotheslineMotion, shelfRevealKeyframes } from './clothesline';

describe('original clothesline geometry', () => {
  it('shows the whole portrait, landscape, square and panoramic image without cropping', () => {
    for (const [width, height] of [[80, 1600], [1600, 80], [1200, 900], [100, 100]]) {
      const fitted = fitClotheslinePhoto(width, height);
      expect(fitted.width / fitted.height).toBeCloseTo(width / height);
      expect(fitted.width).toBeLessThanOrEqual(136);
      expect(fitted.height).toBeLessThanOrEqual(104);
      expect(Math.max(fitted.width / 136, fitted.height / 104)).toBeCloseTo(1);
    }
    expect(fitClotheslinePhoto(0, 30)).toEqual({ width: 136, height: 104 });
    expect(fitClotheslinePhoto(NaN, 30)).toEqual({ width: 136, height: 104 });
  });
  it('keeps the pin slot on the rope as the same card scrolls from center to edge', () => {
    const centered = clotheslineAttachment(925, 150, 0, 2000);
    const nearEdge = clotheslineAttachment(925, 150, 950, 2000);
    expect(centered.top + 9.5).toBeCloseTo(74);
    expect(nearEdge.top + 9.5).toBeCloseTo(ropeY(50, 2000));
    expect(nearEdge.top).toBeLessThan(centered.top);
    expect(nearEdge.opacity).toBeCloseTo(50 / 90);
    expect(clotheslineAttachment(925, 150, 1200, 2000).opacity).toBe(0);
    expect(ropeY(300, 600)).toBeCloseTo(24 + 600 * 50 / 720);
  });
  it('draws a deeper, slightly asymmetric curve whose rendered path matches every pin slot', () => {
    const width = 2560;
    expect(ropeY(0, width)).toBe(24);
    expect(ropeY(width, width)).toBe(24);
    expect(ropeY(width / 2, width) - 24).toBeCloseTo(54);
    expect(ropeY(width * .75, width)).toBeGreaterThan(ropeY(width * .25, width));
    expect(ropeY(width * .75, width) - ropeY(width * .25, width)).toBeLessThan(8);
    const [x0, y0, x1, y1, x2, y2, x3, y3] = ropePath(width).match(/-?[\d.]+/g)!.map(Number);
    for (const fraction of [0, .12, .31, .5, .73, .95, 1]) {
      const inverse = 1 - fraction;
      const coordinate = (a: number, b: number, c: number, d: number) => inverse ** 3 * a + 3 * inverse ** 2 * fraction * b + 3 * inverse * fraction ** 2 * c + fraction ** 3 * d;
      const x = coordinate(x0, x1, x2, x3), y = coordinate(y0, y1, y2, y3);
      expect(ropeY(x, width)).toBeCloseTo(y, 8);
      expect(clotheslineAttachment(x - 75, 150, 0, width).top + 9.5).toBeCloseTo(y, 8);
    }
  });
  it('keeps the tallest tilted hovered photo and its inset copy feedback above the toolbar', () => {
    for (const width of [600, 1280, 1920, 2560, 3840]) {
      const angle = 2.5 * Math.PI / 180;
      const bottom = Math.max(...Array.from({ length: 101 }, (_, index) => ropeY(index / 100 * width, width)))
        + Math.sin(angle) * 72 * 1.035 + Math.cos(angle) * (14 - clotheslineLayout.pinAbove + (clotheslineLayout.photoHeight + 8) * 1.035);
      expect(bottom).toBeLessThan(clotheslineLayout.height - 35);
    }
  });
  it('keeps each photo tilt stable when other items are inserted or reordered', () => {
    const before = new Map(['photo-a', 'photo-b', 'photo-c'].map(id => [id, clotheslineTilt(id)]));
    for (const id of ['photo-c', 'new-photo', 'photo-a', 'photo-b']) {
      expect(Math.abs(clotheslineTilt(id))).toBeLessThanOrEqual(2.5);
      if (before.has(id)) expect(clotheslineTilt(id)).toBe(before.get(id));
    }
  });
});

describe('finite pendulum motion', () => {
  it('starts at the original offset and angle, overshoots both ways, and comes to rest', () => {
    const motion = settledClotheslineMotion({ angle: 16, velocity: 0, drop: -46, stiffness: 46, damping: 2.6 });
    expect(sampleClotheslineMotion(motion, 0)).toEqual({ angle: 16, velocity: 0, y: -46 });
    const values = Array.from({ length: 480 }, (_, n) => sampleClotheslineMotion(motion, n * 10));
    expect(values.some(value => value.angle < -6)).toBe(true);
    expect(values.slice(80).some(value => value.angle > 3)).toBe(true);
    expect(Math.abs(values.at(-1)!.angle)).toBeLessThan(.08);
    expect(sampleClotheslineMotion(motion, motion.duration)).toEqual({ angle: 0, velocity: 0, y: 0 });
    expect(sampleClotheslineMotion(motion, 20000)).toEqual({ angle: 0, velocity: 0, y: 0 });
  });
  it('varies adjacent photo direction, strength, timing and period without reseeding metadata renders', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `photo-${index}`);
    const plans = ids.map(id => arrivalMotion(id, 4));
    expect(plans.some(plan => plan.angle < 0)).toBe(true);
    expect(plans.some(plan => plan.angle > 0)).toBe(true);
    expect(new Set(plans.map(plan => Math.round(Math.abs(plan.angle)))).size).toBeGreaterThan(5);
    expect(new Set(plans.map(plan => Math.round(plan.delay / 10))).size).toBeGreaterThan(6);
    expect(new Set(plans.map(plan => Math.round(plan.stiffness))).size).toBeGreaterThan(8);
    expect(new Set(plans.map(plan => Math.round(plan.damping * 10))).size).toBeGreaterThan(6);
    // Reordering and unrelated renders get exactly the same plan; a real open does not.
    for (const id of [...ids].reverse()) expect(arrivalMotion(id, 4)).toEqual(plans[ids.indexOf(id)]);
    expect(ids.filter(id => arrivalMotion(id, 5).angle !== arrivalMotion(id, 4).angle)).toHaveLength(ids.length);
  });
  it('lets every varied spring settle naturally before its finite stop, including the weakest damping', () => {
    for (let generation = 1; generation <= 5; generation++) {
      for (let index = 0; index < 40; index++) {
        const motion = arrivalMotion(`photo-${index}`, generation);
        expect(Math.abs(motion.angle)).toBeGreaterThanOrEqual(5);
        expect(Math.abs(motion.angle)).toBeLessThanOrEqual(16);
        expect(motion.delay).toBeGreaterThanOrEqual(0);
        expect(motion.delay).toBeLessThanOrEqual(150);
        expect(motion.duration).toBeGreaterThan(2000);
        expect(motion.duration).toBeLessThan(5500);
        const last = sampleClotheslineMotion(motion, motion.duration - 1);
        expect(Math.abs(last.angle)).toBeLessThan(.031);
        expect(Math.abs(last.y)).toBeLessThan(.001);
        expect(sampleClotheslineMotion(motion, motion.duration)).toEqual({ angle: 0, velocity: 0, y: 0 });
        expect(sampleClotheslineMotion(motion, 60000)).toEqual({ angle: 0, velocity: 0, y: 0 });
      }
    }
  });
  it('can resume a paused or nudged spring without a position discontinuity', () => {
    const value = dampedSpring(.85, 16);
    const resumed = dampedSpring(0, value.position, value.velocity + 15, 38, 2.4);
    expect(resumed.position).toBeCloseTo(value.position);
    expect(resumed.velocity).toBeCloseTo(value.velocity + 15);
    // Finite-difference velocity agrees with the analytical velocity.
    const next = dampedSpring(.85001, 16);
    expect((next.position - value.position) / .00001).toBeCloseTo(value.velocity, 2);
  });
  it('continues a reversed close with the same position, angular velocity and vertical velocity', () => {
    const original = arrivalMotion('reverse-during-drop', 3);
    for (const at of [20, 120, 400, 1250]) {
      const continued = continueClotheslineMotion(original, at);
      expect(continued.stiffness).toBe(original.stiffness);
      expect(continued.damping).toBe(original.damping);
      // Matching later samples also checks velocity continuity; starting from
      // the same position with zero velocity would diverge immediately.
      for (const later of [0, 1, 16, 100, 250]) {
        const expected = sampleClotheslineMotion(original, at + later);
        const resumed = sampleClotheslineMotion(continued, later);
        expect(resumed.angle).toBeCloseTo(expected.angle, 8);
        expect(resumed.velocity).toBeCloseTo(expected.velocity, 8);
        expect(resumed.y).toBeCloseTo(expected.y, 8);
      }
    }
  });
  it('cannot restart an already-settled spring when a delayed reopen samples it', () => {
    const original = arrivalMotion('already-finished', 1);
    const continued = continueClotheslineMotion(original, original.duration + 100);
    expect(sampleClotheslineMotion(continued, 0)).toEqual({ angle: 0, velocity: 0, y: 0 });
    expect(sampleClotheslineMotion(continued, 200)).toEqual({ angle: 0, velocity: 0, y: 0 });
  });
  it('reveals vertically from the interrupted position with no scale animation', () => {
    const frames = shelfRevealKeyframes(-83);
    expect(frames[0].transform).toBe('translateY(-83.0000px)');
    expect(frames.at(-1)!.transform).toBe('translateY(0.0000px)');
    expect(frames.every(frame => !String(frame.transform).includes('scale'))).toBe(true);
  });
});
