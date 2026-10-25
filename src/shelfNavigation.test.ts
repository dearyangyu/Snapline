import { describe, expect, it } from 'vitest';
import { shelfPageDistance, shelfPosition, shelfWheelDelta } from './shelfNavigation';

describe('shelf browsing', () => {
  const items = Array.from({ length: 35 }, (_, index) => ({ left: 18 + index * 214, width: 192 }));
  const totalWidth = items.at(-1)!.left + 192 + 18;
  it('reaches entries beyond the former twenty-item limit and disables navigation at the end', () => {
    expect(shelfPosition(0, 1000, totalWidth, items)).toEqual({ first: 1, last: 5, previous: false, next: true });
    expect(shelfPosition(totalWidth - 1000, 1000, totalWidth, items)).toEqual({ first: 31, last: 35, previous: true, next: false });
    expect(shelfPosition(totalWidth + 20, 1000, totalWidth, items).last).toBe(35);
  });
  it('handles an empty shelf, a single item, fractional scroll positions, and a narrower viewport', () => {
    expect(shelfPosition(0, 1000, 1000, [])).toEqual({ first: 0, last: 0, previous: false, next: false });
    expect(shelfPosition(0, 1000, 1000, items.slice(0, 1))).toEqual({ first: 1, last: 1, previous: false, next: false });
    expect(shelfPosition(totalWidth - 320 - 0.5, 320, totalWidth, items)).toEqual({ first: 34, last: 35, previous: true, next: false });
  });
  it('maps vertical mouse wheels and horizontal touchpads without double-counting diagonal input', () => {
    expect(shelfWheelDelta(0, 120, 0, 1000)).toBe(120);
    expect(shelfWheelDelta(-12.5, 1, 0, 1000)).toBe(-12.5);
    expect(shelfWheelDelta(20, 30, 0, 1000)).toBe(30);
    expect(shelfWheelDelta(0, -3, 1, 1000)).toBe(-96);
    expect(shelfWheelDelta(0, 1, 2, 1000)).toBe(1000);
    expect(shelfPageDistance(1000)).toBe(800);
  });
});
