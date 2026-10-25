export interface ShelfItemBounds { left: number; width: number }
export interface ShelfPosition { first: number; last: number; previous: boolean; next: boolean }

export function shelfPosition(left: number, width: number, scrollWidth: number, items: ShelfItemBounds[]): ShelfPosition {
  const maximum = Math.max(0, scrollWidth - width);
  const start = Math.max(0, Math.min(left, maximum));
  const visible = items.map((item, index) => ({ ...item, index }))
    .filter(item => item.left + item.width > start + 1 && item.left < start + width - 1);
  return {
    first: visible.length ? visible[0].index + 1 : 0,
    last: visible.length ? visible[visible.length - 1].index + 1 : 0,
    previous: start > 1,
    next: start < maximum - 1,
  };
}

// Preserve horizontal touchpad gestures while making a normal mouse wheel useful.
export function shelfWheelDelta(deltaX: number, deltaY: number, mode: number, width: number): number {
  const dominant = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return dominant * (mode === 1 ? 32 : mode === 2 ? width : 1);
}

export function shelfPageDistance(width: number): number {
  // Retain part of the previous page so the user can track their position.
  return Math.max(1, width * 0.8);
}
