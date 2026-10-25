import { describe, expect, it } from 'vitest';
import { lightContrast } from './islandLightContrast';
import { flowPoint, flowSample } from './islandFlowField';
import { ISLAND_PERIMETER } from './islandRimMotion';

const luminance = (color: readonly number[]) => color.map(channel => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
const over = (color: readonly number[], alpha: number, background: readonly number[]) => color.map((value, i) => value * alpha + background[i] * (1 - alpha));

describe('wallpaper-independent island contrast', () => {
  it('places the whole readable crest inside black, with less than 2px of inward coverage around both arcs and straights', () => {
    for (let distance = 0; distance <= ISLAND_PERIMETER; distance += 3) {
      for (const width of [2.7, 4.5, 6.8]) {
        const contrast = lightContrast(.8, 1, width, [97, 235, 255]);
        const [x, y] = flowPoint(distance, -contrast.inset);
        // The actual 168x42 black capsule is a 126px segment + radius21 caps.
        const inside = 21 - Math.hypot(x - Math.max(65, Math.min(191, x)), y - 65);
        expect(inside - contrast.crestWidth / 2).toBeGreaterThan(0);
        expect(inside + contrast.crestWidth / 2).toBeLessThan(2);
      }
    }
  });

  it('uses the same visible black-backed color crest on every wallpaper while the near tint adds contrast on light surfaces', () => {
    for (const color of [[43, 159, 255], [132, 91, 255], [249, 137, 219], [97, 235, 255]]) {
      const contrast = lightContrast(.8, 1, 5, color);
      const crest = over(color, contrast.crestAlpha, [0, 0, 0]);
      const core = over(contrast.coreColor, contrast.coreAlpha, crest);
      expect((luminance(core) + .05) / .05).toBeGreaterThan(3);
      for (const wallpaper of [[255, 255, 255], [220, 237, 250]]) {
        const tinted = over(contrast.nearColor, contrast.nearAlpha, wallpaper);
        expect(luminance(wallpaper) - luminance(tinted)).toBeGreaterThan(.15);
      }
      // It adds no near-white wash over a dark desktop.
      expect(luminance(over(contrast.nearColor, contrast.nearAlpha, [0, 0, 0]))).toBeLessThan(.02);
    }
  });

  it('retains completely clear lobe ends and bounded local alpha without creating a permanent full ring', () => {
    for (let travel = 0; travel < ISLAND_PERIMETER * 2; travel += 31) for (const lobe of [0, 1] as const) {
      for (const t of [0, .1, .3, .6, .85, 1]) {
        const field = flowSample(travel, lobe, t), contrast = lightContrast(field.opacity, 1.32, field.haloWidth, field.color);
        for (const alpha of [contrast.crestAlpha, contrast.coreAlpha, contrast.nearAlpha]) {
          expect(alpha).toBeGreaterThanOrEqual(0); expect(alpha).toBeLessThanOrEqual(1);
          if (t === 0 || t === 1) expect(alpha).toBe(0);
        }
      }
    }
  });
});
