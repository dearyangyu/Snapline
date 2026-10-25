export interface ShelfDragVisual {
  widthDip: number;
  heightDip: number;
  grabX: number;
  grabY: number;
  angleDeg: number;
  reducedMotion: boolean;
}
interface Transform2D { a: number; b: number; c: number; d: number }

/** Invert the source's actual pose; a rotated AABB is not the photo's size. */
export function dragVisualFromPose(
  size: { width: number; height: number },
  rect: { left: number; top: number; width: number; height: number },
  transform: Transform2D,
  pointer: { clientX: number; clientY: number },
  reducedMotion: boolean,
): ShelfDragVisual | undefined {
  const { a, b, c, d } = transform, determinant = a * d - b * c;
  if (![...Object.values(size), ...Object.values(rect), a, b, c, d, pointer.clientX, pointer.clientY].every(Number.isFinite)
    || size.width <= 0 || size.height <= 0 || rect.width <= 0 || rect.height <= 0 || Math.abs(determinant) < 1e-8) return undefined;
  const x = pointer.clientX - rect.left - rect.width / 2;
  const y = pointer.clientY - rect.top - rect.height / 2;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    widthDip: size.width * Math.hypot(a, b), heightDip: size.height * Math.hypot(c, d),
    grabX: clamp(.5 + (d * x - c * y) / determinant / size.width),
    grabY: clamp(.5 + (-b * x + a * y) / determinant / size.height),
    angleDeg: Math.atan2(b, a) * 180 / Math.PI, reducedMotion,
  };
}

export function measureShelfDragVisual(photo: HTMLElement, pointer: { clientX: number; clientY: number }): ShelfDragVisual | undefined {
  const image = photo.querySelector('img');
  if (!image) return undefined;
  try {
    const style = getComputedStyle(image);
    let matrix = new DOMMatrixReadOnly();
    for (let node: HTMLElement | null = image; node; node = node.parentElement) {
      const transform = getComputedStyle(node).transform;
      if (transform !== 'none') matrix = new DOMMatrixReadOnly(transform).multiply(matrix);
    }
    const bounds = image.getBoundingClientRect();
    return dragVisualFromPose({ width: parseFloat(style.width), height: parseFloat(style.height) },
      { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, matrix, pointer,
      matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return undefined; } // Keep normal OLE available if pose sampling fails.
}

/** Separate from the OLE gesture owner; consume before synchronous capture loss. */
export class ShelfDragVisualSource {
  private source: { id: string; pointerId: number; visual: ShelfDragVisual } | null = null;
  begin(id: string, pointerId: number, visual: ShelfDragVisual | undefined) {
    this.source = visual ? { id, pointerId, visual } : null;
  }
  take(id: string, pointerId: number) {
    const source = this.source;
    if (!source || source.id !== id || source.pointerId !== pointerId) return undefined;
    this.source = null;
    return source.visual;
  }
  cancel(pointerId?: number, id?: string) {
    if (pointerId !== undefined && this.source?.pointerId !== pointerId) return;
    if (id !== undefined && this.source?.id !== id) return;
    this.source = null;
  }
}

export interface ShelfDragVisualEvent { id: string; active: boolean; token: number }
export interface ShelfDragVisualState { id: string | null; token: number }
export const initialShelfDragVisual: ShelfDragVisualState = { id: null, token: -1 };
export function shelfDragVisualState(current: ShelfDragVisualState, event: ShelfDragVisualEvent): ShelfDragVisualState {
  if (!Number.isSafeInteger(event.token) || event.token < 0 || !event.id || event.token < current.token) return current;
  if (event.token === current.token && (!current.id || current.id !== event.id)) return current;
  if (event.active && event.token === current.token && current.id === event.id) return current;
  return { id: event.active ? event.id : null, token: event.token };
}
