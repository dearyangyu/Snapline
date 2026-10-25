import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Capture } from './model';
import { finishShelfExit, reconcileShelfCards, SHELF_EXIT_MS, type ShelfCard } from './shelfCards';

export function useShelfCards(items: Capture[], enabled: boolean, visible: boolean) {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [state, setState] = useState<{ cards: ShelfCard[]; revision: number }>(() => ({ cards: reconcileShelfCards([], items, false, 0), revision: 0 }));
  const nextToken = useRef(0);
  const deadlines = useRef(new Map<string, { token: number; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useLayoutEffect(() => {
    const token = ++nextToken.current;
    setState(old => ({ ...old, cards: reconcileShelfCards(old.cards, items, enabled && visible && !reduced, token) }));
  }, [items, enabled, visible, reduced]);
  const finish = useCallback((id: string, token: number) => {
    setState(old => {
      const cards = finishShelfExit(old.cards, id, token);
      return cards === old.cards ? old : { cards, revision: old.revision + 1 };
    });
  }, []);
  useLayoutEffect(() => {
    const pending = deadlines.current;
    for (const [id, entry] of pending) {
      if (!state.cards.some(card => card.item.id === id && card.exitToken === entry.token)) {
        clearTimeout(entry.timer); pending.delete(id);
      }
    }
    for (const card of state.cards) {
      if (card.exitToken === null || pending.has(card.item.id)) continue;
      const id = card.item.id, token = card.exitToken;
      pending.set(id, { token, timer: setTimeout(() => finish(id, token), SHELF_EXIT_MS + 40) });
    }
  }, [state.cards, finish]);
  useEffect(() => () => {
    for (const entry of deadlines.current.values()) clearTimeout(entry.timer);
    deadlines.current.clear();
  }, []);
  return { ...state, reduced, finish };
}
