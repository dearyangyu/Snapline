export interface ShelfPresentationEvent {
  phase: 'prepare' | 'open' | 'close';
  token: number;
}
export type ShelfPresentationPhase = 'hidden' | ShelfPresentationEvent['phase'];

/** Ignore delayed IPC from an earlier close, capture, or reopen request. */
export function acceptsShelfPresentation(currentToken: number, currentPhase: ShelfPresentationPhase, next: ShelfPresentationEvent): boolean {
  if (!Number.isSafeInteger(next.token) || next.token < 0 || next.token < currentToken) return false;
  if (next.phase === 'open') return (next.token === currentToken && currentPhase === 'prepare') ||
    (next.token > currentToken && currentPhase === 'close');
  if (next.phase === 'prepare') return next.token > currentToken || currentPhase === 'hidden';
  return next.phase === 'close' && currentPhase !== 'hidden' && (next.token > currentToken || currentPhase !== 'close');
}

/** Two frames: the first callback runs before paint, the next observes that turn. */
export function afterShelfPaint(callback: () => void, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, contentVisible = () => true) {
  let cancelled = false;
  const observe = () => {
    if (cancelled) return;
    if (!contentVisible()) { frame = requestFrame(observe); return; }
    frame = requestFrame(() => {
      if (cancelled) return;
      if (!contentVisible()) { frame = requestFrame(observe); return; }
      callback();
    });
  };
  let frame = requestFrame(observe);
  return () => { cancelled = true; cancelFrame(frame); };
}
