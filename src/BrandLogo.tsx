import logo from '../docs/assets/logo.svg';

/** Decorative alongside the app name; the packaged icon uses this same mark. */
export default function BrandLogo({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true" style={{ background: 'transparent' }}>
    <img src={logo} alt="" draggable={false} width="64" height="64" style={{ display: 'block', width: '100%', height: '100%' }}/>
  </span>;
}
