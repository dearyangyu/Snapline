import { ShelfPointerHold, type PointerCaptureTarget } from './shelfMotionControl';

export const IMAGE_DRAG_THRESHOLD = 4;
interface PointerPosition { pointerId: number; clientX: number; clientY: number }

/** Shared by the moving clothesline and the stationary library preview. */
export class ImageDragGesture {
  private source: { id: string; pointerId: number; x: number; y: number } | null = null;
  private capture = new ShelfPointerHold();
  get active() { return this.source !== null; }
  get captured() { return this.capture.active; }
  begin(id: string, pointer: PointerPosition, target: PointerCaptureTarget) {
    this.cancel();
    this.capture.begin(pointer.pointerId, pointer.clientX, pointer.clientY, target);
    this.source = { id, pointerId: pointer.pointerId, x: pointer.clientX, y: pointer.clientY };
  }
  owns(pointerId: number, sourceId?: string) {
    return !!this.source && this.source.pointerId === pointerId && (sourceId === undefined || this.source.id === sourceId);
  }
  commitMove(pointer: PointerPosition & { buttons: number }) {
    const source = this.source;
    if (!source || source.pointerId !== pointer.pointerId || !(pointer.buttons & 1)) return null;
    if (Math.hypot(pointer.clientX - source.x, pointer.clientY - source.y) <= IMAGE_DRAG_THRESHOLD) return null;
    this.source = null; // Commit once, before capture loss can dispatch leave/cancel.
    return source.id;
  }
  releaseCapture() { this.capture.release(); }
  cancel(pointerId?: number, sourceId?: string) {
    if (pointerId !== undefined && !this.owns(pointerId, sourceId)) return false;
    if (sourceId !== undefined && this.source?.id !== sourceId) return false;
    const active = this.active || this.captured;
    this.source = null;
    this.releaseCapture();
    return active;
  }
}

const editableSelector = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
export function editableImageDragTarget(target: EventTarget | Node | null) {
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return !!element?.closest?.(editableSelector);
}

/** Only clear an existing photo selection fully owned by this interaction area. */
export function clearImageSelection(surface: Pick<Element, 'contains'>, selection: Pick<Selection, 'anchorNode' | 'focusNode' | 'removeAllRanges'> | null) {
  if (!selection?.anchorNode || !selection.focusNode) return;
  if (!surface.contains(selection.anchorNode) || !surface.contains(selection.focusNode)) return;
  if (editableImageDragTarget(selection.anchorNode) || editableImageDragTarget(selection.focusNode)) return;
  selection.removeAllRanges();
}

/** HTML selection/image DND must never compete with the explicit Windows OLE. */
export function preventImageBrowserDrag(event: { target: EventTarget | null; preventDefault(): void }) {
  if (!editableImageDragTarget(event.target)) event.preventDefault();
}

interface ShelfSelectionEvent {
  type: string;
  target: EventTarget | null;
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault(): void;
}

/** Only installed in the dedicated shelf document, where body can own a range. */
export function guardShelfDocumentSelection(event: ShelfSelectionEvent, selection: Pick<Selection, 'anchorNode' | 'focusNode' | 'removeAllRanges'> | null, activeElement: Element | null) {
  if (editableImageDragTarget(event.target)) return;
  if (event.type === 'keydown') {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key?.toLowerCase() !== 'a') return;
    if (editableImageDragTarget(activeElement)) return;
    event.preventDefault();
    selection?.removeAllRanges();
  } else if (event.type === 'pointerdown') {
    if (editableImageDragTarget(selection?.anchorNode ?? null) || editableImageDragTarget(selection?.focusNode ?? null)) return;
    selection?.removeAllRanges();
  }
}
