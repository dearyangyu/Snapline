export const hoverPreviewDelay = (value: number) =>
  Number.isFinite(value) ? Math.min(5000, Math.max(1000, Math.round(value))) : 1000;
export interface HoverPreviewRequest {
  current: () => boolean;
  onCancel: (cancelPending: () => void) => void;
}

/** One dwell owner per shelf. Old card leave events cannot cancel a new owner. */
export class ShelfHoverPreviewTimer {
  private enabled = true;
  private delay = 1000;
  private owner: string | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelPending: (() => void) | undefined;
  private shownItem: string | null = null;
  private showing = false;

  configure(enabled: boolean, delay: number) {
    const nextDelay = hoverPreviewDelay(delay);
    if (this.enabled !== enabled || this.delay !== nextDelay) this.cancel();
    this.enabled = enabled;
    this.delay = nextDelay;
  }

  enter(id: string, open: (request: HoverPreviewRequest) => void) {
    if (!this.enabled || this.showing || this.shownItem === id || this.owner === id) return;
    // Choosing another card is a real intent change, unlike the pointerenter
    // synthesized when a full-screen preview disappears beneath the cursor.
    this.shownItem = null;
    this.cancel();
    this.owner = id;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const current = () => this.enabled && this.owner === id && this.generation === generation;
      if (current()) open({ current, onCancel: cancelPending => {
        if (current()) this.cancelPending = cancelPending;
        else cancelPending();
      } });
    }, this.delay);
  }

  shown(id: string) {
    this.cancel();
    this.shownItem = id;
    this.showing = true;
  }

  closed(id: string) {
    if (this.shownItem === id) this.showing = false;
  }

  leave(id?: string) {
    this.cancel(id);
    if (!this.showing && (id === undefined || this.shownItem === id)) this.shownItem = null;
  }

  explicit() {
    this.cancel();
    this.shownItem = null;
    this.showing = false;
  }

  cancel(id?: string) {
    if (id !== undefined && this.owner !== id) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.owner = null;
    this.generation++;
    const cancelPending = this.cancelPending;
    this.cancelPending = undefined;
    cancelPending?.();
  }
}

/** Native cannot reveal until the source confirms this still-current dwell. */
export async function openShelfHoverPreview(request: HoverPreviewRequest, work: {
  create: () => Promise<number>;
  confirm: (sessionId: number) => Promise<unknown>;
  cancelPending: (sessionId: number) => void;
}) {
  const sessionId = await work.create();
  request.onCancel(() => work.cancelPending(sessionId));
  if (request.current()) await work.confirm(sessionId);
}

/** A stale or failed decode must never acknowledge a newer native session. */
export async function presentShelfPreview(work: {
  current: () => boolean;
  decode: () => Promise<void>;
  paint: () => Promise<void>;
  ready: () => Promise<unknown>;
  failed: (error: unknown) => void;
}) {
  try {
    await work.decode();
    if (!work.current()) return;
    await work.paint();
    if (work.current()) await work.ready();
  } catch (error) {
    if (work.current()) work.failed(error);
  }
}
