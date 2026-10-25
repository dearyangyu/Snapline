import { clamp, fitPanel, type Point, type Rect } from '../captureGeometry';

export const LOUPE_WIDTH = 176;
export const LOUPE_IMAGE_HEIGHT = 84;
export const LOUPE_HEIGHT = 150;
export const LOUPE_ZOOM = 6;

type Size = { width: number; height: number };

/** Both the readout and preview use this one clamped source pixel. */
export function loupeSample(point: Point, viewport: Size, image: Size): Point {
  return {
    x: clamp(Math.floor(point.x * image.width / Math.max(1, viewport.width)), 0, Math.max(0, image.width - 1)),
    y: clamp(Math.floor(point.y * image.height / Math.max(1, viewport.height)), 0, Math.max(0, image.height - 1)),
  };
}

/** A physical source pixel is always a 6×6 CSS cell, regardless of monitor DPI. */
export function loupeBackground(sample: Point, image: Size) {
  return {
    width: image.width * LOUPE_ZOOM,
    height: image.height * LOUPE_ZOOM,
    x: LOUPE_WIDTH / 2 - (sample.x + .5) * LOUPE_ZOOM,
    y: LOUPE_IMAGE_HEIGHT / 2 - (sample.y + .5) * LOUPE_ZOOM,
  };
}

/** Flip before clamping so a screen edge does not push the card over the cursor. */
export function loupePosition(cursor: Point, monitor: Rect): Point {
  const x = cursor.x + 24 + LOUPE_WIDTH <= monitor.x + monitor.width - 8
    ? cursor.x + 24 : cursor.x - 24 - LOUPE_WIDTH;
  const y = cursor.y + 26 + LOUPE_HEIGHT <= monitor.y + monitor.height - 8
    ? cursor.y + 26 : cursor.y - 26 - LOUPE_HEIGHT;
  return fitPanel({ x, y }, LOUPE_WIDTH, LOUPE_HEIGHT, monitor);
}
