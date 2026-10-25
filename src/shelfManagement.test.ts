import { describe, expect, it } from 'vitest';
import { defaultSettings, type Capture } from './model';
import { retainShelfSelection, shelfManagementItems, shelfVisibilityTargets, ShelfVisibilityBatch } from './shelfManagement';
const item = (id: string, hidden = false): Capture => ({ id, name: `${id}.png`, source: '截图', kind: 'image', thumbnail: '', path: `C:/pictures/${id}.png`, width: 800, height: 600, createdAt: Number(id) || 0, pinned: id === '2', shelfHidden: hidden });

describe('shelf management state-only operations', () => {
  it('separates shelf membership from favorites and searches only the current status without reordering the library', () => {
    const items = [item('1'), item('2', true), item('3')], original = structuredClone(items);
    expect(shelfManagementItems(items, 'visible', '').map(value => value.id)).toEqual(['3', '1']);
    expect(shelfManagementItems(items, 'hidden', '2.png').map(value => value.id)).toEqual(['2']);
    expect(shelfManagementItems(items, 'hidden', '1.png')).toEqual([]);
    expect(items).toEqual(original);
    expect(retainShelfSelection(['1', '2', '2', 'gone'], shelfManagementItems(items, 'hidden', ''))).toEqual(['2']);
  });
  it('plans unique, still-existing items whose state actually needs changing', () => {
    expect(shelfVisibilityTargets([item('1'), item('2', true), item('3')], ['2', '1', '1', 'gone'], true)).toEqual(['1']);
    expect(shelfVisibilityTargets([item('1'), item('2', true)], ['1', '2'], false)).toEqual(['2']);
  });
  it('preserves all records and metadata while serializing state changes and rejecting concurrent clicks', async () => {
    let items = [item('1'), item('2'), item('3')]; const before = structuredClone(items), settings = structuredClone(defaultSettings);
    const batch = new ShelfVisibilityBatch(), calls: string[] = [];
    let release!: () => void;
    const pending = batch.run(items, ['1', '2'], true, async (id, hidden) => {
      calls.push(id); if (id === '1') await new Promise<void>(resolve => { release = resolve; });
      items = items.map(value => value.id === id ? { ...value, shelfHidden: hidden } : value);
    });
    expect(batch.busy).toBe(true); expect(calls).toEqual(['1']);
    expect(await batch.run(items, ['3'], true, async () => { throw Error('must not run'); })).toBeNull();
    release(); expect(await pending).toEqual({ completed: ['1', '2'], pending: [] });
    expect(calls).toEqual(['1', '2']); expect(batch.busy).toBe(false);
    expect(items.map(value => ({ ...value, shelfHidden: false }))).toEqual(before);
    expect(settings).toEqual(defaultSettings); expect(items).toHaveLength(3);
  });
  it('reports partial success, leaves failed and unattempted ids retryable, and unlocks after failure', async () => {
    const batch = new ShelfVisibilityBatch(), items = [item('1', true), item('2', true), item('3', true)], calls: string[] = [];
    const error = new Error('storage unavailable');
    const result = await batch.run(items, ['1', '2', '3'], false, async id => { calls.push(id); if (id === '2') throw error; });
    expect(result).toEqual({ completed: ['1'], pending: ['2', '3'], error }); expect(calls).toEqual(['1', '2']); expect(batch.busy).toBe(false);
    expect(await batch.run(items, result!.pending, false, async () => {})).toEqual({ completed: ['2', '3'], pending: [] });
  });
});
