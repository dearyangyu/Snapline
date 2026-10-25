import { describe, expect, it } from "vitest";
import { adjacentGalleryId, clampImagePan, imageFitScale, ImagePointerGesture, masonryLayout, pointInImage, viewerKeyAction, wheelZoomFactor, zoomImageAt } from "./galleryLayout";

describe("photo wall layout", () => {
  it("lays out every image in stable reading order without overlaps or cropping dimensions", () => {
    const images = Array.from({ length: 1000 }, (_, index) => ({ width: 800, height: [600, 1200, 450, 800][index % 4] }));
    const { tiles, columns, height } = masonryLayout(images, 1500);
    expect(tiles).toHaveLength(1000);
    expect(columns).toBe(4);
    expect(height).toBeGreaterThan(70000);
    tiles.forEach((tile, index) => {
      expect(tile.left).toBeGreaterThanOrEqual(0);
      expect(tile.left + tile.width).toBeLessThanOrEqual(1500);
      expect(tile.imageHeight).toBe(Math.round(tile.width * images[index].height / images[index].width));
      if (index) expect(tile.top).toBeGreaterThanOrEqual(tiles[index - 1].top);
      for (const previous of tiles.slice(0, index).filter(other => other.left === tile.left)) expect(previous.top + previous.height).toBeLessThanOrEqual(tile.top);
    });
  });
  it("keeps narrow windows and malformed or extreme image dimensions bounded", () => {
    const result = masonryLayout([{ width: 0, height: 0 }, { width: 1, height: 30000 }, { width: 30000, height: 1 }], 280);
    expect(result.columns).toBe(1);
    expect(result.tiles.map(tile => tile.imageHeight)).toEqual([210, 720, 76]);
    expect(masonryLayout([], 1400).height).toBe(0);
    expect(masonryLayout([{ width: 100, height: 100 }], Number.NaN).tiles[0].width).toBe(1);
  });
  it("increases visible columns for compact mode while keeping the same item order", () => {
    const sizes = Array.from({ length: 30 }, () => ({ width: 800, height: 600 }));
    expect(masonryLayout(sizes, 1500, 210, 14).columns).toBeGreaterThan(masonryLayout(sizes, 1500, 290, 20).columns);
  });
});

