export interface GallerySize { width: number; height: number }
export interface GalleryTile extends GallerySize { left: number; top: number; imageHeight: number }
export interface GalleryLayout { tiles: GalleryTile[]; height: number; columns: number }

/** Shortest-column placement keeps DOM order in the same top-to-bottom order as the wall. */
export function masonryLayout(items: GallerySize[], availableWidth: number, targetWidth = 290, gap = 18): GalleryLayout {
  const width = Math.max(1, Number.isFinite(availableWidth) ? availableWidth : 1);
  const columns = Math.max(1, Math.floor((width + gap) / (targetWidth + gap)));
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const bottoms = Array<number>(columns).fill(0);
  const tiles = items.map(item => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const ratio = Number.isFinite(item.width / item.height) && item.width > 0 && item.height > 0 ? item.width / item.height : 4 / 3;
    // Very thin or very tall screenshots remain fully visible with contain, without an unbounded card.
    const imageHeight = Math.max(76, Math.min(720, Math.round(columnWidth / ratio)));
    const tile = { left: column * (columnWidth + gap), top: bottoms[column], width: columnWidth, height: imageHeight + 48, imageHeight };
    bottoms[column] += tile.height + gap;
    return tile;
  });
  return { tiles, height: items.length ? Math.max(...bottoms) - gap : 0, columns };
}

export function adjacentGalleryId(ids: string[], current: string, direction: -1 | 1): string | null {
  const index = ids.indexOf(current);
  if (index < 0) return ids[0] ?? null;
  return ids[Math.max(0, Math.min(ids.length - 1, index + direction))] ?? null;
}

/** Render scale is in CSS pixels; cap fitting at one image pixel per physical display pixel. */
export function imageFitScale(image: GallerySize, viewport: GallerySize, pixelRatio = 1): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.min(1 / ratio, Math.max(1, viewport.width - 80) / image.width, Math.max(1, viewport.height - 72) / image.height);
}

export function clampImagePan(pan: { x: number; y: number }, image: GallerySize, viewport: GallerySize, scale: number) {
  const x = Math.max(0, (image.width * scale - viewport.width) / 2 + 24);
  const y = Math.max(0, (image.height * scale - viewport.height) / 2 + 24);
  return { x: x ? Math.max(-x, Math.min(x, pan.x)) : 0, y: y ? Math.max(-y, Math.min(y, pan.y)) : 0 };
}

export interface ImagePoint { x: number; y: number }

/** The image-space point under the cursor stays put as scale changes; only
 * the final edge clamp may move it when the whole image fits on an axis. */
export function zoomImageAt(pan: ImagePoint, from: number, to: number, anchor: ImagePoint, image: GallerySize, viewport: GallerySize) {
  const ratio = from > 0 ? to / from : 1;
  return clampImagePan({ x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio }, image, viewport, to);
}

export function pointInImage(point: ImagePoint, pan: ImagePoint, image: GallerySize, scale: number) {
  return Math.abs(point.x - pan.x) <= image.width * scale / 2 && Math.abs(point.y - pan.y) <= image.height * scale / 2;
}

export function wheelZoomFactor(deltaY: number, mode: number, viewportHeight: number) {
  const pixels = deltaY * (mode === 1 ? 24 : mode === 2 ? viewportHeight : 1);
  return Math.exp(-Math.max(-200, Math.min(200, Number.isFinite(pixels) ? pixels : 0)) * .002);
}

/** A small, monotonic gesture latch prevents out-and-back drags from becoming
 * backdrop clicks. Pointer IDs are checked by the viewport owner. */
export class ImagePointerGesture {
  moved = false;
  constructor(readonly id: number, readonly origin: ImagePoint, readonly pan: ImagePoint, readonly blank: boolean) {}
  move(point: ImagePoint) {
    if (Math.hypot(point.x - this.origin.x, point.y - this.origin.y) >= 4) this.moved = true;
    return { x: this.pan.x + point.x - this.origin.x, y: this.pan.y + point.y - this.origin.y };
  }
  dismiss(point: ImagePoint, endsOnBlank: boolean) { this.move(point); return this.blank && endsOnBlank && !this.moved; }
}

export function viewerKeyAction(key: string, typing: boolean): "close" | "previous" | "next" | "zoom-in" | "zoom-out" | "fit" | "actual-size" | null {
  if (key === "Escape") return "close";
  if (typing) return null;
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-") return "zoom-out";
  if (key === "0") return "fit";
  if (key === "1") return "actual-size";
  return null;
}
