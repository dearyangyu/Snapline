import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { GripVertical, LayoutGrid } from './icons';
import { shelfItems, type AppSnapshot } from './model';
import { AnchorInteractionQueue, anchorHoverRange, type AnchorDragSession } from './anchorInteraction';
import { DEFAULT_ISLAND_PETS, normalizeIslandPets, type PetId } from './petCatalog';
import IslandPet from './IslandPet';
import IslandRim from './IslandRim';
import './topAnchor.css';

/** Native code still owns physical coordinates, hover timing and shelf visibility. */
export default function TopAnchor() {
  const [count, setCount] = useState(0);
  const [pets, setPets] = useState<PetId[]>(DEFAULT_ISLAND_PETS);
  const [petInteractions, setPetInteractions] = useState(true);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const pointerFocus = useRef(false);
  const [error, setError] = useState('');
  const petButton = useRef<HTMLButtonElement>(null);
  const queue = useRef<AnchorInteractionQueue | null>(null);
  if (!queue.current) queue.current = new AnchorInteractionQueue({
    begin: grab => invoke('begin_shelf_anchor_drag', { ...grab }),
    finish: () => invoke('finish_shelf_anchor_drag'),
    report: error => setError(String(error)),
  });
  const press = useRef<{ id: number; target: HTMLButtonElement; session: AnchorDragSession } | null>(null);
  const run = (command: string, args?: Record<string, unknown>) => queue.current!.run(async () => {
    setError(''); await invoke(command, args);
  });
  const finish = (pointerId: number, update = true) => {
    const current = press.current;
    if (!current || current.id !== pointerId) return;
    press.current = null;
    // Queue completion before capture release can fire lostpointercapture or a
    // second press. A grip release never has an open-shelf side effect.
    current.session.finish();
    if (current.target.hasPointerCapture(pointerId)) current.target.releasePointerCapture(pointerId);
    if (update) setDragging(false);
  };
  useEffect(() => {
    document.documentElement.classList.add('anchor-document');
    let stopped = false;
    let unlisten: (() => void) | undefined, offVisibility: (() => void) | undefined, visibilityRevision = 0, snapshotRevision = 0;
    const apply = (snapshot: AppSnapshot) => {
      if (stopped) return;
      setCount(shelfItems(snapshot.items).length);
      setPets(normalizeIslandPets(snapshot.settings.islandPets));
      setPetInteractions(snapshot.settings.islandPetInteractions !== false);
    };
    void listen<AppSnapshot>('library-changed', event => { snapshotRevision++; apply(event.payload); })
      .then(off => {
        if (stopped) { off(); return; }
        unlisten = off;
        const requestedAt = snapshotRevision;
        return invoke<AppSnapshot>('get_state').then(snapshot => { if (snapshotRevision === requestedAt) apply(snapshot); });
      }).catch(e => { if (!stopped) setError(String(e)); });
    void listen<boolean>('anchor-visibility', event => {
      visibilityRevision++;
      if (stopped) return;
      setVisible(event.payload);
      // NOACTIVATE hides need not produce a DOM pointerleave/blur. Do not carry
      // a stale decorative pause into the next appearance of the native island.
      if (!event.payload) { setHovered(false); setKeyboardFocused(false); pointerFocus.current = false; }
    }).then(off => {
      if (stopped) { off(); return; }
      offVisibility = off;
      const requestedAt = visibilityRevision;
      return invoke<boolean>('anchor_visual_visible').then(value => { if (!stopped && requestedAt === visibilityRevision) setVisible(value); });
    }).catch(() => {});
    // Measure the fixed middle button, never the wandering creature. Hidden
    // WebViews can suspend rAF, so acknowledge committed layout synchronously.
    const ready = () => {
      const bounds = petButton.current?.getBoundingClientRect();
      const range = bounds && anchorHoverRange(bounds, innerWidth);
      if (range) void run('anchor_ready', range);
    };
    const blur = () => {
      setHovered(false); setKeyboardFocused(false); pointerFocus.current = false;
      if (press.current) finish(press.current.id);
    };
    const observer = new ResizeObserver(ready);
    if (petButton.current) observer.observe(petButton.current);
    ready(); window.addEventListener('resize', ready); window.addEventListener('blur', blur);
    return () => {
      stopped = true; unlisten?.(); offVisibility?.(); observer.disconnect();
      window.removeEventListener('resize', ready); window.removeEventListener('blur', blur);
      if (press.current) finish(press.current.id, false);
      document.documentElement.classList.remove('anchor-document');
    };
  }, []);
  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || press.current) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setError('');
    const session = queue.current!.begin({
      grabX: event.clientX / Math.max(1, innerWidth),
      grabY: event.clientY / Math.max(1, innerHeight),
    });
    press.current = { id: event.pointerId, target: event.currentTarget, session };
    setDragging(true);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (!press.current) void run('nudge_shelf_anchor', { delta: (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 60 : 20) });
    } else if (event.key === 'Home') {
      event.preventDefault(); if (!press.current) void run('reset_shelf_anchor');
    }
  };
  return <div className={`top-anchor${dragging ? ' is-dragging' : ''}${error ? ' has-error' : ''}`}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    // The grip deliberately retains focus after a mouse drag. That focus must
    // not freeze the pet once the pointer leaves; keyboard use still pauses it,
    // including when the already-focused grip receives Arrow/Home without focusin.
    onPointerDownCapture={() => { pointerFocus.current = true; setKeyboardFocused(false); }}
    onKeyDownCapture={() => { pointerFocus.current = false; setKeyboardFocused(true); }}
    onFocusCapture={event => { setKeyboardFocused(!pointerFocus.current && event.target.matches(':focus-visible')); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false); }}>
    <IslandRim active={hovered || keyboardFocused} paused={dragging} />
    <button className="top-anchor-grip" aria-label="移动顶部入口；左右方向键微调，Home 复位" title={error || '拖动调整位置 · 方向键微调 · Home 复位'}
      onPointerDown={begin} onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
      onLostPointerCapture={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) finish(event.pointerId); }} onKeyDown={key}>
      <GripVertical aria-hidden="true" size={14} strokeWidth={1.8} />
    </button>
    <button ref={petButton} className="top-anchor-pet" aria-label={`展开晾衣架，共 ${count} 项`} title="停留或点击展开晾衣架" onClick={() => { void run('open_shelf'); }}>
      <IslandPet pets={pets} interactions={petInteractions} paused={!visible || hovered || keyboardFocused || dragging} />
    </button>
    <button className="top-anchor-gallery" aria-label="打开全屏图库" title="全屏图库" onClick={() => { void run('show_gallery'); }}>
      <LayoutGrid aria-hidden="true" size={16} strokeWidth={1.8} />
    </button>
  </div>;
}
