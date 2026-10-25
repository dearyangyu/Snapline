import { describe, expect, it } from 'vitest';
import { ISLAND_PERIMETER, IslandRimMotion as FlowMotion, lightAt as flowAt } from './islandRimMotion';

import { flowLobe, flowPoint, flowSample } from './islandFlowField';

describe('flowing outer halo', () => {
  it('holds travel, ripple, width, color and brightness while motion is paused', () => {
    const motion = new FlowMotion(0);
    motion.update(true, true, 0);
    motion.update(true, false, 3800);
    const held = flowAt(motion.state, 3800);
    expect(flowAt(motion.state, 80000)).toEqual(held);
    expect(flowSample(flowAt(motion.state, 80000).travel, 0, .34)).toEqual(flowSample(held.travel, 0, .34));
    motion.update(false, false, 90000);
    expect(flowAt(motion.state, 100000)).toEqual(held);
    motion.update(false, true, 110000);
    expect(flowAt(motion.state, 110000)).toEqual(held);
  });
  it('has no discontinuity when the leading position wraps around the perimeter', () => {
    const epsilon = 1e-5;
    for (const lobe of [0, 1] as const) {
      const before = flowSample(ISLAND_PERIMETER - epsilon, lobe, .36);
      const after = flowSample(ISLAND_PERIMETER + epsilon, lobe, .36);
      expect(Math.abs(before.opacity - after.opacity)).toBeLessThan(.00001);
      expect(Math.abs(before.haloWidth - after.haloWidth)).toBeLessThan(.00001);
      const a = flowPoint(ISLAND_PERIMETER - epsilon, .7), b = flowPoint(ISLAND_PERIMETER + epsilon, .7);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(.0001);
    }
  });
  it('bounds the thin core and tail, with independently swelling opposite lobes', () => {
    let differingWidths = 0;
    for (let travel = 0; travel < ISLAND_PERIMETER * 5; travel += 17) {
      const first = flowSample(travel, 0, .3), second = flowSample(travel, 1, .3);
      if (Math.abs(first.haloWidth - second.haloWidth) > .4) differingWidths++;
      expect(flowLobe(travel, 1).head - flowLobe(travel, 0).head).toBeCloseTo(ISLAND_PERIMETER / 2);
      for (const lobe of [0, 1] as const) for (const amount of [0, 1, 1.8]) {
        const length = flowLobe(travel, lobe, amount).length;
        expect(length).toBeGreaterThanOrEqual(125); expect(length).toBeLessThanOrEqual(181);
        for (const t of [0, .13, .5, .9, 1]) {
          const sample = flowSample(travel, lobe, t, amount);
          expect(sample.edgeWidth).toBeGreaterThanOrEqual(.62); expect(sample.edgeWidth).toBeLessThanOrEqual(1.02);
          expect(sample.opacity).toBeGreaterThanOrEqual(0); expect(sample.opacity).toBeLessThanOrEqual(1);
          expect(sample.haloWidth).toBeGreaterThanOrEqual(2.7); expect(sample.haloWidth).toBeLessThanOrEqual(6.8);
        }
      }
    }
    expect(differingWidths).toBeGreaterThan(50);
  });
});
