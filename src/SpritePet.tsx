import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { getSpriteAsset, getSpritePet, SPRITE_CELL, spriteAction, spriteSample, type SpritePetId, type SpriteSample } from './spritePetCatalog';
import './spritePet.css';

export interface SpritePetProps { petId: SpritePetId; mode?: 'standing' | 'perched'; className?: string; paused?: boolean }

/** The caller owns the clock. A single full source cell is clipped in source
 * coordinates, then uniformly fitted; no pose CSS ever deforms these pixels. */
export function paintSpritePet(root: HTMLElement, sample: SpriteSample) {
  if (root.dataset.spritePaused === 'true') return;
  const action = spriteAction(sample.action);
  const frame = Math.max(0, Math.min(action.frames - 1, Math.floor(Number.isFinite(sample.frame) ? sample.frame : 0)));
  const contactY = Number.isFinite(sample.contactY) ? Math.max(0, Math.min(SPRITE_CELL.height, sample.contactY)) : 203;
  const key = `${action.row}:${frame}:${contactY}`;
  if (root.dataset.spritePaint === key) return;
  const image = root.querySelector<SVGImageElement>('[data-sprite-sheet]');
  if (!image) return;
  image.setAttribute('x', String(-SPRITE_CELL.width * frame));
  image.setAttribute('y', String(-SPRITE_CELL.height * action.row));
  root.style.setProperty('--sprite-contact-y', `${contactY}`);
  root.dataset.spritePaint = key;
  root.dataset.spriteAction = sample.action;
  root.dataset.spriteFrame = String(frame);
}

export function SpritePet({ petId, mode = 'standing', className = '', paused = false }: SpritePetProps) {
  const root = useRef<HTMLSpanElement>(null), asset = getSpritePet(petId);
  const source = getSpriteAsset(petId);
  const actionId = mode === 'perched' ? asset.resting : 'idle';
  const initial = spriteSample(petId, actionId, 0), action = spriteAction(initial.action);
  useLayoutEffect(() => { if (root.current) { delete root.current.dataset.spritePaint; paintSpritePet(root.current, initial); } }, [petId, mode, source]);
  if (!source) return null;
  return <span ref={root} className={`pet-avatar sprite-pet sprite-pet-${petId}${className ? ` ${className}` : ''}`}
    data-sprite-pet={petId} data-sprite-mode={mode} data-sprite-paused={paused ? 'true' : undefined}
    style={{ '--sprite-contact-y': initial.contactY } as CSSProperties} aria-hidden="true">
    <svg className="sprite-pet-frame" width="192" height="208" viewBox="0 0 192 208" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <svg width="192" height="208" overflow="hidden">
        <image data-sprite-sheet="" href={source} x="0" y={-action.row * SPRITE_CELL.height} width="1536" height="2288" />
      </svg>
    </svg>
  </span>;
}
export default SpritePet;
