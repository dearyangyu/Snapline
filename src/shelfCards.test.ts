import { describe, expect, it } from 'vitest';
import type { Capture } from './model';
import { finishShelfExit, reconcileShelfCards, shelfReflowOffset } from './shelfCards';
const image = (id: string, shelfHidden = false): Capture => ({ id, name: `${id}.png`, path: id, thumbnail: '', kind: 'image', width: 100, height: 80, createdAt: 0, source: 'screenshot', pinned: false, shelfHidden });
describe('shelf dismissal presentation', () => {
  it('retains only newly hidden cards in their original library order without changing true shelf membership', () => {
    const initial = reconcileShelfCards([], [image('a'), image('b'), image('c')], false, 0);
    const items = [image('a'), image('b', true), image('c')];
    const exiting = reconcileShelfCards(initial, items, true, 1);
    expect(exiting.map(card => [card.item.id, card.exitToken])).toEqual([['a', null], ['b', 1], ['c', null]]);
    expect(items[1].shelfHidden).toBe(true);
    expect(finishShelfExit(exiting, 'b', 1).map(card => card.item.id)).toEqual(['a', 'c']);
  });
  it('does not restart exits on metadata updates and supports independently finishing several cards', () => {
    const initial = reconcileShelfCards([], [image('a'), image('b')], false, 0);
    const one = reconcileShelfCards(initial, [image('a', true), image('b')], true, 1);
    const both = reconcileShelfCards(one, [{ ...image('a', true), pinned: true }, image('b', true)], true, 2);
    expect(both.map(card => card.exitToken)).toEqual([1, 2]);
    expect(finishShelfExit(both, 'a', 1).map(card => card.item.id)).toEqual(['b']);
  });
  it('cancels an exit on quick restore and rejects completion from the previous hide', () => {
    const initial = reconcileShelfCards([], [image('a')], false, 0);
    const exiting = reconcileShelfCards(initial, [image('a', true)], true, 1);
    const restored = reconcileShelfCards(exiting, [image('a')], true, 2);
    expect(finishShelfExit(restored, 'a', 1)).toBe(restored);
    const hiddenAgain = reconcileShelfCards(restored, [image('a', true)], true, 3);
    expect(finishShelfExit(hiddenAgain, 'a', 1)).toBe(hiddenAgain);
    expect(finishShelfExit(hiddenAgain, 'a', 3)).toEqual([]);
  });
  it('clears visual tails immediately for closed shelves or reduced motion and never animates library deletion', () => {
    const initial = reconcileShelfCards([], [image('a'), image('b')], false, 0);
    const exiting = reconcileShelfCards(initial, [image('a', true), image('b')], true, 1);
    expect(reconcileShelfCards(exiting, [image('a', true), image('b')], false, 2).map(card => card.item.id)).toEqual(['b']);
    expect(reconcileShelfCards(initial, [image('b')], true, 3).map(card => card.item.id)).toEqual(['b']);
    expect(reconcileShelfCards([], [image('a', true), image('b')], true, 4).map(card => card.item.id)).toEqual(['b']);
  });
  it('continues interrupted reflow from the current visual position in both axes', () => {
    expect(shelfReflowOffset({ left: 174, top: 40 }, { left: 0, top: 25 })).toEqual({ x: 174, y: 15 });
    expect(shelfReflowOffset({ left: 0, top: 25 }, { left: -174, top: 10 }, { x: 60, y: 5 })).toEqual({ x: 234, y: 20 });
  });
});
