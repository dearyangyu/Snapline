import { useId } from 'react';
import './guguAvatar.css';

interface Props { pose?: 'standing' | 'perched'; className?: string }

/** Penguin costume, blunt bob and open-mouthed expression from the supplied
 * character reference. The perched pose is articulated, not a cropped icon. */
export default function GuguAvatar({ pose = 'standing', className = '' }: Props) {
  const uid = `gugu-ref-${useId().replace(/:/g, '')}`;
  const paint = (name: string) => `url(#${uid}-${name})`;
  const perched = pose === 'perched';
  const head = <g className="gugu-ref-head">
    <path d="M19 58C12 31 22 10 49 6C78 1 105 11 110 34Q115 55 104 78L95 93H32L21 79Z" fill={paint('hood')} stroke="#242931" strokeWidth="1.8" />
    <path d="M25 31Q31 15 49 12M82 13Q100 18 105 33" stroke="#c7cbd0" strokeWidth="2" strokeLinecap="round" opacity=".48" />
    <ellipse cx="41" cy="23" rx="7" ry="8" transform="rotate(-25 41 23)" fill="#eeeef0" stroke="#22262d" strokeWidth="1.4" />
    <ellipse cx="87" cy="23" rx="7" ry="8" transform="rotate(25 87 23)" fill="#eeeef0" stroke="#22262d" strokeWidth="1.4" />
    <ellipse cx="42" cy="24" rx="2.8" ry="4.2" fill="#25262b" /><ellipse cx="86" cy="24" rx="2.8" ry="4.2" fill="#25262b" />
    <circle cx="41" cy="22" r="1" fill="white" /><circle cx="85" cy="22" r="1" fill="white" />
    <path d="M48 30Q64 17 80 30L84 36Q64 43 44 36Z" fill={paint('gold')} stroke="#b98624" strokeWidth="1.3" />
    <path d="M49 33Q64 35 79 33M64 26V33" fill="none" stroke="#b98d2c" strokeWidth="1" /><path d="M52 29L60 26" stroke="#fff2a8" strokeWidth="1.6" strokeLinecap="round" />
    {/* The outward flicks and dense straight fringe distinguish the bob. */}
    <path d="M24 48C26 31 45 32 62 34C85 31 102 35 105 55L106 77L117 81Q111 87 102 85L108 94Q95 98 86 93H39Q28 99 17 93L24 83Q15 87 9 81Q22 76 22 65Z" fill={paint('hair')} stroke="#15191f" strokeWidth="1.8" />
    <path d="M29 52Q31 40 44 39H85Q97 41 100 54L98 77C96 91 83 99 64 100C45 99 32 90 30 77Z" fill={paint('skin')} stroke="#b57c65" strokeWidth=".9" />
    <path d="M29 50Q32 35 47 36H83Q98 37 101 52L97 60L92 51L92 67L86 64L86 51L81 55L76 53L76 40L74 54L68 54L67 41L65 55H58L57 41L55 55L48 55L48 42L45 56L38 56L38 48L34 66L28 72Z" fill={paint('hair')} stroke="#181b21" strokeWidth="1" />
    <path d="M38 43L36 54M47 40V49M57 39V50M69 39L70 49M80 40L81 48M93 44L95 53" stroke="#87909a" strokeWidth="1.4" strokeLinecap="round" opacity=".45" />
    <path d="M26 59Q23 76 32 89L35 72M101 58Q107 76 96 90L93 74" fill="#252c35" stroke="#10151c" strokeWidth="1.4" />
    <path d="M26 59L24 77M102 61L102 77" stroke="#8b949e" strokeWidth="1.2" opacity=".42" />
    <g className="gugu-ref-face anchor-creature-face">
      <path d="M37 60Q44 57 51 60M77 60Q84 57 91 60" stroke="#5e4642" strokeWidth="1.3" strokeLinecap="round" />
      <g className="gugu-ref-eyes anchor-creature-eyes">
        {[45,83].map((x, i) => <g key={x}>
          <path d={`M${x-10} 65Q${x} 60 ${x+10} 66L${x+8} 76Q${x} 83 ${x-8} 76Z`} fill="#fffdf9" />
          <ellipse cx={x} cy="71" rx="7" ry="9" fill={paint('iris')} />
          <ellipse cx={x} cy="69.5" rx="3" ry="5" fill="#26303d" />
          <path d={`M${x-5} 75Q${x} 79 ${x+5} 75`} stroke="#e7ba86" strokeWidth="1.6" fill="none" />
          <circle cx={x-2.5} cy="65" r="2.4" fill="white" /><circle cx={x+3} cy="73.4" r="1.1" fill="#fff4cd" />
          <path d={`M${x-11} 64Q${x} 60 ${x+10} 65`} stroke="#342724" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d={i ? 'M91 64L95 61' : 'M36 64L32 61'} stroke="#342724" strokeWidth="1.8" strokeLinecap="round" />
        </g>)}
      </g>
      <ellipse cx="35" cy="81" rx="6" ry="3.4" fill="#f1a39d" opacity=".6" /><ellipse cx="93" cy="81" rx="6" ry="3.4" fill="#f1a39d" opacity=".6" />
      <path d="M31 81L33 83M36 81L38 83M89 81L91 83M94 81L96 83" stroke="#d4837e" strokeWidth=".8" opacity=".7" />
      <path d="M62 79Q64 80 66 79" stroke="#d79f89" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M55 86Q64 82 73 86Q74 95 64 96Q54 95 55 86Z" fill="#8f3847" stroke="#a95055" strokeWidth="1" />
      <path d="M57 86Q64 84 71 86L70 88H58Z" fill="#fff8ec" /><path d="M58 93Q64 89 70 93Q65 96 58 93Z" fill="#ed8796" />
    </g>
    <g transform="translate(25 53) rotate(-31)"><rect x="-2" y="-7" width="4" height="15" rx="1" fill="#b0bfc2" stroke="#53646a" strokeWidth=".8" /><rect x="-7" y="-2" width="15" height="4" rx="1" fill="#9bafb5" stroke="#53646a" strokeWidth=".8" /></g>
  </g>;
  return <svg className={`gugu-avatar gugu-avatar-${pose} pet-avatar pet-avatar-gugu ${className}`} viewBox={perched ? '0 0 128 120' : '0 0 128 160'} width={perched ? 32 : 26} height={perched ? 30 : 28} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${uid}-hood`} x1=".1" y1="0" x2=".85" y2="1"><stop stopColor="#6e7580" /><stop offset=".3" stopColor="#363d48" /><stop offset="1" stopColor="#151b24" /></linearGradient>
      <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2=".3" y2="1"><stop stopColor="#343c49" /><stop offset=".45" stopColor="#121b27" /><stop offset="1" stopColor="#222835" /></linearGradient>
      <radialGradient id={`${uid}-skin`} cx=".48" cy=".3" r=".8"><stop stopColor="#fff7e9" /><stop offset=".74" stopColor="#ffe8d6" /><stop offset="1" stopColor="#ecc3ac" /></radialGradient>
      <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffe692" /><stop offset=".48" stopColor="#f4cd53" /><stop offset="1" stopColor="#d5a42d" /></linearGradient>
      <linearGradient id={`${uid}-iris`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#374052" /><stop offset=".48" stopColor="#7d9eaf" /><stop offset=".8" stopColor="#a98f7c" /><stop offset="1" stopColor="#e3b484" /></linearGradient>
      <linearGradient id={`${uid}-belly`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#fcfcf6" /><stop offset=".65" stopColor="#e9eae4" /><stop offset="1" stopColor="#bfc5c5" /></linearGradient>
    </defs>
    <g className={perched ? 'gugu-ref-perch' : 'anchor-creature-lift'}>
      {perched ? <g className="gugu-ref-haunch">
        <path d="M84 79Q106 74 116 88L123 86L120 96Q108 107 82 101Z" fill={paint('hood')} stroke="#1f2530" strokeWidth="1.4" />
        <path d="M89 89Q103 84 111 94Q103 101 89 99Z" fill={paint('belly')} />
      </g> : <>
        <path d="M91 128Q111 141 125 130Q120 147 90 148Z" fill={paint('hood')} stroke="#1b222d" strokeWidth="1.4" />
        <g className="anchor-creature-foot anchor-creature-foot-left"><path d="M39 145L31 153L32 158L41 157L45 159L50 157L52 150Z" fill={paint('gold')} stroke="#bc892a" strokeWidth="1" /></g>
        <g className="anchor-creature-foot anchor-creature-foot-right"><path d="M80 145L78 153L79 157L85 157L89 159L95 157L99 156L91 148Z" fill={paint('gold')} stroke="#bc892a" strokeWidth="1" /></g>
      </>}
      <g className={perched ? '' : 'anchor-creature-body'}>
        {!perched && <>
          <path d="M30 88Q17 87 10 71Q2 84 11 100Q19 112 34 112M97 88Q111 87 118 71Q126 84 117 100Q108 112 94 112" fill={paint('hood')} stroke="#1d2530" strokeWidth="1.6" />
          <path d="M33 89Q64 81 95 89L105 123Q108 150 65 152Q22 151 23 126Z" fill={paint('hood')} stroke="#1d2530" strokeWidth="1.6" />
          <path d="M43 99Q64 93 85 99L94 124Q96 145 65 146Q34 145 35 126Z" fill={paint('belly')} />
          <path d="M27 118Q25 134 34 140" stroke="#959da5" strokeWidth="1.6" strokeLinecap="round" opacity=".3" />
        </>}
        <g transform={perched ? 'translate(0 -7)' : undefined}>{head}</g>
        {!perched && <g>
          <path d="M33 97Q64 104 95 97L93 103Q64 111 35 103Z" fill="#555a63" stroke="#242b34" strokeWidth="1" />
          <path d="M38 101H49" stroke="#d67b76" strokeWidth="3" /><path d="M79 101H90" stroke="#e1e5e5" strokeWidth="3" />
          <path d="M61 101C51 95 48 102 54 111L65 125C70 132 79 127 74 120L61 103C57 99 54 104 58 110L69 123" stroke="#a7afb4" strokeWidth="4" strokeLinecap="round" fill="none" /><path d="M61 101L73 120" stroke="#e1e4de" strokeWidth="1" />
        </g>}
      </g>
      {perched && <>
        <g className="gugu-ref-paw gugu-ref-paw-left"><path d="M26 83Q15 81 16 94L18 105Q20 113 28 109L32 101L31 88Z" fill={paint('hood')} stroke="#1b2430" strokeWidth="1.6" /><path d="M21 88Q18 96 22 103" stroke="#929aa5" strokeWidth="1.5" strokeLinecap="round" opacity=".65" /></g>
        <g className="gugu-ref-paw gugu-ref-paw-right"><path d="M99 83Q109 82 110 95L108 106Q106 113 98 109L94 101L94 88Z" fill={paint('hood')} stroke="#1b2430" strokeWidth="1.6" /><path d="M104 89Q107 96 103 104" stroke="#929aa5" strokeWidth="1.5" strokeLinecap="round" opacity=".65" /></g>
      </>}
    </g>
  </svg>;
}
