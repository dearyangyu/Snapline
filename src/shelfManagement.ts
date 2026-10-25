import { selectItems, type Capture } from './model';

export type ShelfManagementScope = 'visible' | 'hidden';
export function shelfManagementItems(items: Capture[], scope: ShelfManagementScope, query: string) {
  return selectItems(items, query, false, 'all').filter(item => !!item.shelfHidden === (scope === 'hidden'));
}
export function retainShelfSelection(selection: readonly string[], visible: readonly Capture[]) {
  const valid = new Set(visible.map(item => item.id));
  return [...new Set(selection)].filter(id => valid.has(id));
}
export function shelfVisibilityTargets(items: readonly Capture[], selection: readonly string[], hidden: boolean) {
  const eligible = new Set(items.filter(item => !!item.shelfHidden !== hidden).map(item => item.id));
  return [...new Set(selection)].filter(id => eligible.has(id));
}
export interface ShelfBatchResult { completed: string[]; pending: string[]; error?: unknown }
/** Serialize the existing state-only command. A failed write stops the batch;
 * completed items stay completed and unattempted selections remain retryable. */
export class ShelfVisibilityBatch {
  busy = false;
  async run(items: readonly Capture[], selection: readonly string[], hidden: boolean, write: (id: string, hidden: boolean) => Promise<void>): Promise<ShelfBatchResult | null> {
    if (this.busy) return null;
    const targets = shelfVisibilityTargets(items, selection, hidden), completed: string[] = [];
    this.busy = true;
    try {
      for (const id of targets) { await write(id, hidden); completed.push(id); }
      return { completed, pending: [] };
    } catch (error) {
      return { completed, pending: targets.slice(completed.length), error };
    } finally { this.busy = false; }
  }
}
