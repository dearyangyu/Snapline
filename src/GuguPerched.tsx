import { useId } from 'react';
import './guguPerched.css';

/** Decorative clothesline artwork. 32×30 logical pixels; rope contact is (16,23).
 * The scene owns time and writes pose variables in logical pixels. */
export default function GuguPerched({ className = '' }: { className?: string } = {}) {
  const id = useId().replace(/:/g, '');
  const hood = `gugu-hood-${id}`, body = `gugu-body-${id}`, skin = `gugu-skin-${id}`;
  const belly = `gugu-belly-${id}`, gold = `gugu-gold-${id}`, paw = `gugu-paw-${id}`;
  return <span className={`candidate-gugu${className ? ` ${className}` : ''}`} aria-hidden="true">
    <svg width="32" height="30" viewBox="0 0 64 60" fill="none" focusable="false" aria-hidden="true">
      <defs>
        <radialGradient id={hood} cx=".32" cy=".16" r=".87"><stop stopColor="#69717d" /><stop offset=".35" stopColor="#3d4552" /><stop offset=".76" stopColor="#242a35" /><stop offset="1" stopColor="#141923" /></radialGradient>
        <linearGradient id={body} x1="35" y1="29" x2="49" y2="48" gradientUnits="userSpaceOnUse"><stop stopColor="#505967" /><stop offset=".48" stopColor="#303845" /><stop offset="1" stopColor="#171e29" /></linearGradient>
        <radialGradient id={skin} cx=".4" cy=".32" r=".79"><stop stopColor="#fff7e8" /><stop offset=".64" stopColor="#f1e5d3" /><stop offset="1" stopColor="#d8c4af" /></radialGradient>
        <linearGradient id={belly} x1="40" y1="34" x2="39" y2="48" gradientUnits="userSpaceOnUse"><stop stopColor="#fff6e7" /><stop offset="1" stopColor="#cec9bd" /></linearGradient>
        <linearGradient id={gold} x1="0" y1="0" x2=".28" y2="1"><stop stopColor="#ffe6a0" /><stop offset=".48" stopColor="#eac05f" /><stop offset="1" stopColor="#b98636" /></linearGradient>
        <linearGradient id={paw} x1="0" y1="0" x2=".62" y2="1"><stop stopColor="#596473" /><stop offset=".48" stopColor="#303a47" /><stop offset="1" stopColor="#161e29" /></linearGradient>
      </defs>

      {/* The low, long torso is visible behind the hood; it is not a cropped
          standing avatar. The rear flipper and soft belly rest along the line. */}
      <g className="candidate-haunch">
        <path d="M49.8 40.7C54.4 38.5 58.5 39.6 61.5 42.5Q63.2 44.3 60.5 46.3L54.2 47.4L47.4 44.8Z" fill={`url(#${gold})`} stroke="#a77939" strokeWidth=".65" />
        <path d="M58.2 42.6L56.1 44.7M60.5 43.2L58.4 45" stroke="#fff0ba" strokeWidth=".8" strokeLinecap="round" opacity=".64" />
        <path d="M29.8 34.8C35.2 27.7 45.4 27.4 53.4 31.5C58.7 34.2 60.3 40.1 56.5 44.3Q53.1 47.6 42.1 47.4L24.9 44.9Z" fill={`url(#${body})`} stroke="#202833" strokeWidth=".85" />
        <path d="M29.9 38.1C35.7 34.5 42.4 35.2 48.7 39.1Q52.4 41.6 50.4 45.1Q43.2 48 29.2 44.6Z" fill={`url(#${belly})`} />
        <path d="M37.2 31.5Q46.8 28.7 53.5 34.1" stroke="#c1c9cf" strokeWidth=".8" strokeLinecap="round" opacity=".42" />
        <path d="M49.1 35.1Q53.8 36.1 54.8 39.3" stroke="#0c111a" strokeWidth=".8" strokeLinecap="round" opacity=".25" />
        <path d="M39 46.8Q47.5 48.4 55.3 45" stroke="#0e1720" strokeWidth=".8" strokeLinecap="round" opacity=".3" />
      </g>
      <ellipse cx="30.5" cy="46.4" rx="20.5" ry="1.25" fill="#101824" opacity=".16" />

      <g className="candidate-head">
        <path d="M9.1 28.6C6.8 18.9 9.9 8.4 19.3 5.2C26.8 2.6 37.5 3.1 43.3 9.2C48.3 14.4 49.1 23.7 46.7 32.2L43.3 40.9Q39.1 46.2 28.4 45.1Q17.2 46 12.4 39.9Z" fill={`url(#${hood})`} stroke="#171e28" strokeWidth=".9" />
        <path d="M12.4 17.4C13.3 11.5 17.3 8.1 22 7.1" stroke="#b4bec9" strokeWidth="1" strokeLinecap="round" opacity=".47" />
        <path d="M38.4 8Q44.2 11.1 45.1 17.3" stroke="#a1acb7" strokeWidth=".7" strokeLinecap="round" opacity=".25" />

        {/* Penguin hood: two little pale eyes and a broad warm yellow beak. */}
        <ellipse cx="20.9" cy="12.8" rx="2.1" ry="2.6" fill="#f6edda" />
        <ellipse cx="36.8" cy="12.8" rx="2.1" ry="2.6" fill="#f6edda" />
        <ellipse cx="21.2" cy="13.1" rx=".7" ry="1.15" fill="#30313a" />
        <ellipse cx="36.5" cy="13.1" rx=".7" ry="1.15" fill="#30313a" />
        <path d="M23 17C25.9 14.7 31.9 14.7 35 17Q35.8 18.4 33.8 20Q29 23.1 24 20Q22 18.6 23 17Z" fill={`url(#${gold})`} stroke="#bd9045" strokeWidth=".6" />
        <path d="M24.8 17.4Q29 15.9 33.1 17.4" stroke="#fff1bb" strokeWidth="1" strokeLinecap="round" opacity=".8" />
        <path d="M24.6 19.1Q29 20.2 33.2 19.1" stroke="#ad7e34" strokeWidth=".55" strokeLinecap="round" opacity=".38" />

        <path d="M15.6 25.9Q16 21.5 21.5 21H36.4Q42.8 21.5 42.7 28.6L41.4 35.5C40.5 41.5 35.7 44.2 28.9 44.2C22.1 44.2 17.3 41.5 16.3 35.5Z" fill={`url(#${skin})`} />
        <path d="M17.1 25.1L15.4 32.8Q14.9 36.7 18.2 38.6L19.6 29.5ZM40.9 25.2L42.5 32.8Q42.9 36.5 39.9 38.4L38.6 29.3Z" fill="#1a202b" />
        <path d="M15.9 25.7Q15.2 20.4 21.9 20.1H36.1Q42.3 20.4 42.1 26L38.2 24.6L35.4 27.8L32.3 24.4L28.5 27.5L25.7 23.5L22.1 26.8L19.8 24.2L18.1 27.4Z" fill="#202632" />
        <path d="M20 22.2Q24.7 20.6 28.1 21.2" stroke="#626977" strokeWidth=".7" strokeLinecap="round" opacity=".38" />

        <g className="candidate-face">
          <path d="M20.1 29Q22.6 27.5 24.7 28.6M32.7 28.6Q35.2 27.5 37.4 29" stroke="#5b5050" strokeWidth=".8" strokeLinecap="round" opacity=".55" />
          <ellipse cx="20.6" cy="36.7" rx="2.5" ry="1.35" fill="#dc9f96" opacity=".32" />
          <ellipse cx="37" cy="36.7" rx="2.5" ry="1.35" fill="#dc9f96" opacity=".29" />
          <g className="candidate-eyes">
            <ellipse cx="23.1" cy="32.7" rx="2.55" ry="3.05" fill="#fffaf0" />
            <ellipse cx="34.6" cy="32.7" rx="2.55" ry="3.05" fill="#fffaf0" />
            <ellipse cx="23.5" cy="33" rx="1.65" ry="2.28" fill="#4b4142" />
            <ellipse cx="34.2" cy="33" rx="1.65" ry="2.28" fill="#4b4142" />
            <ellipse cx="23.6" cy="33.3" rx=".92" ry="1.45" fill="#22212b" />
            <ellipse cx="34.1" cy="33.3" rx=".92" ry="1.45" fill="#22212b" />
            <circle cx="22.9" cy="31.8" r=".7" fill="#fff" /><circle cx="33.5" cy="31.8" r=".7" fill="#fff" />
            <path d="M20.7 31.2Q23.1 29.8 25.4 31.2M32.3 31.2Q34.6 29.8 36.8 31.2" stroke="#51454a" strokeWidth=".55" strokeLinecap="round" opacity=".7" />
          </g>
          <path d="M28.5 35.2Q29.4 35.9 28.7 36.5" stroke="#b89785" strokeWidth=".65" strokeLinecap="round" opacity=".7" />
          <path d="M26.4 38.8Q28.8 40.6 31.3 38.8" stroke="#a77670" strokeWidth="1" strokeLinecap="round" />
          <path d="M27.6 41Q29 41.5 30.1 41" stroke="#fff8ea" strokeWidth=".65" strokeLinecap="round" opacity=".7" />
        </g>
        <path className="candidate-chin" d="M22.5 42Q28.9 45 35.4 42.1Q34.7 46.2 28.9 46.3Q23.3 46.2 22.5 42Z" fill={`url(#${skin})`} />
        <path d="M20.8 43.3Q16.4 42.4 14 39.8M37.1 43.3Q41.6 42.4 43.6 39.8" stroke="#626c79" strokeWidth=".9" strokeLinecap="round" opacity=".58" />
      </g>

      {/* Each flipper has its own pivot at the rope, so one may reach while
          the other remains planted. Sleeves overlap the line; no floating feet. */}
      <g className="candidate-paw-left">
        <path d="M14.8 36.8C9.1 36.3 7.2 41.4 7.7 46.5L8.4 51.4Q8.9 54.7 12.9 54.2Q17.2 53.7 16.7 50.5L15.9 43.5" fill={`url(#${paw})`} stroke="#18212c" strokeWidth=".8" strokeLinecap="round" />
        <path d="M11.1 40.5Q9.2 43.3 10 47.9" stroke="#929eac" strokeWidth=".9" strokeLinecap="round" opacity=".68" />
        <path d="M10.5 51.4L10.8 52.6M13.3 51.2L13.6 52.3" stroke="#a3aeb9" strokeWidth=".6" strokeLinecap="round" opacity=".5" />
      </g>
      <g className="candidate-paw-right">
        <path d="M40.4 37.1C45.4 37.3 48.2 41.7 47.5 46.8L46.6 51.6Q45.9 54.7 42.1 54.1Q38.2 53.7 38.8 50.2L39.8 43.5" fill={`url(#${paw})`} stroke="#18212c" strokeWidth=".8" strokeLinecap="round" />
        <path d="M43.1 40.9Q45.1 43.6 44.4 48" stroke="#929eac" strokeWidth=".9" strokeLinecap="round" opacity=".68" />
        <path d="M41.8 51.3L41.5 52.5M44.6 51.6L44.3 52.7" stroke="#a3aeb9" strokeWidth=".6" strokeLinecap="round" opacity=".5" />
      </g>
    </svg>
  </span>;
}
