import { describe, expect, it } from 'vitest';
import { pauseRunningAnimation, resumePausedAnimation, ShelfPointerHold } from './shelfMotionControl';

describe('interrupted shelf gestures', () => {
  it('resumes only paused motion, never replaying a just-finished arrival', () => {
    const played: string[] = [];
    for (const state of ['idle', 'running', 'paused', 'finished'] as AnimationPlayState[]) {
      resumePausedAnimation({ playState: state, play: () => { played.push(state); } });
    }
    expect(played).toEqual(['paused']);
    expect(() => resumePausedAnimation(null)).not.toThrow();
  });
  it('does not turn a finished arrival into a paused-at-end animation that play would restart', () => {
    let restarts = 0;
    const animation = {
      playState: 'finished' as AnimationPlayState,
      pause() { this.playState = 'paused'; },
      play() { restarts++; },
    };
    // A pointer press can beat the queued WAAPI finish callback that clears it.
    pauseRunningAnimation(animation);
    resumePausedAnimation(animation);
    expect(restarts).toBe(0);
    expect(animation.playState).toBe('finished');
  });
  it('clears ownership before capture loss, so OLE handoff cannot cancel the pending drag', () => {
    const hold = new ShelfPointerHold();
    const events: string[] = [];
    let captured = false;
    const target = {
      setPointerCapture: () => { captured = true; },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
        // Simulate synchronous capture-loss arriving during handoff.
        if (hold.release(7)) events.push('cancel-parent-hold');
      },
    };
    hold.begin(7, 20, 30, target);
    expect(hold.movedBeyond(7, 27, 30, 9)).toBe(false);
    expect(hold.movedBeyond(7, 30, 30, 9)).toBe(true);
    expect(hold.release(7)).toBe(true);
    events.push('start-native-drag');
    expect(events).toEqual(['start-native-drag']);
    expect(hold.active).toBe(false);
  });
  it('cancels hidden/removed holds once and ignores unrelated or stale pointer releases', () => {
    const hold = new ShelfPointerHold();
    const captures = new Set<number>();
    const target = { setPointerCapture: (id: number) => { captures.add(id); }, hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => { captures.delete(id); } };
    hold.begin(5, 0, 0, target);
    expect(hold.release(9)).toBe(false);
    expect(hold.active).toBe(true);
    expect(hold.release()).toBe(true); // close / prepare / unmount
    expect(hold.release(5)).toBe(false); // later capture-loss from that close
    hold.begin(9, 1, 1, target);
    expect(hold.release(5)).toBe(false);
    expect(hold.active).toBe(true);
    captures.clear(); // OS has already removed capture before notifying us.
    expect(hold.release(9)).toBe(true);
    expect(hold.active).toBe(false);
  });
});
