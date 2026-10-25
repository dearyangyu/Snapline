import { useId, type ReactNode } from 'react';
import './companionAvatar.css';

export type CompanionId = 'deepseek' | 'claude' | 'chatgpt';
export interface CompanionAvatarProps { id: CompanionId; pose?: 'standing' | 'perched'; className?: string }

/** Character artwork based on the supplied visual references. The perched
 * view uses 4 SVG units per logical pixel and touches the rope at (64,92). */
export default function CompanionAvatar({ id, pose = 'standing', className = '' }: CompanionAvatarProps) {
  const unique = useId().replace(/:/g, '');
  const prefix = `companion-${id}-${unique}`;
  const perched = pose === 'perched';
  const palette = id === 'deepseek'
    ? { light: '#94c8ed', mid: '#476ba9', deep: '#293e72', ink: '#253455', iris: '#65b9f1', irisDeep: '#335398', accent: '#75c8e8', dress: '#263653' }
    : id === 'claude'
      ? { light: '#ffc58a', mid: '#e99553', deep: '#b96035', ink: '#663c2e', iris: '#e9b664', irisDeep: '#936037', accent: '#e7a344', dress: '#313039' }
      : { light: '#fffefd', mid: '#d8d8e4', deep: '#9fa3bc', ink: '#51435e', iris: '#b7a1ed', irisDeep: '#66528d', accent: '#a791c9', dress: '#e6e1ed' };
  const fill = (name: string) => `url(#${prefix}-${name})`;
  const flower = (x: number, y: number, scale = 1) => <g transform={`translate(${x} ${y}) scale(${scale})`}>
    {Array.from({ length: 12 }, (_, index) => <ellipse key={index} cy="-7.8" rx="2.5" ry="6.2" transform={`rotate(${index * 30})`} fill={index % 2 ? '#e8a34f' : '#ffc66f'} stroke="#b56c37" strokeWidth=".6" />)}
    <circle r="4.7" fill="#9d6239" /><circle cy="-.7" r="3.5" fill="#e6b96f" /><circle cx="-1.1" cy="-1.4" r="1.2" fill="#ffe3a0" />
  </g>;
  const whale = <g fill="#4e8cc3"><path d="M-8 1Q-7-5 0-4Q7-4 8 2Q3 7-4 5Q-8 4-8 1Z" /><path d="M7 1Q11-5 15-3Q15 1 10 3Q16 4 15 7Q10 7 7 3Z" /><circle cx="-3" cy="0" r=".8" fill="#f7fbff" /></g>;
  const lace = (y: number, start: number, end: number, r = 3.4) => <g fill="#fffaf2" stroke="#d4cfd0" strokeWidth=".6">{Array.from({ length: Math.round((end - start) / (r * 1.5)) + 1 }, (_, index) => <circle key={index} cx={start + index * r * 1.5} cy={y} r={r} />)}</g>;

  let backHair: ReactNode, fringe: ReactNode, ornament: ReactNode;
  if (id === 'deepseek') {
    backHair = <>
      <path d={perched ? 'M25 40C18 19 47 11 65 17C91 11 114 29 109 55C108 72 122 74 115 91Q125 104 107 105Q113 93 99 92Q92 105 79 100L35 101Q15 108 14 96Q3 92 14 78Q10 66 24 56Z' : 'M25 40C18 19 47 11 65 17C91 11 114 29 109 55C111 71 101 80 113 94C128 108 108 117 116 128Q107 139 91 129Q79 142 67 132Q50 142 40 131Q23 140 15 128Q4 121 17 110Q5 101 16 90Q7 76 23 62Z'} fill={fill('hair')} stroke={palette.deep} strokeWidth="1.25" />
      <path d={perched ? 'M28 48Q18 67 24 78T19 94Q29 98 35 87M103 46Q111 65 104 80T110 98M40 76Q28 92 43 98M91 73Q104 88 91 98' : 'M28 48Q18 69 26 88T20 119Q30 133 40 119M103 46Q113 70 103 92T107 125M40 77Q26 95 39 109T37 130M90 77Q103 92 90 108T91 132'} stroke="#94d7ee" strokeWidth="3.6" strokeLinecap="round" opacity=".62" fill="none" />
      <path d="M23 58Q14 60 5 70Q20 75 29 68M104 58Q113 61 123 71Q107 77 99 68" fill="#476494" stroke="#293d67" strokeWidth="1.2" />
      <path d="M6 70Q18 76 28 68M101 69Q112 77 122 71" stroke="#f6f5ee" strokeWidth="3.3" strokeLinecap="round" />
    </>;
    fringe = <>
      <path d="M26 48C22 27 44 18 63 21C88 18 107 33 103 54Q103 72 94 78Q95 58 85 47Q81 65 68 69Q72 51 64 38Q60 63 48 69Q42 59 39 48Q37 70 25 76Q18 62 26 48Z" fill={fill('hairTop')} stroke={palette.deep} strokeWidth="1.25" />
      <path d="M36 37Q43 28 51 27M60 28Q70 25 77 29M86 33Q96 39 98 48" stroke="#a7ccec" strokeWidth="2.6" strokeLinecap="round" opacity=".5" />
      <path d="M43 34Q37 48 40 57M66 29Q74 44 69 59M91 39Q98 54 94 64" stroke="#233d72" strokeWidth=".8" opacity=".45" fill="none" />
    </>;
    ornament = <>
      <path d="M53 20C45 5 65 2 74 10Q81 18 69 21Q77 12 66 10Q53 9 53 20Z" fill="#718fc3" stroke="#334e81" strokeWidth="1" />
      <path d="M25 35Q31 15 62 15Q94 15 103 35" stroke="#d8d9db" strokeWidth="8" fill="none" />
      {Array.from({ length: 13 }, (_, index) => { const angle = Math.PI + index * Math.PI / 12; return <ellipse key={index} cx={64 + Math.cos(angle) * 38} cy={35 + Math.sin(angle) * 19} rx="4.7" ry="6.1" transform={`rotate(${index * 12 - 72} ${64 + Math.cos(angle) * 38} ${35 + Math.sin(angle) * 19})`} fill="#fffaf0" stroke="#ded8cf" strokeWidth=".8" />; })}
      <path d="M102 45L111 40L111 51L103 48L97 53L96 42Z" fill="#81c9e3" stroke="#3a7f9f" strokeWidth=".8" /><circle cx="103" cy="46" r="2.2" fill="#c9f2f7" />
    </>;
  } else if (id === 'claude') {
    backHair = <>
      <path d={perched ? 'M22 43C15 17 48 12 64 17C91 10 113 30 109 59Q110 72 118 84Q126 103 111 105Q116 91 99 93Q85 107 68 99L37 102Q16 108 13 98Q7 88 19 75Z' : 'M22 43C15 17 48 12 64 17C91 10 113 30 109 59Q107 84 118 103Q126 123 111 139Q114 116 99 113Q99 139 83 143Q77 127 67 133Q51 146 40 135Q23 147 15 135Q8 124 19 109Q3 91 20 74Z'} fill={fill('hair')} stroke="#b46a3c" strokeWidth="1.25" />
      <path d={perched ? 'M29 42Q18 66 28 77T21 97M103 46Q112 67 102 80T108 98M39 74Q28 87 43 99M92 75Q106 88 92 99' : 'M29 42Q17 67 29 88T20 129M103 46Q113 70 101 94T107 132M39 74Q27 96 42 112T37 137M91 74Q105 100 91 117T87 140'} fill="none" stroke="#ffd095" strokeWidth="3" strokeLinecap="round" opacity=".54" />
    </>;
    fringe = <>
      <path d="M22 48C21 25 47 17 64 20C88 16 107 32 105 57Q102 72 95 79Q96 58 86 46Q78 62 69 67Q69 52 61 40Q59 62 46 69L40 48Q35 61 30 76Q19 65 22 48Z" fill={fill('hairTop')} stroke="#b77546" strokeWidth="1.15" />
      <path d="M31 40Q42 26 54 27M62 26Q75 24 83 30M92 38Q101 47 100 56" stroke="#ffdbac" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      <path d="M43 34Q39 45 42 57M62 30Q71 41 69 55M88 38Q91 51 87 57" fill="none" stroke="#b57040" strokeWidth=".75" opacity=".4" />
    </>;
    ornament = <><path d="M103 45L115 50L110 69L103 62L97 74L94 52Z" fill="#35313a" stroke="#191b24" strokeWidth="1" /><path d="M109 60L113 78L107 76L103 62" fill="#faf0dd" stroke="#d6c4aa" strokeWidth=".7" />{flower(103,39,.87)}<path d="M110 69V84" stroke="#ce9d52" strokeWidth="1.2" /><circle cx="110" cy="86" r="2" fill="#eac27c" /></>;
  } else {
    backHair = <>
      <path d={perched ? 'M24 42C18 21 42 13 63 18C86 11 111 26 109 52Q107 71 117 79Q130 91 117 99Q121 107 106 105Q97 109 83 100L39 102Q20 111 16 98Q6 99 12 88Q3 78 20 65Z' : 'M24 42C18 21 42 13 63 18C86 11 111 26 109 52Q107 73 118 86Q128 100 115 108Q126 122 112 133Q103 145 89 135Q72 149 60 137Q43 148 32 136Q14 141 12 127Q1 120 15 107Q3 97 16 85Q6 73 23 61Z'} fill={fill('hair')} stroke="#999caf" strokeWidth="1.15" />
      <path d={perched ? 'M26 45Q18 67 28 79T20 98M102 44Q113 65 102 80T112 99M41 78Q29 91 42 101M91 78Q105 92 90 100' : 'M26 45Q18 69 29 88T20 126M102 44Q115 68 102 91T110 129M41 76Q28 97 43 111T37 139M91 76Q105 100 89 117T89 139'} fill="none" stroke="#fffdfb" strokeWidth="4.2" strokeLinecap="round" opacity=".76" />
      <path d="M25 62L10 58L19 75L30 73M103 62L118 58L110 75L99 73" fill="#f3cabb" stroke="#a68d9c" strokeWidth="1" /><path d="M15 62L22 69M113 62L106 69" stroke="#dcaeab" strokeWidth="1.1" />
    </>;
    fringe = <>
      <path d="M22 46C19 27 42 18 63 20C87 16 107 31 105 54Q106 70 96 79Q97 60 86 46Q79 63 68 68Q69 52 61 40Q58 62 45 69Q40 59 39 47Q34 65 24 76Q16 62 22 46Z" fill={fill('hairTop')} stroke="#999dac" strokeWidth="1.05" />
      <path d="M31 39Q43 26 55 27M62 26Q76 25 84 32M93 39Q100 48 99 55" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" opacity=".82" /><path d="M42 35Q36 49 41 58M62 30Q73 46 68 59M89 39Q93 52 87 60" fill="none" stroke="#a9aabc" strokeWidth=".75" opacity=".5" />
    </>;
    ornament = <>
      <path d="M31 31C13 28 12 13 28 4Q21 16 35 24Z" fill={fill('horn')} stroke="#8f92a7" strokeWidth="1.1" /><path d="M97 30C114 27 114 12 101 4Q107 17 93 24Z" fill={fill('horn')} stroke="#8f92a7" strokeWidth="1.1" />
      <path d="M20 13L25 17M18 19L28 23M22 25L31 28M109 13L104 17M110 19L100 23M106 25L97 28" stroke="#a4a5b6" strokeWidth="1" fill="none" />
      <path d="M57 21C44 8 58 1 72 5Q60 5 60 18" fill="#f9f8fb" stroke="#a7a7b7" strokeWidth="1" />
      <g transform="translate(102 42)">{Array.from({ length: 6 }, (_, index) => <ellipse key={index} cx="0" cy="-4.4" rx="4" ry="6.3" transform={`rotate(${index * 60})`} fill="none" stroke="#fcfafb" strokeWidth="2.5" />)}<circle r="3.4" fill="#7f708f" /></g>
      <path d="M102 54V67" stroke="#8b80a2" strokeWidth="1" /><path d="M102 63L105 68L102 73L99 68Z" fill="#b1a0d1" stroke="#6d6088" strokeWidth=".8" />
    </>;
  }

  const eyes = <g className={perched ? 'candidate-eyes' : 'anchor-creature-eyes'}>
    {[48,80].map((x, index) => <g key={x}>
      <path d={`M${x-11} 65Q${x} 56 ${x+10} 65Q${x+10} 79 ${x} 81Q${x-10} 79 ${x-11} 65Z`} fill="#fffaf5" />
      <ellipse cx={x + (index ? -.5 : .5)} cy="69.4" rx="7.5" ry="10.3" fill={fill('eye')} />
      <ellipse cx={x} cy="67.7" rx="3.6" ry="7.1" fill={palette.irisDeep} /><ellipse cx={x} cy="74.5" rx="5" ry="3.5" fill={palette.iris} opacity=".65" />
      <ellipse cx={x-2.7} cy="64.4" rx="2.7" ry="3.2" fill="#fff" /><circle cx={x+3.3} cy="73.5" r="1.35" fill="#fff9eb" /><circle cx={x-4.3} cy="71.5" r=".7" fill="#e5f4ff" />
      <path d={`M${x-11} 65Q${x} 57 ${x+10} 65`} stroke={palette.ink} strokeWidth="2.7" strokeLinecap="round" fill="none" />
      <path d={index ? `M${x+8} 62L${x+13} 60` : `M${x-8} 62L${x-13} 60`} stroke={palette.ink} strokeWidth="1.7" strokeLinecap="round" />
    </g>)}
  </g>;
  const headBack = <g className={perched ? 'candidate-head' : 'companion-head'}><g transform={perched ? 'translate(-3 5)' : undefined}>{backHair}</g></g>;
  const head = <g className={perched ? 'candidate-head' : 'companion-head'}><g transform={perched ? 'translate(-3 5)' : undefined}>
    {id !== 'claude' && ornament}
    <path d="M30 52Q32 36 64 36Q96 36 98 53L96 70Q94 89 64 91Q34 89 32 71Z" fill={fill('skin')} stroke="#c8a6a0" strokeWidth=".8" />
    <g className={perched ? 'candidate-face' : 'anchor-creature-face'}>
      <path d="M38 56Q47 51 55 54M73 54Q81 51 89 56" stroke={palette.ink} strokeWidth="1.1" strokeLinecap="round" opacity=".55" fill="none" />
      {eyes}<ellipse cx="38" cy="77.5" rx="5.4" ry="2.4" fill="#e6a49d" opacity=".3" /><ellipse cx="90" cy="77.5" rx="5.4" ry="2.4" fill="#e6a49d" opacity=".3" />
      <path d="M63 75Q64.6 76.1 65.3 75.1" stroke="#c5a39a" strokeWidth=".8" strokeLinecap="round" />
      <path d="M60.2 82.5Q64 85.1 67.8 82.5" stroke="#a87475" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </g>
    {fringe}{id === 'claude' && ornament}
  </g></g>;

  const dragonWings = <g fill={fill('wing')} stroke="#8d80ad" strokeWidth="1.1"><path d="M39 101Q25 84 13 88L3 117Q14 105 25 115Q31 103 42 115Z" /><path d="M89 101Q103 84 115 88L125 117Q114 105 103 115Q97 103 86 115Z" /><path d="M14 90L17 109M15 90L28 108M114 90L111 109M113 90L100 108" fill="none" stroke="#c6bbdf" strokeWidth="1.5" /></g>;
  const torso = perched ? <g className="candidate-haunch">
    {id === 'deepseek' && <path d="M105 82Q115 73 123 78L116 86Q125 87 123 94L111 91Z" fill="#537db1" stroke="#31496d" strokeWidth="1" />}
    {id === 'chatgpt' && <path d="M108 89Q125 97 121 77Q131 101 111 102" fill="#e4deee" stroke="#a49ab8" strokeWidth="1" />}
    <path d="M61 83Q77 69 101 77Q119 81 117 94Q113 103 88 101L57 94Z" fill={id === 'chatgpt' ? '#e9e2f1' : palette.dress} stroke={id === 'chatgpt' ? '#a79db7' : '#273345'} strokeWidth="1" />
    <path d="M69 86Q84 78 101 84L111 97Q94 104 72 97Z" fill="#fdf5e9" stroke="#d2c6c3" strokeWidth=".7" />
    {id === 'claude' ? <><path d="M87 80L100 80L112 96L102 98Z" fill="#d78b40" /><path d="M81 83L91 88L84 97L76 90Z" fill="#292b35" />{flower(89,88,.4)}</> : id === 'deepseek' ? <g transform="translate(94 93) scale(.5)">{whale}</g> : <><path d="M82 82L89 88L96 83L91 95Z" fill="#aa95cd" /><path d="M109 79L122 93L111 92L103 98L102 85Z" fill={fill('wing')} stroke="#9683b5" strokeWidth=".8" /></>}
    <path d="M75 98Q96 105 112 98" stroke="#fffefa" strokeWidth="2" strokeLinecap="round" />
  </g> : <>
    {id === 'chatgpt' && dragonWings}
    <path d="M47 88Q64 81 81 88L89 107L105 136Q65 153 23 136L39 108Z" fill={id === 'chatgpt' ? fill('cloth') : palette.dress} stroke={id === 'chatgpt' ? '#b3a8c3' : '#263044'} strokeWidth="1.2" />
    <path d="M46 89L54 84L64 92L74 84L82 89L76 106H51Z" fill="#fcf7ef" stroke="#d5cbd0" strokeWidth=".7" />
    <path d="M60 90L51 96L59 103L64 96L70 103L77 96L67 90Z" fill={id === 'chatgpt' ? '#a08abb' : '#303342'} /><circle cx="64" cy="94" r="2.2" fill={palette.accent} />
    {id === 'deepseek' && <>
      <path d="M49 96L44 105L39 132Q64 145 90 132L84 105L78 96L77 116H51Z" fill="#fcf8f1" stroke="#cccbd0" strokeWidth="1" />
      <path d="M50 100V114M78 100V114" stroke="#e7e2df" strokeWidth="4" />{lace(136,38,88,3)}<g transform="translate(64 125) scale(.8)">{whale}</g>
      <path d="M100 117Q112 112 119 118Q119 127 108 128Q116 135 112 140Q102 137 99 129" fill="#557db0" stroke="#345375" strokeWidth="1" />
    </>}
    {id === 'claude' && <>
      <path d="M39 112L52 104L57 139L29 136ZM76 104L89 113L100 136L71 142Z" fill="#d9924a" stroke="#a46836" strokeWidth=".8" />
      <path d="M51 104H77L83 142Q64 148 45 141Z" fill={fill('cloth')} stroke="#d1bdab" strokeWidth=".8" /><path d="M59 108L56 140M70 108L74 141" stroke="#ddcdbb" strokeWidth=".8" />
      <path d="M43 99L83 99L84 113Q64 119 44 113Z" fill="#31313b" /><path d="M47 111Q64 123 81 111" stroke="#d5a95b" strokeWidth="1.1" fill="none" />
      <path d="M34 126L47 120L51 132L41 136ZM80 121L94 126L87 136L76 132Z" fill="#30303a" />{flower(43,126,.42)}{flower(85,126,.42)}{flower(64,91,.45)}
      {lace(142,30,98,2.5)}
    </>}
    {id === 'chatgpt' && <>
      <path d="M49 107Q64 115 79 107L89 143L64 151L39 143Z" fill={fill('cloth')} stroke="#bbb0cb" strokeWidth=".8" /><path d="M64 109L58 136L65 148L72 136Z" fill="#d8cce6" />
      <path d="M46 105Q64 114 82 105" stroke="#ad9ac7" strokeWidth="1.5" /><path d="M64 107L68 113L64 121L60 113Z" fill="#9e8bbb" stroke="#77658f" strokeWidth=".7" />
      <path d="M80 115L87 138M44 116L40 139" stroke="#c6bbd6" strokeWidth="1" /><circle cx="88" cy="140" r="2" fill="#8a79a2" /><path d="M106 138Q121 146 118 126Q130 147 107 150" fill="#e3ddeb" stroke="#9c91ae" strokeWidth="1.1" />
    </>}
    <path d="M44 92Q32 91 29 108L25 119Q29 127 39 123L48 105M84 92Q96 91 99 108L103 119Q99 127 89 123L80 105" fill={id === 'deepseek' ? '#344465' : '#f9f3ea'} stroke={id === 'deepseek' ? '#25334e' : '#c9bec8'} strokeWidth="1" />
    {lace(121,26,39,2.1)}{lace(121,89,102,2.1)}
    <ellipse cx="31" cy="125" rx="5.8" ry="5.6" fill={fill('skin')} stroke="#c5aaa0" strokeWidth=".7" /><ellipse cx="97" cy="125" rx="5.8" ry="5.6" fill={fill('skin')} stroke="#c5aaa0" strokeWidth=".7" />
    <path d="M29 126V129M33 126V129M95 126V129M99 126V129" stroke="#c99d95" strokeWidth=".6" strokeLinecap="round" />
  </>;
  const forearm = (left: boolean) => <g className={left ? 'candidate-paw-left' : 'candidate-paw-right'}><g transform={left ? undefined : 'translate(128 0) scale(-1 1)'}>
    <path d="M37 77Q24 78 22 90L24 98Q34 101 40 94L43 84" fill={id === 'deepseek' ? '#34476b' : id === 'claude' ? '#fff5e9' : '#eae3f1'} stroke={id === 'deepseek' ? '#263b5e' : '#b8a9c0'} strokeWidth="1" />
    <path d="M24 91Q31 94 38 91" stroke="#fffaf2" strokeWidth="4" strokeLinecap="round" />
    <path d="M25 94Q25 89 31 91Q38 89 38 96L37 102Q33 107 26 102Z" fill={fill('skin')} stroke="#c2a39b" strokeWidth=".85" />
    <path d="M28 99V103M32 99V104M35 98V102" stroke="#c29c94" strokeWidth=".7" strokeLinecap="round" />
  </g></g>;
  const feet = <><g className="anchor-creature-foot anchor-creature-foot-left"><path d="M46 138H58V150H45Z" fill="#fff7ec" stroke="#b5a8ae" strokeWidth=".7" /><path d="M44 148Q50 145 58 148L59 155Q49 160 41 154Z" fill={id === 'claude' ? '#805332' : id === 'chatgpt' ? '#b3a8c7' : '#293650'} stroke={palette.ink} strokeWidth="1" /><path d="M45 150H54" stroke="#f4e9dd" strokeWidth="1.3" /></g><g className="anchor-creature-foot anchor-creature-foot-right"><path d="M70 138H82L83 150H70Z" fill="#fff7ec" stroke="#b5a8ae" strokeWidth=".7" /><path d="M70 148Q78 145 84 148L87 154Q79 160 69 155Z" fill={id === 'claude' ? '#805332' : id === 'chatgpt' ? '#b3a8c7' : '#293650'} stroke={palette.ink} strokeWidth="1" /><path d="M73 150H82" stroke="#f4e9dd" strokeWidth="1.3" /></g></>;

  return <svg className={`pet-avatar pet-avatar-${id} companion-avatar companion-${id}${className ? ` ${className}` : ''}`} data-pose={pose} viewBox={`0 0 128 ${perched ? 120 : 160}`} width={perched ? 32 : 26} height={perched ? 30 : 32.5} fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${prefix}-hair`} x1="0" y1="0" x2=".3" y2="1"><stop stopColor={palette.mid} /><stop offset=".52" stopColor={palette.deep} /><stop offset="1" stopColor={id === 'deepseek' ? '#81cbe4' : palette.light} /></linearGradient>
      <radialGradient id={`${prefix}-hairTop`} cx=".38" cy=".13" r=".98"><stop stopColor={palette.light} /><stop offset=".4" stopColor={palette.mid} /><stop offset="1" stopColor={palette.deep} /></radialGradient>
      <radialGradient id={`${prefix}-skin`} cx=".4" cy=".28" r=".8"><stop stopColor="#fff9ee" /><stop offset=".7" stopColor="#fae7d8" /><stop offset="1" stopColor="#e7bfb2" /></radialGradient>
      <linearGradient id={`${prefix}-eye`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={palette.irisDeep} /><stop offset=".6" stopColor={palette.iris} /><stop offset="1" stopColor="#f8e9d4" /></linearGradient>
      <linearGradient id={`${prefix}-cloth`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#fffaf0" /><stop offset=".55" stopColor="#f6f0e9" /><stop offset="1" stopColor={id === 'chatgpt' ? '#c9bfd8' : '#d9cbbb'} /></linearGradient>
      <linearGradient id={`${prefix}-horn`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#fffefc" /><stop offset=".5" stopColor="#dddce7" /><stop offset="1" stopColor="#a8a4bc" /></linearGradient>
      <linearGradient id={`${prefix}-wing`} x1="0" y1="0" x2=".4" y2="1"><stop stopColor="#e5daf1" /><stop offset=".6" stopColor="#b6a3d4" /><stop offset="1" stopColor="#8875a9" /></linearGradient>
    </defs>
    {perched ? <>{headBack}{torso}{head}{forearm(true)}{forearm(false)}<g className="candidate-chin"><path d="M48 88Q61 91 75 88Q73 95 61 95Q50 95 48 88Z" fill={fill('skin')} /><path d="M53 94Q61 97 70 94" stroke="#c6aaa1" strokeWidth=".7" opacity=".5" /></g></> : <><ellipse cx="64" cy="157" rx="31" ry="2.2" fill={palette.light} opacity=".07" /><g className="anchor-creature-lift">{feet}<g className="anchor-creature-body">{headBack}{torso}{head}</g></g></>}
  </svg>;
}

export { CompanionAvatar };
