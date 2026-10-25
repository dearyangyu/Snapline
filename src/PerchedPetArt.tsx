import { useId } from 'react';
import PetAvatar from './PetAvatar';
import { PET_CATALOG, type PetId } from './petCatalog';
import './perchedPetArt.css';

export default function PerchedPetArt({ petId }: { petId: PetId }) {
  const unique = useId().replace(/:/g, '');
  const { colors } = PET_CATALOG.find(pet => pet.id === petId) ?? PET_CATALOG[0];
  const coatId = `candidate-coat-${unique}`, pawId = `candidate-paw-${unique}`;
  const coat = `url(#${coatId})`, paw = `url(#${pawId})`;
  const forearm = <><path d="M8.6 17.9C6.8 18.4 5.2 20.5 5.4 23.1L5.9 25.4Q6.2 27 8.3 26.8Q10.4 26.6 10.1 24.8L9.3 21.9" fill={paw} stroke={colors.shade} strokeWidth=".45" strokeLinecap="round" /><path d="M7 20.7Q6 22.6 6.9 24.5" stroke={colors.highlight} strokeWidth=".7" strokeLinecap="round" opacity=".72" /><path d="M7.4 25.4L7.6 26.2M9 25.3L9.1 26" stroke={colors.ink} strokeWidth=".45" strokeLinecap="round" opacity=".28" /></>;
  return <span className="candidate-pet" aria-hidden="true">
    <svg className="candidate-back" viewBox="0 0 32 30" fill="none"><defs><radialGradient id={coatId} cx=".3" cy=".2" r=".95"><stop stopColor={colors.highlight} /><stop offset=".44" stopColor={colors.base} /><stop offset="1" stopColor={colors.shade} /></radialGradient><linearGradient id={pawId} x1="0" y1="0" x2=".3" y2="1"><stop stopColor={colors.highlight} /><stop offset=".48" stopColor={colors.base} /><stop offset="1" stopColor={colors.shade} /></linearGradient></defs>
      <g className="candidate-haunch"><path d="M19.4 19.4C21.3 16.3 27.9 16.4 30 19.2Q32.1 22.1 28.9 23.1L18.8 22.6Z" fill={coat} stroke={colors.shade} strokeWidth=".35" /><path d="M24.6 18.3Q27.4 17.9 29.2 19.8" stroke={colors.highlight} strokeWidth=".7" strokeLinecap="round" opacity=".55" /></g><ellipse cx="16" cy="23.35" rx="10" ry=".75" fill="#161616" opacity=".16" />
    </svg>
    <span className="candidate-head-clip"><span className="candidate-head"><PetAvatar petId={petId} /></span></span>
    <svg className="candidate-embrace" viewBox="0 0 32 30" fill="none">
      <g className="candidate-paw-left">{forearm}</g><g className="candidate-paw-right"><g transform="translate(32 0) scale(-1 1)">{forearm}</g></g>
      <g className="candidate-chin"><path d="M10.2 21.4Q16 20.8 21.8 21.4Q21.4 23.7 16 23.7Q10.6 23.7 10.2 21.4Z" fill={petId === 'gugu' ? '#eee7db' : colors.base} /><path d="M12 23.3Q16 24 20 23.3" stroke={colors.shade} strokeWidth=".45" strokeLinecap="round" opacity=".45" /></g>
    </svg>
  </span>;
}
