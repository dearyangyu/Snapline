import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { ropeY } from './clothesline';
import type { PetId } from './petCatalog';
import { PerchMotion, applyPerchedPose } from './perchedPetMotion';
import { paintSpritePet } from './SpritePet';
import { isSpritePetId } from './spritePetCatalog';
import { spriteFromPerchIntent } from './spritePetMotion';
import { ShelfRopeMotion, bindRopePerch, resolveRopePerches, ropeAttachment, ropeBindingFits, ropePerchScale, ropePerches, ropeReleaseMatches, type RopePerchBinding } from './shelfRopeMotion';

interface Options {
  enabled: boolean;
  root: RefObject<HTMLElement | null>;
  track: RefObject<HTMLDivElement | null>;
  rope: RefObject<SVGSVGElement | null>;
  pets: readonly PetId[];
  interactions?: boolean;
  generation: number;
  visible: boolean;
  reversing: boolean;
  reflows?: RefObject<Map<string, Animation>>;
  reducedMotion?: boolean;
}
interface Card { element: HTMLElement; id: string; center: number; baseY: number; animation?: Animation; x: number; y: number }

/** One active clock drives the SVG, metal clips and pet contact points. Layout
 * is read only on refresh/scroll/resize; frames only sample cached geometry and
 * WAAPI's easing progress, then write independent CSS variables. */
