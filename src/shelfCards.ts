import type { Capture } from './model';

export const SHELF_EXIT_MS = 380;
export const SHELF_REFLOW_MS = 220;
export interface ShelfCard { item: Capture; exitToken: number | null }

/** Only a newly hidden shelf item gets a visual tail; deletion is immediate. */
export function reconcileShelfCards(previous: ShelfCard[], items: Capture[], animate: boolean, token: number): ShelfCard[] {
  const before = new Map(previous.map(card => [card.item.id, card]));
  return items.flatMap<ShelfCard>(item => {
    if (!item.shelfHidden) return [{ item, exitToken: null }];
    const old = before.get(item.id);
    if (!animate || !old || (old.exitToken === null && old.item.shelfHidden)) return [];
    return [{ item, exitToken: old.exitToken ?? token }];
  });
}

export function finishShelfExit(cards: ShelfCard[], id: string, token: number): ShelfCard[] {
  if (!cards.some(card => card.item.id === id && card.exitToken === token)) return cards;
  return cards.filter(card => card.item.id !== id);
}

export function shelfReflowOffset(before: { left: number; top: number }, after: { left: number; top: number }, translation = { x: 0, y: 0 }) {
  return { x: before.left + translation.x - after.left, y: before.top + translation.y - after.top };
}
