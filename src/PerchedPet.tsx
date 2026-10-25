import { useLayoutEffect, useRef } from 'react';
import type { PetId } from './petCatalog';
import PerchedPetArt from './PerchedPetArt';
import SpritePet from './SpritePet';
import { isSpritePetId } from './spritePetCatalog';
import { PERCHED_POSE_FIELDS, quietPose } from './perchedPetMotion';
import './perchedPet.css';

export interface PerchedPetProps {
  petId: PetId;
  paused?: boolean;
  className?: string;
}

/** 32×30 logical artwork with rope contact at (16, 23). The shared rope owner
 * supplies all time and placement, including the final 48px display scale. */
export function PerchedPet({ petId, paused = false, className = '' }: PerchedPetProps) {
  const root = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !paused) return;
    // Preserve the explicit pause API even if an outside owner continues
    // updating inherited variables. No timer or RAF is introduced.
    const computed = getComputedStyle(element), quiet = quietPose();
    const previous = PERCHED_POSE_FIELDS.map(([, property]) => {
      const name = `--candidate-${property}`;
      return [name, element.style.getPropertyValue(name)] as const;
    });
    const frozen = PERCHED_POSE_FIELDS.map(([key, property, unit]) => {
      const name = `--candidate-${property}`;
      return [name, computed.getPropertyValue(name).trim() || `${quiet[key]}${unit}`] as const;
    });
    frozen.forEach(([name, value]) => element.style.setProperty(name, value));
    return () => { previous.forEach(([name, value]) => { if (value) element.style.setProperty(name, value); else element.style.removeProperty(name); }); };
  }, [paused]);
  return <span ref={root} className={`shelf-perched-pet perched-pet-${petId}${className ? ` ${className}` : ''}`} aria-hidden="true">
    {isSpritePetId(petId) ? <SpritePet petId={petId} mode="perched" paused={paused} /> : <PerchedPetArt petId={petId} />}
  </span>;
}

export default PerchedPet;
