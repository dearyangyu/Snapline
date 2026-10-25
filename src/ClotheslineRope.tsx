import type { Ref } from 'react';
import { ropePath } from './clothesline';

export default function ClotheslineRope({ width, ropeRef }: { width: number; ropeRef?: Ref<SVGSVGElement> }) {
  const path = ropePath(width);
  return <svg ref={ropeRef} className="clothesline" width={width} height="94" viewBox={`0 0 ${width} 94`} fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="rope-fade"><stop offset="0" stopColor="white" stopOpacity="0" /><stop offset=".08" stopColor="white" /><stop offset=".92" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity="0" /></linearGradient>
      <mask id="rope-mask"><rect width={width} height="94" fill="url(#rope-fade)" /></mask>
      <filter id="rope-shadow" x="-2%" y="-100%" width="104%" height="300%"><feGaussianBlur stdDeviation="1.2" /></filter>
    </defs>
    <g mask="url(#rope-mask)">
      <path data-rope-path d={path} stroke="rgba(0,0,0,.22)" strokeWidth="1.4" transform="translate(0 1.2)" filter="url(#rope-shadow)" />
      <path data-rope-path d={path} stroke="#8c8c8c" strokeWidth="1.2" />
      <path data-rope-path d={path} stroke="rgba(255,255,255,.45)" strokeWidth=".4" transform="translate(0 -.35)" />
    </g>
  </svg>;
}