export function useShelfRopeMotion(options: Options) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<{ refresh: () => void; sync: () => void } | null>(null);
  const refresh = useCallback(() => controller.current?.refresh(), []);

  useLayoutEffect(() => {
    if (!options.enabled) return;
    const root = options.root.current, track = options.track.current, rope = options.rope.current;
    if (!root || !track || !rope) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)'), motion = new ShelfRopeMotion();
    let petSelection = options.pets.join(','), petMotion = new PerchMotion(options.pets.length);
    let frame = 0, previous: number | undefined, stopped = false, width = 1, lastPath = '', clockWasActive = false;
    let cards: Card[] = [], paths: SVGPathElement[] = [], perches: { element: HTMLElement; binding: RopePerchBinding; available: boolean; visible: boolean; sprite: HTMLElement | null }[] = [];
    let bindings: RopePerchBinding[] = [], bindingGeneration = -1, bindingSelection = '', bindingWidth = 0, scrollLeft = 0;
    let geometryDirty = true, ropeDirty = true, reflowing = false, visiblePetCount = 0;
    let held: { id: number; owner: HTMLElement; capture: HTMLElement | null } | null = null;
    const pausedReflows = new Set<Animation>();
    const reduced = () => media.matches || latest.current.reducedMotion === true;
    const paused = () => !latest.current.visible || document.hidden || !!held || reduced();
    const cancelFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; previous = undefined; };
    const layout = () => {
      geometryDirty = true; ropeDirty = true;
      width = Math.max(1, track.clientWidth);
      paths = Array.from(rope.querySelectorAll<SVGPathElement>('[data-rope-path]'));
      scrollLeft = track.scrollLeft;
      cards = Array.from(track.querySelectorAll<HTMLElement>('.hanging-card')).map(element => {
        const center = element.offsetLeft + element.offsetWidth / 2 - scrollLeft;
        const animation = latest.current.reflows?.current.get(element.dataset.shelfId ?? '');
        const first = animation?.effect instanceof KeyframeEffect ? animation.effect.getKeyframes()[0] : undefined;
        const transform = first?.transform ? new DOMMatrixReadOnly(String(first.transform)) : new DOMMatrixReadOnly();
        if (held && animation?.playState === 'running') { animation.pause(); pausedReflows.add(animation); }
        return { element, id: element.dataset.shelfId ?? '', center, baseY: ropeY(center, width), animation, x: transform.m41, y: transform.m42 };
      });
      const state = latest.current, selection = state.pets.join(',');
      const ids = cards.map(card => card.id);
      if ((state.generation !== bindingGeneration && !state.reversing) || selection !== bindingSelection || width !== bindingWidth ||
        bindings.some(binding => !ropeBindingFits(binding, ids))) {
        const spots = ropePerches(width, state.pets.length, cards.map(card => card.center));
        bindings = spots.map(spot => bindRopePerch(spot.x, cards.map(card => ({ id: card.id, x: card.center })), scrollLeft));
      }
      bindingGeneration = state.generation; bindingSelection = selection; bindingWidth = width;
      perches = Array.from(root.querySelectorAll<HTMLElement>('[data-rope-pet]')).map((element, i) => {
        const binding = bindings[i];
        const sprite = element.querySelector<HTMLElement>('[data-sprite-pet]');
        element.style.visibility = binding ? '' : 'hidden';
        return { element, binding: binding ?? bindRopePerch(width / 2, [], scrollLeft), available: !!binding, visible: false,
          sprite };
      });
    };
    const paintGeometry = () => {
      if (ropeDirty) {
        const path = motion.path(width);
        if (path !== lastPath) { paths.forEach(element => element.setAttribute('d', path)); lastPath = path; }
      }
      reflowing = false; visiblePetCount = 0;
      const pegPositions = new Map<string, number>();
      for (const card of cards) {
        const progress = card.animation?.effect?.getComputedTiming().progress;
        const remaining = typeof progress === 'number' ? 1 - progress : 0;
        const center = card.center + card.x * remaining;
        pegPositions.set(card.id, center);
        const attachment = ropeAttachment(motion, width, card.center, card.baseY, card.x * remaining, card.y * remaining);
        if (center > -100 && center < width + 100) {
          card.element.style.setProperty('--rope-offset', `${attachment.offset.toFixed(3)}px`);
          card.element.style.setProperty('--rope-angle', `${attachment.angle.toFixed(3)}deg`);
        }
        if (card.animation?.playState === 'running') reflowing = true;
      }
      const positions = resolveRopePerches(perches.map(perch => perch.binding), pegPositions, scrollLeft);
      for (let index = 0; index < perches.length; index++) {
        const perch = perches[index], x = positions[index], pose = motion.sample(x, width);
        const scale = ropePerchScale(x, width, [...pegPositions.values()], positions.filter((_, i) => i !== index));
        // Full 48px bodies on a deep desktop rope; shallow/edge slots shrink
        // against the maximum approved action envelope, never a preview offset.
        perch.element.style.transform = `translate(${(x - 16).toFixed(3)}px, ${(pose.y - 23).toFixed(3)}px) rotate(${pose.angle.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
        perch.visible = perch.available && scale > .1 && x > -32 && x < width + 32;
        perch.element.style.visibility = perch.visible ? '' : 'hidden';
        if (perch.visible) visiblePetCount++;
      }
      geometryDirty = false; ropeDirty = false;
    };
    const paintPets = (elapsed: number) => {
      const frames = petMotion.advance(elapsed, paused(), reduced());
      // One intention scheduler owns every visual slot. A sprite can answer a
      // vector neighbor; only the final rendering (source cell vs SVG) differs.
      for (let index = 0; index < perches.length; index++) {
        const perch = perches[index], frame = frames[index], petId = latest.current.pets[index];
        if (!frame) continue;
        if (!perch.visible) continue;
        if (perch.sprite && isSpritePetId(petId)) {
          const resident = petMotion.residents[index];
          paintSpritePet(perch.sprite, spriteFromPerchIntent(petId, {
            action: frame.action, elapsed: reduced() ? 0 : petMotion.time - resident.start,
            direction: resident.direction, reply: resident.replyTo !== undefined,
          }));
        } else {
          applyPerchedPose(perch.element, frame.pose);
        }
      }
    };
    const tick = (time: number) => {
      frame = 0;
      if (stopped || paused()) { previous = undefined; return; }
      const elapsed = previous === undefined ? 0 : time - previous;
      if (motion.moving) ropeDirty = true;
      motion.advance(elapsed);
      previous = time;
      if (geometryDirty || ropeDirty || reflowing) paintGeometry();
      paintPets(elapsed);
      if (motion.moving || reflowing || visiblePetCount > 0) frame = requestAnimationFrame(tick); else previous = undefined;
    };
    const sync = (preserveClock = false) => {
      if (stopped) return;
      const priorTime = previous, active = !paused();
      cancelFrame();
      if (preserveClock && clockWasActive && active) previous = priorTime;
      clockWasActive = active;
      const state = latest.current;
      const selection = state.pets.join(',');
      if (selection !== petSelection) {
        petMotion = new PerchMotion(state.pets.length);
        petSelection = selection;
      }
      petMotion.setInteractions(state.interactions !== false);
      motion.present(state.generation, state.visible, state.reversing);
      motion.advance(0, paused(), reduced());
      root.style.setProperty('--perch-play-state', paused() ? 'paused' : 'running');
      if (reduced()) ropeDirty = true;
      if (geometryDirty || ropeDirty || reflowing) paintGeometry();
      paintPets(0);
      if (!paused() && (motion.moving || reflowing || visiblePetCount > 0)) frame = requestAnimationFrame(tick);
    };
    const refreshLayout = () => { layout(); lastPath = ''; sync(true); };
    const release = (event?: Event) => {
      const current = held;
      if (!current) return;
      if (event instanceof PointerEvent) {
        if (!ropeReleaseMatches(current, event, event.target instanceof Element && event.target.hasPointerCapture(current.id))) return;
      }
      held = null;
      if (current.capture?.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id);
      for (const animation of pausedReflows) if (latest.current.visible && animation.playState === 'paused') animation.play();
      pausedReflows.clear(); sync();
    };
    const hold = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || held || !latest.current.visible) return;
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
      if (!button) return;
      // Photo capture remains entirely owned by ImageDragGesture/HangingCard.
      const capture = button.classList.contains('hanging-photo') ? null : button;
      held = { id: event.pointerId, owner: button, capture };
      if (capture && !capture.hasPointerCapture(event.pointerId)) capture.setPointerCapture(event.pointerId);
      for (const card of cards) if (card.animation?.playState === 'running') { card.animation.pause(); pausedReflows.add(card.animation); }
      sync();
    };
    const visibility = () => { if (document.hidden) release(); sync(); };
    const preference = () => sync();
    const observer = new ResizeObserver(refreshLayout);
    observer.observe(track);
    root.addEventListener('pointerdown', hold, true);
    root.addEventListener('lostpointercapture', release);
    track.addEventListener('scroll', refreshLayout, { passive: true });
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release); window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', preference);
    controller.current = { refresh: refreshLayout, sync: () => { if (!latest.current.visible) release(); refreshLayout(); } };
    refreshLayout();
    return () => {
      stopped = true; cancelFrame(); controller.current = null;
      observer.disconnect(); root.removeEventListener('pointerdown', hold, true); root.removeEventListener('lostpointercapture', release);
      track.removeEventListener('scroll', refreshLayout);
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference);
      release(); root.style.setProperty('--perch-play-state', 'paused');
    };
  }, [options.enabled]);
  const selection = options.pets.join(',');
  useLayoutEffect(() => { controller.current?.sync(); }, [options.generation, options.visible, options.reversing, options.reducedMotion, options.interactions, selection]);
  return { refresh };
}
