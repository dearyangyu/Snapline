import { describe, expect, it } from 'vitest';
import { matchSelectOption, nextSelectOption, selectPopoverPlacement } from './selectBehavior';

const options = [{ value:'a', label:'Arial', disabled:true }, { value:'b', label:'Calibri' }, { value:'c', label:'Consolas' }, { value:'d', label:'Disabled', disabled:true }, { value:'e', label:'Segoe UI' }];
describe('select navigation and floating placement', () => {
  it('skips unavailable options at either edge and does not wrap arrows', () => {
    expect(nextSelectOption(options, -1, 1, true)).toBe(1);
    expect(nextSelectOption(options, -1, -1, true)).toBe(4);
    expect(nextSelectOption(options, 2, 1)).toBe(4);
    expect(nextSelectOption(options, 4, 1)).toBe(4);
    expect(nextSelectOption(options, 1, -1)).toBe(1);
    expect(nextSelectOption([{value:'x',label:'X',disabled:true}], -1, 1)).toBe(-1);
  });
  it('supports prefix lookup and repeated-letter cycling without matching disabled entries', () => {
    expect(matchSelectOption(options, 'c', 1)).toBe(2);
    expect(matchSelectOption(options, 'c', 2)).toBe(1);
    expect(matchSelectOption(options, 'cons', -1)).toBe(2);
    expect(matchSelectOption(options, 'a', -1)).toBe(-1);
    expect(matchSelectOption([], 's', -1)).toBe(-1);
  });
  it('opens upward at the bottom of the screen and keeps the popup inside narrow viewports', () => {
    const above = selectPopoverPlacement({left:720,top:540,bottom:574,width:148},{width:800,height:600},5);
    expect(above.side).toBe('above'); expect(above.left + above.width).toBeLessThanOrEqual(792);
    expect(above.top).toBeGreaterThanOrEqual(8); expect(above.top + above.maxHeight).toBeLessThan(540);
    const narrow = selectPopoverPlacement({left:90,top:20,bottom:54,width:200},{width:180,height:160},30);
    expect(narrow.width).toBe(164); expect(narrow.left).toBe(8); expect(narrow.top + narrow.maxHeight).toBeLessThanOrEqual(152);
    for (const top of [-100, 900]) {
      const moved = selectPopoverPlacement({left:600,top,bottom:top+34,width:148},{width:800,height:600},5);
      expect(moved.top).toBeGreaterThanOrEqual(8); expect(moved.top + moved.maxHeight).toBeLessThanOrEqual(592);
    }
  });
});