describe("photo viewer navigation", () => {
  it("navigates stable ids and stops at the ends without wrapping unexpectedly", () => {
    expect(adjacentGalleryId(["c", "a", "b"], "a", 1)).toBe("b");
    expect(adjacentGalleryId(["c", "a", "b"], "a", -1)).toBe("c");
    expect(adjacentGalleryId(["c", "a", "b"], "b", 1)).toBe("b");
    expect(adjacentGalleryId(["c", "a", "b"], "c", -1)).toBe("c");
    expect(adjacentGalleryId(["a", "b"], "deleted-id", 1)).toBe("a");
    expect(adjacentGalleryId([], "deleted-id", -1)).toBeNull();
  });
  it("supports keyboard viewing without treating text entry as navigation", () => {
    expect(viewerKeyAction("ArrowRight", false)).toBe("next");
    expect(viewerKeyAction("ArrowLeft", false)).toBe("previous");
    expect(viewerKeyAction("+", false)).toBe("zoom-in");
    expect(viewerKeyAction("=", false)).toBe("zoom-in");
    expect(viewerKeyAction("-", false)).toBe("zoom-out");
    expect(viewerKeyAction("0", false)).toBe("fit");
    expect(viewerKeyAction("1", false)).toBe("actual-size");
    expect(viewerKeyAction("ArrowRight", true)).toBeNull();
    expect(viewerKeyAction("Escape", true)).toBe("close");
    expect(viewerKeyAction("Tab", false)).toBeNull();
  });
  it("fits landscape and portrait images and never enlarges tiny originals on open", () => {
    expect(imageFitScale({ width: 2000, height: 1000 }, { width: 1080, height: 872 })).toBe(0.5);
    expect(imageFitScale({ width: 1000, height: 2000 }, { width: 1080, height: 872 })).toBe(0.4);
    expect(imageFitScale({ width: 80, height: 30 }, { width: 1080, height: 872 })).toBe(1);
  });
  it("keeps original size at one physical pixel per image pixel at mixed DPI scales", () => {
    for (const dpi of [1, 1.25, 1.5, 2, 2.5]) {
      const scale = imageFitScale({ width: 800, height: 600 }, { width: 1200, height: 1000 }, dpi);
      expect(scale * dpi).toBeCloseTo(1);
      expect(800 * scale * dpi).toBeCloseTo(800);
    }
  });
  it("limits panning so zoom or viewport changes cannot lose the image off screen", () => {
    expect(clampImagePan({ x: 2000, y: -2000 }, { width: 1000, height: 800 }, { width: 1200, height: 1000 }, 2)).toEqual({ x: 424, y: -324 });
    expect(clampImagePan({ x: 2000, y: -2000 }, { width: 1000, height: 800 }, { width: 1200, height: 1000 }, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('shared image viewport gestures', () => {
  it('preserves the exact source pixel under an off-center pointer when zooming and reversing at different DPIs', () => {
    const image = { width: 8000, height: 6000 }, viewport = { width: 1200, height: 900 };
    for (const dpi of [1, 1.25, 1.5, 2]) {
      const from = .5 / dpi, to = .85 / dpi;
      const pan = { x: 120, y: -80 }, anchor = { x: 290, y: -180 };
      const next = zoomImageAt(pan, from, to, anchor, image, viewport);
      expect((anchor.x - next.x) / to).toBeCloseTo((anchor.x - pan.x) / from, 10);
      expect((anchor.y - next.y) / to).toBeCloseTo((anchor.y - pan.y) / from, 10);
      const restored = zoomImageAt(next, to, from, anchor, image, viewport);
      expect(restored.x).toBeCloseTo(pan.x, 10); expect(restored.y).toBeCloseTo(pan.y, 10);
    }
  });
  it('re-centers fitting images and clamps large images when the zoom anchor would move them out of reach', () => {
    const image = { width: 2000, height: 1000 }, viewport = { width: 1200, height: 900 };
    expect(zoomImageAt({ x: 300, y: 200 }, 1, .1, { x: 500, y: 300 }, image, viewport)).toEqual({ x: 0, y: 0 });
    const anchored = zoomImageAt({ x: 424, y: 74 }, 1, 2, { x: -600, y: -450 }, image, viewport);
    expect(anchored).toEqual(clampImagePan(anchored, image, viewport, 2));
    expect(pointInImage({ x: 425, y: 0 }, { x: 300, y: 0 }, { width: 200, height: 100 }, 1)).toBe(false);
    expect(pointInImage({ x: 400, y: 0 }, { x: 300, y: 0 }, { width: 200, height: 100 }, 1)).toBe(true);
  });
  it('normalizes wheel modes and bounds extreme or invalid deltas', () => {
    expect(wheelZoomFactor(1, 1, 900)).toBe(wheelZoomFactor(24, 0, 900));
    expect(wheelZoomFactor(.1, 2, 900)).toBe(wheelZoomFactor(90, 0, 900));
    expect(wheelZoomFactor(10000, 0, 900)).toBe(wheelZoomFactor(200, 0, 900));
    expect(wheelZoomFactor(NaN, 0, 900)).toBe(1);
    expect(wheelZoomFactor(-120, 0, 900) * wheelZoomFactor(120, 0, 900)).toBeCloseTo(1);
  });
  it('only dismisses a true blank click, never an image click, pan, or out-and-back drag', () => {
    const blank = new ImagePointerGesture(1, { x: 500, y: 0 }, { x: 0, y: 0 }, true);
    expect(blank.dismiss({ x: 502, y: 1 }, true)).toBe(true);
    const drag = new ImagePointerGesture(1, { x: 500, y: 0 }, { x: 10, y: 5 }, true);
    expect(drag.move({ x: 510, y: 20 })).toEqual({ x: 20, y: 25 });
    expect(drag.dismiss({ x: 500, y: 0 }, true)).toBe(false);
    const imageClick = new ImagePointerGesture(2, { x: 20, y: 0 }, { x: 0, y: 0 }, false);
    expect(imageClick.dismiss({ x: 20, y: 0 }, true)).toBe(false);
    const entersImage = new ImagePointerGesture(3, { x: 500, y: 0 }, { x: 0, y: 0 }, true);
    expect(entersImage.dismiss({ x: 500, y: 0 }, false)).toBe(false);
  });
});
