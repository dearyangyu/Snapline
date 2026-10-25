import { describe, expect, it } from 'vitest';
import { dragVisualFromPose, initialShelfDragVisual, ShelfDragVisualSource, shelfDragVisualState } from './shelfDragVisual';
const visual = { widthDip: 136, heightDip: 104, grabX: .25, grabY: .75, angleDeg: 12, reducedMotion: false };
describe('shelf drag attachment pose', () => {
  it('keeps the grabbed image point under the pointer for a rotated, enlarged source', () => {
    const angle = 30 * Math.PI / 180, scale = 1.035;
    const transform = { a: scale * Math.cos(angle), b: scale * Math.sin(angle), c: -scale * Math.sin(angle), d: scale * Math.cos(angle) };
    const width = 136, height = 104, localX = -.25 * width, localY = .25 * height;
    const rect = { left: 400, top: 30, width: Math.abs(transform.a * width) + Math.abs(transform.c * height), height: Math.abs(transform.b * width) + Math.abs(transform.d * height) };
    const result = dragVisualFromPose({ width, height }, rect, transform,
      { clientX: rect.left + rect.width / 2 + transform.a * localX + transform.c * localY, clientY: rect.top + rect.height / 2 + transform.b * localX + transform.d * localY }, false)!;
    expect(result.grabX).toBeCloseTo(.25); expect(result.grabY).toBeCloseTo(.75);
    expect(result.widthDip).toBeCloseTo(width * scale); expect(result.heightDip).toBeCloseTo(height * scale);
    expect(result.angleDeg).toBeCloseTo(30); expect(result.widthDip).toBeLessThan(rect.width);
  });
  it('clamps glass-edge grabs, preserves reduced motion, and falls back for invalid geometry', () => {
    const size = { width: 100, height: 50 }, rect = { left: 20, top: 30, ...size }, transform = { a: 1, b: 0, c: 0, d: 1 };
    const result = dragVisualFromPose(size, rect, transform, { clientX: 16, clientY: 84 }, true)!;
    expect(result.grabX).toBe(0); expect(result.grabY).toBe(1); expect(result.reducedMotion).toBe(true);
    expect(dragVisualFromPose(size, rect, { ...transform, d: 0 }, { clientX: 30, clientY: 40 }, false)).toBeUndefined();
    expect(dragVisualFromPose({ ...size, width: NaN }, rect, transform, { clientX: 30, clientY: 40 }, false)).toBeUndefined();
  });
});
describe('native drag visual ownership', () => {
  it('consumes source metadata once before capture-loss cancellation and never transfers it to another pointer', () => {
    const source = new ShelfDragVisualSource(); source.begin('a', 7, visual);
    expect(source.take('a', 8)).toBeUndefined(); expect(source.take('b', 7)).toBeUndefined();
    const committed = source.take('a', 7); source.cancel(7, 'a');
    expect(committed).toBe(visual); expect(source.take('a', 7)).toBeUndefined();
  });
  it('clears a cancelled hold without allowing stale source loss to clear a new gesture', () => {
    const source = new ShelfDragVisualSource(); source.begin('a', 1, visual); source.cancel();
    expect(source.take('a', 1)).toBeUndefined(); source.begin('b', 2, visual); source.cancel(1, 'a');
    expect(source.take('b', 2)).toBe(visual);
  });
  it('restores the source for completion and rejects delayed events from an older native drag', () => {
    const first = shelfDragVisualState(initialShelfDragVisual, { id: 'a', active: true, token: 1 });
    const ended = shelfDragVisualState(first, { id: 'a', active: false, token: 1 });
    expect(ended.id).toBeNull(); expect(shelfDragVisualState(ended, { id: 'a', active: true, token: 1 })).toBe(ended);
    const next = shelfDragVisualState(ended, { id: 'b', active: true, token: 2 });
    expect(shelfDragVisualState(next, { id: 'a', active: false, token: 1 })).toBe(next);
    expect(shelfDragVisualState(next, { id: 'a', active: false, token: 2 })).toBe(next);
    expect(shelfDragVisualState(next, { id: 'b', active: false, token: 2 }).id).toBeNull();
  });
});
