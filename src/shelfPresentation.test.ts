import { describe, expect, it } from 'vitest';
import { acceptsShelfPresentation, afterShelfPaint, type ShelfPresentationEvent } from './shelfPresentation';

const event = (phase: ShelfPresentationEvent['phase'], token: number): ShelfPresentationEvent => ({ phase, token });
describe('clothesline visibility handshake', () => {
  it('shows only a prepared generation and rejects a delayed open after closing', () => {
    expect(acceptsShelfPresentation(4, 'prepare', event('open', 4))).toBe(true);
    expect(acceptsShelfPresentation(4, 'prepare', event('open', 5))).toBe(false);
    expect(acceptsShelfPresentation(5, 'close', event('open', 4))).toBe(false);
    expect(acceptsShelfPresentation(5, 'close', event('open', 5))).toBe(false);
  });
  it('permits a newer reopen while the close ACK is in flight, without repeating close ACKs', () => {
    expect(acceptsShelfPresentation(4, 'open', event('close', 5))).toBe(true);
    expect(acceptsShelfPresentation(5, 'close', event('close', 5))).toBe(false);
    expect(acceptsShelfPresentation(5, 'close', event('open', 6))).toBe(true);
    expect(acceptsShelfPresentation(5, 'close', event('prepare', 6))).toBe(true);
    expect(acceptsShelfPresentation(6, 'prepare', event('close', 5))).toBe(false);
  });
  it('refuses invalid tokens and unsolicited opens before preparation', () => {
    expect(acceptsShelfPresentation(-1, 'hidden', event('prepare', 0))).toBe(true);
    expect(acceptsShelfPresentation(-1, 'hidden', event('prepare', -1))).toBe(false);
    expect(acceptsShelfPresentation(-1, 'hidden', event('prepare', Infinity))).toBe(false);
    expect(acceptsShelfPresentation(-1, 'hidden', event('prepare', 1.5))).toBe(false);
    expect(acceptsShelfPresentation(-1, 'hidden', event('open', 1))).toBe(false);
  });
});

describe('native painted acknowledgement', () => {
  function frames() {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    return {
      request: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; },
      cancel: (id: number) => { callbacks.delete(id); },
      paint: () => { const turn = [...callbacks]; callbacks.clear(); turn.forEach(([, callback]) => callback(0)); },
    };
  }
  it('waits for a completed paint turn instead of hiding the entry before the first frame', () => {
    const clock = frames();
    let acknowledgements = 0;
    afterShelfPaint(() => acknowledgements++, clock.request, clock.cancel);
    expect(acknowledgements).toBe(0);
    clock.paint();
    expect(acknowledgements).toBe(0);
    clock.paint();
    expect(acknowledgements).toBe(1);
  });
  it('cancels a stale acknowledgement when a close or reopen interrupts either frame', () => {
    for (const alreadyPainted of [false, true]) {
      const clock = frames();
      let acknowledgements = 0;
      const cancel = afterShelfPaint(() => acknowledgements++, clock.request, clock.cancel);
      if (alreadyPainted) clock.paint();
      cancel();
      clock.paint(); clock.paint();
      expect(acknowledgements).toBe(0);
    }
  });
  it('does not acknowledge painted frames while the sliding content is above the viewport', () => {
    const clock = frames();
    let visible = false, acknowledgements = 0;
    afterShelfPaint(() => acknowledgements++, clock.request, clock.cancel, () => visible);
    clock.paint(); clock.paint(); clock.paint();
    expect(acknowledgements).toBe(0);
    visible = true;
    clock.paint();
    expect(acknowledgements).toBe(0);
    clock.paint();
    expect(acknowledgements).toBe(1);
  });
});
