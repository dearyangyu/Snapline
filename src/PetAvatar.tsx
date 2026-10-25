import { useId, type ReactNode } from 'react';
import { PET_CATALOG, type PetId } from './petCatalog';
import SpritePet from './SpritePet';
import { isSpritePetId, type SpritePetId } from './spritePetCatalog';
import './petAvatar.css';

interface Props { petId: PetId; className?: string }

/** Decorative artwork. All interaction stays on the stationary parent. */
export function PetAvatar({ petId, className = '' }: Props) {
  if (isSpritePetId(petId)) return <SpritePet petId={petId} className={className} />;
  return <SimplePetAvatar petId={petId} className={className} />;
}

function SimplePetAvatar({ petId, className = '' }: { petId: Exclude<PetId, SpritePetId>; className?: string }) {
  const unique = useId().replace(/:/g, '');
  const bodyId = `pet-${petId}-body-${unique}`, footId = `pet-${petId}-feet-${unique}`;
  const pet = PET_CATALOG.find(candidate => candidate.id === petId) || PET_CATALOG[0];
  const { colors } = pet;
  const bodyFill = `url(#${bodyId})`, footFill = `url(#${footId})`;
  let silhouette: ReactNode, details: ReactNode;

  switch (petId) {
    case 'mint':
      silhouette = <>
        <path d="M15.9 8.5Q13.6 5.6 15.4 2.4" stroke="#4a8b58" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M15.5 6.8C16.7 2.4 21.9 2.5 24.2 3.5C22 7.2 18.6 8.2 15.5 6.8Z" fill="#74bb72" />
        <path d="M15.3 6C12.6 2.7 9.7 3.8 8.8 4.4C10.3 7.2 13 8 15.3 6Z" fill="#a5d78c" />
        <path d="M15.9 7.3C21.4 7.2 22.2 12.8 24.6 16.4C30.4 25 26 30 16.2 30C6.9 30 2.7 25.2 7.5 17.5C10.4 12.9 10.2 7.4 15.9 7.3Z" fill={bodyFill} />
      </>;
      details = <><path d="M11.7 11.2Q12.7 9.7 14.1 9.3" stroke={colors.highlight} strokeWidth="1.2" strokeLinecap="round" opacity=".8" /><ellipse cx="16.8" cy="25.5" rx="6" ry="2.1" fill={colors.highlight} opacity=".12" /></>;
      break;
    case 'aqua':
      silhouette = <path d="M17.7 3C16.8 8.2 8.6 11.2 5.8 17.7C2.5 25.3 7.9 30 16.1 30C24.5 30 29.1 25 26.7 17.7C24.7 11.8 20.8 8.4 17.7 3Z" fill={bodyFill} />;
      details = <><path d="M10.1 14.8Q7.2 18 7.1 21" stroke={colors.highlight} strokeWidth="1.5" strokeLinecap="round" opacity=".85" /><path d="M8.5 26Q15.8 30.2 23.3 26" stroke="#d4f8ff" strokeWidth=".7" strokeLinecap="round" opacity=".33" /><ellipse cx="22.3" cy="23.9" rx="1.1" ry="1.4" fill="#e4fbff" opacity=".3" /></>;
      break;
    case 'ember':
      silhouette = <>
        <path d="M7.2 15.1C.7 15.4 1.8 23.5 6.1 25.4L10 20.6Z" fill={colors.shade} />
        <path d="M24.8 15.1C31.3 15.4 30.2 23.5 25.9 25.4L22 20.6Z" fill={colors.shade} />
        <path d="M4.6 19.6C4.2 12.3 8 7.4 12.1 6.3L11.4 3.4Q14.6 3.1 16.1 5.9Q19 3.8 21.6 5.5L20.1 7C25.5 9 28.1 13.2 27.5 20.5C27 27.4 23.1 30 16 30C8.8 30 5 27 4.6 19.6Z" fill={bodyFill} />
      </>;
      details = <><ellipse cx="16" cy="25" rx="6.7" ry="3.4" fill="#fff0da" opacity=".32" /><path d="M7.1 17Q6.1 20.1 7.4 22.1M25 17Q26 20.1 24.7 22.1" stroke="#a8564e" strokeWidth=".8" strokeLinecap="round" opacity=".35" /><path d="M9.3 11Q10.6 9.4 12.4 9" stroke={colors.highlight} strokeWidth="1.1" strokeLinecap="round" opacity=".72" /></>;
      break;
    case 'violet':
      silhouette = <path d="M13.9 4.8Q16 1 18.1 4.8L21.3 10.5L27.6 11.2Q31.2 11.6 28.7 14.4L24.3 19.5L25.5 26.6Q26.1 30.2 22.8 28.6L16 25.4L9.2 28.6Q5.9 30.2 6.5 26.6L7.7 19.5L3.3 14.4Q.8 11.6 4.4 11.2L10.7 10.5Z" fill={bodyFill} />;
      details = <><path d="M14.4 7.2L15.8 4.7" stroke={colors.highlight} strokeWidth="1.2" strokeLinecap="round" opacity=".75" /><path d="M8.1 25.8L9.5 20.3" stroke="#fff1ff" strokeWidth=".65" strokeLinecap="round" opacity=".3" /><ellipse cx="16" cy="20.8" rx="5.9" ry="2.8" fill="#e9d8ff" opacity=".17" /></>;
      break;
    case 'peach':
      silhouette = <path d="M10 6.5Q16 3.6 22 6.5L27.7 24.6Q30 30 24.1 30H7.9Q2 30 4.3 24.6Z" fill={bodyFill} />;
      details = <>
        <path d="M10 6.5Q16 3.6 22 6.5L23.3 10.6Q21.7 12.6 19.8 11.1Q18.4 13.6 16 11.8Q13.8 13.4 12.1 11.1Q10.2 12.3 8.8 10.4Z" fill="#b5753c" />
        <path d="M11.6 7.2Q15.9 5.6 20.5 7.2" stroke="#f2cd91" strokeWidth=".9" strokeLinecap="round" opacity=".72" />
        <path d="M8.8 15.3L6.4 24.2" stroke={colors.highlight} strokeWidth="1.3" strokeLinecap="round" opacity=".65" /><path d="M7.4 27.5Q16.2 29.2 24.7 27.5" stroke="#966735" strokeWidth=".65" opacity=".25" />
      </>;
      break;
    case 'ice':
      silhouette = <>
        <path d="M16 7.3V4.7" stroke="#7da9c1" strokeWidth="1.6" /><circle cx="16" cy="3.5" r="1.8" fill="#a3dfe9" />
        <rect x="1.8" y="16" width="4.5" height="8.3" rx="2.1" fill={colors.shade} /><rect x="25.7" y="16" width="4.5" height="8.3" rx="2.1" fill={colors.shade} />
        <rect x="4.3" y="7.1" width="23.4" height="22.9" rx="6.3" fill={bodyFill} />
      </>;
      details = <><path d="M8.2 10.7Q9 9.5 11 9.5H17" stroke={colors.highlight} strokeWidth="1.1" strokeLinecap="round" opacity=".8" /><rect x="7.3" y="12.4" width="17.4" height="11.1" rx="4.1" fill="#e6f5fa" opacity=".62" /><path d="M12 26.7H20" stroke="#668ba3" strokeWidth="1" strokeLinecap="round" opacity=".4" /></>;
      break;
    case 'rose':
      silhouette = <>
        <path d="M9.1 15.1C5.9 8.7 5.6 2.3 8.4 2.2C11.4 1.9 12.9 8.4 13.6 13.4Z" fill={bodyFill} />
        <path d="M18.1 13.6C18.1 7.8 20.5 1.9 23.1 3.1C26 4.4 23.5 11.1 22.5 15.4Z" fill={bodyFill} />
        <path d="M9.4 11.3C7.7 7.3 7.4 4.3 8.6 4.1C9.7 3.9 10.8 7.5 11.1 11.2ZM19.8 11.4C20 7.8 21.4 4.5 22.5 4.9C23.5 5.4 22.2 9.2 21.3 12Z" fill="#cf879f" opacity=".64" />
        <path d="M4.8 21C4.8 14.4 9.3 10.3 15.8 10.3C22.4 10.3 27.1 14.6 27.2 21.1C27.4 27.4 23.6 30 16 30C8.7 30 4.7 27.3 4.8 21Z" fill={bodyFill} />
      </>;
      details = <><path d="M8.2 16.3Q9.6 13.9 12.2 13.2" stroke={colors.highlight} strokeWidth="1.1" strokeLinecap="round" opacity=".75" /><ellipse cx="16" cy="24.7" rx="5.8" ry="3" fill="#ffedf0" opacity=".34" /></>;
      break;
    default:
      silhouette = <path d="M4.1 20.4C3.5 13 5.6 6.3 11.7 4.6C12.3 2.4 14.6 1.7 16.9 3.2C23.9 2.8 27.3 8.9 27.9 17.1C28.6 25.2 24.9 29.9 16.3 30C8.6 30.1 4.5 27.2 4.1 20.4Z" fill={bodyFill} />;
      details = <><path d="M9 8C10.6 6.3 13.5 5.2 16 5.5" stroke={colors.highlight} strokeWidth="1.1" strokeLinecap="round" opacity=".8" /><path d="M6 22.3C7.4 26.1 11.3 27.8 17.1 27.9C20 28 22.3 27.3 24.2 25.8" stroke="#948874" strokeWidth=".6" strokeLinecap="round" opacity=".17" /></>;
  }

  const eyeY = petId === 'rose' ? 17 : petId === 'aqua' ? 16.3 : petId === 'peach' ? 16 : 14.4;
  const eyeHeight = petId === 'ice' ? 3.1 : 3.9;
  const foot = (left: boolean) => petId === 'ice'
    ? <rect x={left ? 7.2 : 19.1} y="28.2" width="5.8" height="3.6" rx="1.4" fill={footFill} />
    : <ellipse cx={left ? 9.6 : 22} cy="30.1" rx={petId === 'rose' ? 3.7 : 3.2} ry="1.7" fill={petId === 'ember' ? '#d4a65d' : footFill} />;

  return <svg className={`pet-avatar pet-avatar-${petId}${className ? ` ${className}` : ''}`} viewBox="0 0 32 34" width="26" height="28" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id={bodyId} cx=".31" cy=".19" r=".89"><stop stopColor={colors.highlight} /><stop offset=".48" stopColor={colors.base} /><stop offset="1" stopColor={colors.shade} /></radialGradient>
      <linearGradient id={footId} x1="0" y1="0" x2="0" y2="1"><stop stopColor={colors.base} /><stop offset="1" stopColor={colors.shade} /></linearGradient>
    </defs>
    <ellipse cx="16" cy="31" rx="10.6" ry="1.5" fill={colors.highlight} opacity=".06" />
    <g className="anchor-creature-lift">
      <g className="anchor-creature-foot anchor-creature-foot-left">{foot(true)}</g>
      <g className="anchor-creature-foot anchor-creature-foot-right">{foot(false)}</g>
      <g className="anchor-creature-body">
        {silhouette}{details}
        <g className="anchor-creature-face">
          {petId !== 'ice' && <><ellipse cx={petId === 'violet' ? 10.8 : 8.5} cy={eyeY + 5.8} rx={petId === 'violet' ? 1.1 : 2} ry=".85" fill={colors.cheek} opacity=".28" /><ellipse cx={petId === 'violet' ? 21.2 : 23.5} cy={eyeY + 5.8} rx={petId === 'violet' ? 1.1 : 2} ry=".85" fill={colors.cheek} opacity=".23" /></>}
          <g className="anchor-creature-eyes">
            <rect x="10.1" y={eyeY} width="2.7" height={eyeHeight} rx={petId === 'ice' ? '.8' : '1.35'} fill={colors.ink} /><rect x="19.4" y={eyeY} width="2.7" height={eyeHeight} rx={petId === 'ice' ? '.8' : '1.35'} fill={colors.ink} />
            <circle cx="10.9" cy={eyeY + .9} r=".4" fill={colors.highlight} opacity=".85" /><circle cx="20.2" cy={eyeY + .9} r=".4" fill={colors.highlight} opacity=".85" />
          </g>
          {petId === 'ember' ? <path d="M13.3 20.2Q16 18.8 18.7 20.2L16 22.5Z" fill="#f5cc78" />
            : petId === 'ice' ? <path d="M14.2 20.3H18" stroke={colors.ink} strokeWidth="1" strokeLinecap="round" opacity=".7" />
            : petId === 'rose' ? <><path d="M14.7 23.2Q16 22.3 17.3 23.2L16 24.3Z" fill="#b56c8a" /><path d="M16 24.3Q15.5 25.2 14.6 25M16 24.3Q16.5 25.2 17.4 25" stroke={colors.ink} strokeWidth=".7" strokeLinecap="round" opacity=".65" /></>
            : <path d={`M14.5 ${eyeY + 6.6}Q16.1 ${eyeY + 7.8} 17.7 ${eyeY + 6.6}`} stroke={colors.ink} strokeWidth=".85" strokeLinecap="round" opacity=".55" />}
        </g>
      </g>
    </g>
  </svg>;
}

export default PetAvatar;
