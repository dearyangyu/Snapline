import { clamp, fitPanel, type Point, type Rect } from '../captureGeometry';
import type { Tool } from '../editor/document';
export type CaptureTool = Exclude<Tool, 'crop'> | 'blur' | 'eraser';
export type ShortcutIntent = { kind: 'tool'; tool: CaptureTool | null } | { kind: 'width'; delta: number } | { kind: 'undo' | 'redo' | 'copy' | 'save' | 'pin' | 'all' | 'escape' | 'text-confirm' | 'toggle-toolbar' } | null;
export function captureShortcutInput(tagName: string, role: string | null, editable: boolean) {
  return editable || ['input', 'textarea', 'select'].includes(tagName.toLowerCase()) || role === 'combobox';
}
export function shortcutIntent(key: string, ctrl: boolean, shift: boolean, input: boolean, composing: boolean, button = false): ShortcutIntent {
  if (composing) return null;
  if (key === 'Escape') return { kind: 'escape' };
  if (input) return ctrl && key === 'Enter' ? { kind: 'text-confirm' } : null;
  // Enter/Space must activate the focused button, not export the screenshot.
  if (button && (key === 'Enter' || key === ' ')) return null;
  const lower = key.toLowerCase();
  if (ctrl) {
    if (lower === 'z') return { kind: shift ? 'redo' : 'undo' };
    if (lower === 'y') return { kind: 'redo' };
    if (lower === 'c') return { kind: 'copy' };
    if (lower === 's') return { kind: 'save' };
    if (lower === 't') return { kind: 'pin' };
    if (lower === 'a') return { kind: 'all' };
    return null;
  }
  if (key === 'Enter') return { kind: 'copy' };
  if (key === ' ') return { kind: 'toggle-toolbar' };
  if (key === '[' || key === ']') return { kind: 'width', delta: key === '[' ? -1 : 1 };
  const keys: Record<string, CaptureTool | null> = { v: null, r:'rect', o:'ellipse', a:'arrow', l:'line', b:'pen', p:'pen', h:'highlight', m:'mosaic', t:'text', e:'eraser', n:'step' };
  return Object.prototype.hasOwnProperty.call(keys, lower) ? { kind: 'tool', tool: keys[lower] } : null;
}
export function constrainPoint(origin: Point, next: Point, tool: CaptureTool, shift: boolean, bounds?: Rect): Point {
  if (!shift) return next;
  const dx = next.x - origin.x, dy = next.y - origin.y;
  let result = next;
  if (tool === 'rect' || tool === 'ellipse') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    result = { x: origin.x + (dx < 0 ? -side : side), y: origin.y + (dy < 0 ? -side : side) };
  }
  if (tool === 'line' || tool === 'arrow') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), length = Math.hypot(dx, dy);
    result = { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
  }
  if (!bounds) return result;
  // Clip a constrained vector as a whole; clipping each axis separately turns
  // squares into rectangles and diagonal lines into arbitrary angles at edges.
  const vx = result.x - origin.x, vy = result.y - origin.y;
  const tx = vx > 0 ? (bounds.x + bounds.width - origin.x) / vx : vx < 0 ? (bounds.x - origin.x) / vx : Infinity;
  const ty = vy > 0 ? (bounds.y + bounds.height - origin.y) / vy : vy < 0 ? (bounds.y - origin.y) / vy : Infinity;
  const factor = Math.max(0, Math.min(1, tx, ty));
  return { x: origin.x + vx * factor, y: origin.y + vy * factor };
}
export function textDismissal(text: string, composing: boolean, reason: 'cancel' | 'finish'): 'commit' | 'discard' | 'defer' {
  if (composing) return 'defer';
  return reason === 'finish' && text.trim() ? 'commit' : 'discard';
}
export function imagePosition(point: Point, viewport: {width:number;height:number}, source: {width:number;height:number}, crop: Rect): Point {
  return { x: clamp(point.x * source.width / viewport.width, crop.x, crop.x + crop.width), y: clamp(point.y * source.height / viewport.height, crop.y, crop.y + crop.height) };
}
export function toolbarPosition(selection: Rect, panel: {width:number;height:number}, monitor: Rect): Point {
  const gap = 10, below = selection.y + selection.height + gap;
  const y = below + panel.height <= monitor.y + monitor.height - 8 ? below
    : selection.y - gap - panel.height >= monitor.y + 8 ? selection.y - gap - panel.height
    : selection.y + selection.height - gap - panel.height;
  return fitPanel({x:selection.x + selection.width - panel.width,y},panel.width,panel.height,monitor,8);
}
