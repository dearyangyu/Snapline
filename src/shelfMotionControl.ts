/** Calling play() on a finished Web Animation restarts it from the beginning. */
export function resumePausedAnimation(animation: Pick<Animation, 'playState' | 'play'> | null | undefined) {
  if (animation?.playState === 'paused') animation.play();
}
export function pauseRunningAnimation(animation: Pick<Animation, 'playState' | 'pause'> | null | undefined) {
  if (animation?.playState === 'running') animation.pause();
}

export interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

/** Own just this gesture, and clear ownership before capture-loss is dispatched. */
export class ShelfPointerHold {
  private pointer: { id: number; x: number; y: number; target: PointerCaptureTarget } | null = null;
  get active() { return this.pointer !== null; }
  begin(id: number, x: number, y: number, target: PointerCaptureTarget) {
    this.release();
    target.setPointerCapture(id);
    this.pointer = { id, x, y, target };
  }
  movedBeyond(id: number, x: number, y: number, distance: number) {
    const pointer = this.pointer;
    return !!pointer && pointer.id === id && Math.hypot(x - pointer.x, y - pointer.y) > distance;
  }
  release(id?: number) {
    const pointer = this.pointer;
    if (!pointer || (id !== undefined && pointer.id !== id)) return false;
    this.pointer = null;
    if (pointer.target.hasPointerCapture(pointer.id)) pointer.target.releasePointerCapture(pointer.id);
    return true;
  }
}
