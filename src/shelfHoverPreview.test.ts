import { afterEach, describe, expect, it, vi } from 'vitest';
import { hoverPreviewDelay, openShelfHoverPreview, presentShelfPreview, ShelfHoverPreviewTimer, type HoverPreviewRequest } from './shelfHoverPreview';

afterEach(() => vi.useRealTimers());
describe('shelf dwell ownership', () => {
  it('uses a one-second default without changing an explicitly chosen two-second delay', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.enter('a', open); vi.advanceTimersByTime(999); expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(open).toHaveBeenCalledOnce();
    timer.configure(true, 2000); timer.enter('b', open); vi.advanceTimersByTime(1000); expect(open).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000); expect(open).toHaveBeenCalledTimes(2);
  });
  it('opens once after the chosen delay and does not restart on the same owner', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.configure(true, 2000); timer.enter('a', open);
    vi.advanceTimersByTime(1500); timer.enter('a', open); vi.advanceTimersByTime(499);
    expect(open).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(open).toHaveBeenCalledTimes(1);
    timer.enter('a', open); vi.advanceTimersByTime(5000); expect(open).toHaveBeenCalledTimes(1);
  });
  it('changing cards invalidates the old deadline and an old leave cannot cancel the new card', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), a = vi.fn(), b = vi.fn();
    timer.configure(true, 2000);
    timer.enter('a', a); vi.advanceTimersByTime(1800); timer.enter('b', b); timer.cancel('a');
    vi.advanceTimersByTime(1999); expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(b).toHaveBeenCalledOnce();
  });
  it('cancels the pending request before its deadline', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.enter('a', open); vi.advanceTimersByTime(900); timer.cancel(); vi.advanceTimersByTime(5000);
    expect(open).not.toHaveBeenCalled();
  });
  it('cancels a native request that resolves after its card was left, without cancelling the next card', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer();
    let oldRequest: HoverPreviewRequest | undefined, nextRequest: HoverPreviewRequest | undefined;
    timer.enter('a', request => { oldRequest = request; }); vi.advanceTimersByTime(2000);
    timer.cancel('a'); timer.enter('b', request => { nextRequest = request; }); vi.advanceTimersByTime(2000);
    const closeOld = vi.fn(), closeNext = vi.fn();
    oldRequest!.onCancel(closeOld); nextRequest!.onCancel(closeNext);
    expect(closeOld).toHaveBeenCalledOnce(); expect(closeNext).not.toHaveBeenCalled();
    expect(oldRequest!.current()).toBe(false); expect(nextRequest!.current()).toBe(true);
    timer.cancel(); expect(closeNext).toHaveBeenCalledOnce(); timer.cancel(); expect(closeNext).toHaveBeenCalledOnce();
  });
  it('disabled and changed delay invalidate pending work; enabling requires a fresh enter', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.enter('a', open); timer.configure(false, 2000); timer.enter('b', open); vi.advanceTimersByTime(5000);
    expect(open).not.toHaveBeenCalled(); timer.configure(true, 1000); timer.enter('a', open); vi.advanceTimersByTime(500);
    timer.configure(true, 3000); vi.advanceTimersByTime(4000); expect(open).not.toHaveBeenCalled();
    timer.enter('a', open); vi.advanceTimersByTime(3000); expect(open).toHaveBeenCalledOnce();
  });
  it('bounds stored delays and handles malformed settings', () => {
    expect([0, 999, 2000, 3000, 9000, NaN].map(hoverPreviewDelay)).toEqual([1000, 1000, 2000, 3000, 5000, 1000]);
  });
  it('does not reopen the same image when closing an overlay synthesizes pointerenter', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.enter('a', open); vi.advanceTimersByTime(2000); expect(open).toHaveBeenCalledOnce();
    timer.shown('a'); timer.leave('a'); timer.leave(); // the overlay covers the card and shelf
    timer.closed('a'); timer.enter('a', open); vi.advanceTimersByTime(5000);
    expect(open).toHaveBeenCalledOnce();
    timer.leave('a'); timer.enter('a', open); vi.advanceTimersByTime(2000);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('allows a different card or explicit action to clear the dismissal guard', () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer(), open = vi.fn();
    timer.shown('a'); timer.closed('a'); timer.enter('b', open); vi.advanceTimersByTime(2000);
    expect(open).toHaveBeenCalledOnce();
    timer.shown('b'); timer.closed('b'); timer.explicit(); timer.enter('b', open); vi.advanceTimersByTime(2000);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
describe('preview session readiness', () => {
  it('never confirms a native window created after the source hover was cancelled', async () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer();
    let resolveCreate: (id: number) => void = () => {};
    const created = new Promise<number>(resolve => { resolveCreate = resolve; });
    const confirm = vi.fn(async () => {}), cancelPending = vi.fn();
    let pending: Promise<void> | undefined;
    timer.enter('a', request => { pending = openShelfHoverPreview(request, { create: () => created, confirm, cancelPending }); });
    vi.advanceTimersByTime(2000); timer.cancel(); resolveCreate(41); await pending;
    expect(confirm).not.toHaveBeenCalled(); expect(cancelPending).toHaveBeenCalledExactlyOnceWith(41);
  });
  it('confirms a current source once and targets only its own session on later cancellation', async () => {
    vi.useFakeTimers(); const timer = new ShelfHoverPreviewTimer();
    const confirm = vi.fn(async () => {}), cancelPending = vi.fn();
    let pending: Promise<void> | undefined;
    timer.enter('a', request => { pending = openShelfHoverPreview(request, { create: async () => 42, confirm, cancelPending }); });
    vi.advanceTimersByTime(2000); await pending;
    expect(confirm).toHaveBeenCalledExactlyOnceWith(42); expect(cancelPending).not.toHaveBeenCalled();
    timer.cancel(); expect(cancelPending).toHaveBeenCalledExactlyOnceWith(42);
  });
  it('acknowledges only after decode and paint complete', async () => {
    const order: string[] = [];
    await presentShelfPreview({ current: () => true, decode: async () => { order.push('decoded'); }, paint: async () => { order.push('paint'); }, ready: async () => { order.push('ready'); }, failed: vi.fn() });
    expect(order).toEqual(['decoded', 'paint', 'ready']);
  });
  it('does not acknowledge or show an error for a session replaced during decode', async () => {
    let current = true; const ready = vi.fn(), paint = vi.fn(), failed = vi.fn();
    await presentShelfPreview({ current: () => current, decode: async () => { current = false; }, paint, ready, failed });
    expect(ready).not.toHaveBeenCalled(); expect(paint).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
  it('never shows undecodable content and does not acknowledge a session closed during paint', async () => {
    const ready = vi.fn(), failed = vi.fn(); let current = true;
    await presentShelfPreview({ current: () => true, decode: async () => { throw Error('missing file'); }, paint: vi.fn(), ready, failed });
    expect(failed).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled();
    await presentShelfPreview({ current: () => current, decode: async () => {}, paint: async () => { current = false; }, ready, failed });
    expect(ready).not.toHaveBeenCalled();
  });
});
