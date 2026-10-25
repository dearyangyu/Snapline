import { describe, expect, it } from 'vitest';
import { LOUPE_HEIGHT, LOUPE_IMAGE_HEIGHT, LOUPE_WIDTH, LOUPE_ZOOM, loupeBackground, loupePosition, loupeSample } from './loupe';

describe('pixel preview sampling', () => {
  it('centers the exact sampled physical pixel at every supported viewport scale', () => {
    const image = { width: 5120, height: 1440 };
    for (const scale of [1, 1.25, 1.5, 2]) {
      const viewport = { width: image.width / scale, height: image.height / scale };
      for (const physical of [{ x: 543.1, y: 82.9 }, { x: 2559.8, y: 1439.7 }, { x: 2560.2, y: 110.2 }]) {
        const sample = loupeSample({ x: physical.x / scale, y: physical.y / scale }, viewport, image);
        expect(sample).toEqual({ x: Math.floor(physical.x), y: Math.floor(physical.y) });
        const background = loupeBackground(sample, image);
        expect(background.x + (sample.x + .5) * LOUPE_ZOOM).toBe(LOUPE_WIDTH / 2);
        expect(background.y + (sample.y + .5) * LOUPE_ZOOM).toBe(LOUPE_IMAGE_HEIGHT / 2);
        expect(background.width / image.width).toBe(6);
        expect(background.height / image.height).toBe(6);
      }
    }
  });
  it('clamps edge and out-of-bounds points to real source pixels', () => {
    const image = { width: 2560, height: 1440 }, viewport = { width: 1706.6666666667, height: 960 };
    expect(loupeSample({ x: -2, y: -1 }, viewport, image)).toEqual({ x: 0, y: 0 });
    expect(loupeSample({ x: viewport.width + 5, y: viewport.height }, viewport, image)).toEqual({ x: 2559, y: 1439 });
  });
  it('flips into each monitor at the edges without covering the pointer', () => {
    for (const monitor of [{ x: 0, y: 0, width: 2560, height: 1440 }, { x: -1920, y: -540, width: 1920, height: 1080 }]) {
      for (const cursor of [
        { x: monitor.x + 2, y: monitor.y + 2 },
        { x: monitor.x + monitor.width - 2, y: monitor.y + 2 },
        { x: monitor.x + 2, y: monitor.y + monitor.height - 2 },
        { x: monitor.x + monitor.width - 2, y: monitor.y + monitor.height - 2 },
      ]) {
        const panel = loupePosition(cursor, monitor);
        expect(panel.x).toBeGreaterThanOrEqual(monitor.x + 8);
        expect(panel.y).toBeGreaterThanOrEqual(monitor.y + 8);
        expect(panel.x + LOUPE_WIDTH).toBeLessThanOrEqual(monitor.x + monitor.width - 8);
        expect(panel.y + LOUPE_HEIGHT).toBeLessThanOrEqual(monitor.y + monitor.height - 8);
        expect(cursor.x >= panel.x && cursor.x < panel.x + LOUPE_WIDTH && cursor.y >= panel.y && cursor.y < panel.y + LOUPE_HEIGHT).toBe(false);
      }
    }
  });
});
