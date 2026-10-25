export interface AnchorGrab { grabX: number; grabY: number }
export interface AnchorDragSession { finish(): boolean }

/** Keep begin1 → finish1 → begin2 ordered even when IPC resolves after release. */
export class AnchorInteractionQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(private commands: {
    begin: (grab: AnchorGrab) => Promise<unknown>;
    finish: () => Promise<unknown>;
    report: (error: unknown) => void;
  }) {}

  run(action: () => Promise<unknown>): Promise<void> {
    this.tail = this.tail.then(action).then(() => {}, error => { this.commands.report(error); });
    return this.tail;
  }

  begin(grab: AnchorGrab): AnchorDragSession {
    let began = false, ended = false;
    void this.run(async () => { await this.commands.begin(grab); began = true; });
    return { finish: () => {
      if (ended) return false;
      ended = true;
      // Enqueue synchronously at pointerup, before another pointerdown can run.
      void this.run(async () => { if (began) await this.commands.finish(); });
      return true;
    } };
  }

  whenIdle() { return this.tail; }
}

export function anchorHoverRange(bounds: { left: number; right: number }, width: number) {
  if (![bounds.left, bounds.right, width].every(Number.isFinite) || width <= 0) return null;
  const hoverStart = Math.max(0, bounds.left / width), hoverEnd = Math.min(1, bounds.right / width);
  return hoverStart < hoverEnd ? { hoverStart, hoverEnd } : null;
}
