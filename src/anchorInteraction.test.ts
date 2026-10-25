import { describe, expect, it, vi } from 'vitest';
import { AnchorInteractionQueue, anchorHoverRange } from './anchorInteraction';

describe('separate anchor grip sessions', () => {
  it('queues a quick release before the next press even while the first begin is pending', async () => {
    const calls: string[] = []; let resolveFirst: () => void = () => {};
    const firstBegin = new Promise<void>(resolve => { resolveFirst = resolve; });
    const queue = new AnchorInteractionQueue({
      begin: async grab => { calls.push(`begin:${grab.grabX}`); if (grab.grabX === .1) await firstBegin; },
      finish: async () => { calls.push('finish'); }, report: vi.fn(),
    });
    const first = queue.begin({ grabX: .1, grabY: .5 });
    expect(first.finish()).toBe(true); expect(first.finish()).toBe(false); // up + lostcapture
    const second = queue.begin({ grabX: .2, grabY: .5 }); second.finish();
    await Promise.resolve(); expect(calls).toEqual(['begin:0.1']);
    resolveFirst(); await queue.whenIdle();
    expect(calls).toEqual(['begin:0.1', 'finish', 'begin:0.2', 'finish']);
  });
  it('does not finish an unsuccessful begin and remains usable after errors', async () => {
    const report = vi.fn(), finish = vi.fn(async () => {}); let fail = true;
    const queue = new AnchorInteractionQueue({ begin: async () => { if (fail) throw Error('unavailable'); }, finish, report });
    queue.begin({ grabX: .1, grabY: .5 }).finish(); await queue.whenIdle();
    expect(report).toHaveBeenCalledOnce(); expect(finish).not.toHaveBeenCalled();
    fail = false; queue.begin({ grabX: .1, grabY: .5 }).finish(); await queue.whenIdle();
    expect(finish).toHaveBeenCalledOnce();
  });
  it('runs an explicit pet/gallery command after release without assigning an open action to a short grip press', async () => {
    const calls: string[] = [];
    const queue = new AnchorInteractionQueue({ begin: async () => { calls.push('begin'); }, finish: async () => { calls.push('finish'); }, report: vi.fn() });
    queue.begin({ grabX: .1, grabY: .5 }).finish(); await queue.whenIdle();
    expect(calls).toEqual(['begin', 'finish']);
    await queue.run(async () => { calls.push('pet-open'); });
    expect(calls).toEqual(['begin', 'finish', 'pet-open']);
  });
  it('uses the fixed pet container and rejects unavailable layout measurements', () => {
    expect(anchorHoverRange({ left: 31, right: 127 }, 168)).toEqual({ hoverStart: 31 / 168, hoverEnd: 127 / 168 });
    expect(anchorHoverRange({ left: 0, right: 0 }, 168)).toBeNull();
    expect(anchorHoverRange({ left: 31, right: 127 }, 0)).toBeNull();
    expect(anchorHoverRange({ left: NaN, right: 127 }, 168)).toBeNull();
  });
});
