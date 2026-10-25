import { useEffect, useRef, type CSSProperties } from 'react';
import { PetAvatar } from './PetAvatar';
import { normalizeIslandPets, PET_CATALOG, type PetId } from './petCatalog';
import { IslandPetMotion, type PetPose } from './islandPetMotion';
import { IslandPetGroupMotion } from './islandPetGroupMotion';
import { isSpritePetId } from './spritePetCatalog';
import { SpritePetIslandMotion } from './spritePetMotion';
import { paintSpritePet } from './SpritePet';
import './islandPet.css';

/** Decorative pixels only. The surrounding, stationary button owns all input. */
export default function IslandPet({ pets, interactions = true, paused = false }: { pets?: PetId[]; interactions?: boolean; paused?: boolean }) {
  const selected = normalizeIslandPets(pets), selection = selected.join(',');
  const elements = useRef<(HTMLSpanElement | null)[]>([]);
  const controller = useRef<{ sync: () => void } | null>(null);
  const options = useRef({ paused, interactions });
  options.current = { paused, interactions };

  useEffect(() => {
    const members = selection.split(',') as PetId[];
    const motion = members.length === 1 ? new IslandPetMotion() : null;
    const group = members.length > 1 ? new IslandPetGroupMotion(members.length, options.current.interactions, Math.random, members.map(id => PET_CATALOG.find(pet => pet.id === id)!.personality)) : null;
    const sprites = members.map(id => isSpritePetId(id) ? new SpritePetIslandMotion(id) : null);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous: number | undefined, disposed = false;
    const lastPaint: string[] = [];
    const paint = (poses: PetPose[], elapsed: number, state: { paused: boolean; reducedMotion: boolean }) => poses.forEach((pose, i) => {
      const element = elements.current[i];
      if (!element) return;
      if (sprites[i]) {
        // Source pixels retain their aspect ratio. The shared position model
        // supplies x only; no SVG squash, synthetic blink or extra jump lift.
        element.style.setProperty('--pet-x', `${pose.x.toFixed(3)}px`);
        const root = element.querySelector<HTMLElement>('[data-sprite-pet]');
        const sample = sprites[i]!.advance(elapsed, pose, { ...state, interactions: options.current.interactions });
        if (root) paintSpritePet(root, sample);
        return;
      }
      const values = [pose.x, pose.y, pose.lean, pose.gazeX, pose.gazeY, pose.eyeOpen, pose.leftFootX, pose.leftFootY, pose.rightFootX, pose.rightFootY, pose.lift, pose.scaleX, pose.scaleY].map(value => value.toFixed(3));
      const key = values.join(',');
      if (key === lastPaint[i]) return;
      lastPaint[i] = key;
      const names = ['x', 'bob', 'lean', 'look-x', 'look-y', 'eyes', 'left-x', 'left-y', 'right-x', 'right-y', 'lift', 'scale-x', 'scale-y'];
      values.forEach((value, index) => element.style.setProperty(`--pet-${names[index]}`, `${value}${index === 2 ? 'deg' : index === 5 || index >= 11 ? '' : 'px'}`));
    });
    const advance = (elapsed: number) => {
      const state = { paused: options.current.paused || document.hidden, reducedMotion: media.matches };
      group?.setInteractions(options.current.interactions);
      paint(group ? group.advance(elapsed, state) : [motion!.advance(elapsed, state)], elapsed, state);
    };
    const stopped = () => options.current.paused || document.hidden || media.matches;
    const tick = (time: number) => {
      frame = 0;
      if (disposed || stopped()) { previous = undefined; return; }
      advance(previous === undefined ? 0 : time - previous);
      previous = time;
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (disposed) return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0; previous = undefined;
      advance(0);
      if (!stopped()) frame = requestAnimationFrame(tick);
    };
    controller.current = { sync };
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);
    sync();
    return () => {
      disposed = true; controller.current = null;
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', sync);
    };
  }, [selection]);
  useEffect(() => { controller.current?.sync(); }, [paused, interactions]);

  return <span className="anchor-pets" data-count={selected.length} aria-hidden="true">
    {selected.map((petId, index) => <span ref={element => { elements.current[index] = element; }} key={petId} className="anchor-creature"
      style={{ '--pet-x': `${selected.length === 1 ? 0 : (index - (selected.length - 1) / 2) * (selected.length === 2 ? 40 : 28)}px` } as CSSProperties}>
      <PetAvatar petId={petId} />
    </span>)}
  </span>;
}
