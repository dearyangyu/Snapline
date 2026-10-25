import { ISLAND_PERIMETER, wrapPhase } from './islandRimMotion';

export const FLOW_GEOMETRY = { width: 168, height: 42, padding: 44, surfaceWidth: 256, surfaceHeight: 130 } as const;
const TAU = 2 * Math.PI;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (value: number) => value * value * (3 - 2 * value);
type Palette = readonly (readonly [number, readonly number[]])[];
const palettes: readonly Palette[] = [
  [[0, [97, 235, 255]], [.27, [43, 159, 255]], [.61, [132, 91, 255]], [1, [214, 67, 235]]],
  [[0, [255, 207, 128]], [.17, [249, 137, 219]], [.41, [193, 97, 255]], [.73, [94, 115, 255]], [1, [48, 207, 248]]],
];

export function flowLobe(travel: number, lobe: 0 | 1, amount = 1) {
  const flow = clamp(amount, 0, 1.8), q = travel / ISLAND_PERIMETER * TAU;
  const offset = lobe === 0 ? .62 : 4.13;
  const length = clamp(151 + flow * (14 * Math.sin(q * (lobe ? .91 : 1.13) + offset) + 11 * Math.sin(q * .41 - offset)), 125, 181);
  const gain = clamp(.91 + flow * (.12 * Math.sin(q * (lobe ? 1.19 : .83) + offset) + .09 * Math.sin(q * 1.37 - offset * .7)), .57, 1.25);
  return { q, flow, offset, length, gain, head: travel + lobe * ISLAND_PERIMETER / 2 };
}

/** Smooth spatial waves move through each lobe; no frame-wise randomness and
 * no single global brightness multiplier that pulses the whole island. */
export function flowSample(travel: number, lobe: 0 | 1, position: number, amount = 1) {
  const { q, flow, offset, length, gain } = flowLobe(travel, lobe, amount);
  const t = clamp(position, 0, 1), distance = t * length;
  const wave = Math.sin(TAU * 2.15 * t - q * (lobe ? 1.17 : .93) + offset);
  const ripple = Math.sin(TAU * 4.1 * t - q * (lobe ? 1.43 : 1.61) - offset * .8);
  const swell = clamp(.5 + .36 * wave + .14 * ripple, 0, 1);
  const envelope = smooth(Math.min(1, distance / 18)) * (1 - smooth(t));
  const opacity = clamp(envelope * gain * (1 + flow * (.19 * wave + .07 * ripple)), 0, 1);
  const colorPosition = clamp(t + flow * .045 * Math.sin(q * .29 + t * TAU + offset), 0, 1);
  const palette = palettes[lobe];
  let i = 1;
  while (i < palette.length - 1 && colorPosition > palette[i][0]) i++;
  const [start, from] = palette[i - 1], [end, to] = palette[i];
  const blend = (colorPosition - start) / (end - start);
  const color = from.map((value, channel) => Math.round(value + (to[channel] - value) * blend));
  return {
    opacity, color,
    edgeWidth: clamp(.8 + .13 * flow * wave, .62, 1.02),
    haloWidth: clamp(2.7 + 2.8 * flow * swell, 2.7, 6.8),
    outward: .3 + 1.15 * flow * swell,
  };
}

export function flowPoint(distance: number, outward = 0): [number, number] {
  let s = wrapPhase(distance);
  const radius = 20.6, straight = 126, left = 44.4, top = 44.4;
  if (s < straight) return [left + radius + s, top - outward];
  s -= straight;
  if (s < Math.PI * radius) {
    const angle = -Math.PI / 2 + s / radius;
    return [left + radius + straight + Math.cos(angle) * (radius + outward), top + radius + Math.sin(angle) * (radius + outward)];
  }
  s -= Math.PI * radius;
  if (s < straight) return [left + radius + straight - s, top + 2 * radius + outward];
  s -= straight;
  const angle = Math.PI / 2 + s / radius;
  return [left + radius + Math.cos(angle) * (radius + outward), top + radius + Math.sin(angle) * (radius + outward)];
}
