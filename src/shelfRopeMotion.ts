import { dampedSpring, ropeCurve, ropeY } from './clothesline';

interface RopeMode { harmonic: number; velocity: number; stiffness: number; damping: number }
export interface RopePose { offset: number; y: number; slope: number; angle: number }
const settleMs = 3000, impactDelay = 170;
const flatModes: readonly RopeMode[] = [];
const safeWidth = (width: number) => Number.isFinite(width) ? Math.max(1, width) : 1;

/** Mouse pointer IDs are reused. A delayed capture-loss belongs to its original
 * button, not to a newer photo press that happens to have the same pointer ID. */
export function ropeReleaseMatches(held: { id: number; owner: unknown }, event: { pointerId: number; type: string; target: unknown }, targetHasCapture = false) {
  return held.id === event.pointerId && (event.type !== 'lostpointercapture' || event.target === held.owner && !targetHasCapture);
}

/** The static cubic and all attachments use the same analytic curve. */
export function sampleRope(x: number, width: number, elapsedMs: number, modes: readonly RopeMode[] = flatModes): RopePose {
  const w = safeWidth(width), u = Math.max(0, Math.min(1, x / w));
  const curve = ropeCurve(w), inverse = 1 - u;
  let slope = (3 * inverse ** 2 * (curve.control1Y - curve.startY) + 6 * inverse * u * (curve.control2Y - curve.control1Y) + 3 * u ** 2 * (curve.endY - curve.control2Y)) / w;
  let offset = 0;
  if (elapsedMs > impactDelay && elapsedMs < settleMs) {
    const time = (elapsedMs - impactDelay) / 1000;
    for (const mode of modes) {
      const wave = dampedSpring(time, 0, mode.velocity, mode.stiffness, mode.damping).position;
      offset += wave * Math.sin(mode.harmonic * Math.PI * u);
      slope += wave * mode.harmonic * Math.PI / w * Math.cos(mode.harmonic * Math.PI * u);
    }
  }
  // Exact endpoint pinning avoids sin(pi)'s floating point residue.
  if (u === 0 || u === 1) offset = 0;
  return { offset, y: ropeY(x, w) + offset, slope, angle: Math.atan(slope) * 180 / Math.PI };
}

export class ShelfRopeMotion {
  private generation = -1;
  private elapsed = settleMs;
  private modes: readonly RopeMode[] = flatModes;
  private visible = false;
  get moving() { return this.visible && this.elapsed < settleMs; }

  present(generation: number, visible: boolean, reversing: boolean) {
    if (visible && generation !== this.generation) {
      if (!reversing || this.generation < 0) {
        const sign = generation % 2 ? -1 : 1;
        const variation = Math.sin(generation * 2.39996);
        this.modes = [
          { harmonic: 1, velocity: 65 + variation * 5, stiffness: 122, damping: 5.8 },
          { harmonic: 2, velocity: sign * (16 + variation * 3), stiffness: 347, damping: 5.5 },
          { harmonic: 3, velocity: -sign * (9 - variation * 2), stiffness: 761, damping: 6.4 },
        ];
        this.elapsed = 0;
      }
      this.generation = generation;
    }
    this.visible = visible;
  }

  advance(elapsedMs: number, paused = false, reduced = false) {
    if (reduced) { this.elapsed = settleMs; return; }
    if (!this.visible || paused || !Number.isFinite(elapsedMs)) return;
    this.elapsed = Math.min(settleMs, this.elapsed + Math.max(0, Math.min(40, elapsedMs)));
  }
  sample(x: number, width: number) { return sampleRope(x, width, this.elapsed, this.modes); }
  path(width: number) {
    const w = safeWidth(width), count = Math.max(16, Math.min(48, Math.ceil(w / 70))), step = w / count;
    let a = this.sample(0, w), path = `M 0 ${a.y.toFixed(4)}`;
    for (let i = 1; i <= count; i++) {
      const x = i * step, b = this.sample(x, w), previous = x - step;
      path += ` C ${(previous + step / 3).toFixed(3)} ${(a.y + a.slope * step / 3).toFixed(4)} ${(x - step / 3).toFixed(3)} ${(b.y - b.slope * step / 3).toFixed(4)} ${x.toFixed(3)} ${b.y.toFixed(4)}`;
      a = b;
    }
    return path;
  }
}

function perchEnvelope(x: number, width: number) {
  const pose = sampleRope(x, width, 0);
  // 32/w bounds the three wave modes' summed derivative. Using this envelope
  // keeps size steady throughout the bounce instead of breathing with rope Y.
  const angle = Math.atan(Math.abs(pose.slope) + 32 / safeWidth(width));
  return { y: pose.y, up: 34 * Math.cos(angle) + 22 * Math.sin(angle), side: 22 * Math.cos(angle) + 34 * Math.sin(angle) };
}

/** Includes the vector actions and the full 192×208 source sprites: a 203px
 * standing contact uses 33.833px above the rope at 32px logical width. Reserve
 * 3px upward rebound plus 3px clear screen-edge space.
 * Clips stay 9px wide even when a body must shrink in a closing FLIP gap. */
export function ropePerchScale(x: number, width: number, pegCenters: readonly number[] = [], neighbors: readonly number[] = []) {
  const { y, up, side } = perchEnvelope(x, width);
  const vertical = (y - 6) / up, horizontal = (Math.min(x, width - x) - 3) / side;
  const pegLimit = pegCenters.length ? (Math.min(...pegCenters.map(peg => Math.abs(peg - x))) - 6) / side : 1.5;
  const neighborLimit = neighbors.length ? Math.min(...neighbors.map(neighbor => Math.abs(neighbor - x))) / 80 : 1.5;
  return Math.max(0, Math.min(1.5, vertical, horizontal, pegLimit, neighborLimit));
}

/** Spread the larger residents across separate clip gaps. On a shallow narrow
 * screen, smaller bodies use proportionately smaller safe spacing. */
export function ropePerches(width: number, count: number, pegCenters: readonly number[]) {
  const w = safeWidth(width), residents = Math.max(0, Math.min(3, Math.floor(count)));
  const slots: number[] = [];
  const targets = residents === 1 ? [.5] : residents === 2 ? [.29, .71] : [.24, .5, .76];
  const usedGaps = new Set<number>(), pegs = [...pegCenters].sort((a, b) => a - b);
  for (const target of targets.slice(0, residents)) {
    let best: { x: number; gap: number; score: number } | undefined;
    for (let x = 20; x <= w - 20; x += 2) {
      const scale = ropePerchScale(x, w), clearance = 6 + perchEnvelope(x, w).side * scale;
      if (scale < .2 || pegs.some(peg => Math.abs(peg - x) < clearance) || slots.some(previous => Math.abs(previous - x) < 40 * (scale + ropePerchScale(previous, w)))) continue;
      const gap = pegs.filter(peg => peg < x).length;
      const score = Math.abs(x - target * w) + (usedGaps.has(gap) ? w : 0);
      if (!best || score < best.score) best = { x, gap, score };
    }
    if (best) { slots.push(best.x); usedGaps.add(best.gap); }
  }
  return slots.sort((a, b) => a - b).map(x => ({ x, scale: ropePerchScale(x, w, pegs, slots.filter(other => other !== x)) }));
}

export interface RopePeg { id: string; x: number }
export interface RopePerchBinding { left?: string; right?: string; fraction: number; contentX: number; anchorOffset: number }

export function ropeBindingFits(binding: RopePerchBinding, orderedPegIds: readonly string[]) {
  const left = binding.left ? orderedPegIds.indexOf(binding.left) : -1;
  const right = binding.right ? orderedPegIds.indexOf(binding.right) : -1;
  if (binding.left && left < 0 || binding.right && right < 0) return false;
  if (!binding.left && !binding.right) return orderedPegIds.length === 0;
  if (!binding.left) return right === 0;
  if (!binding.right) return left === orderedPegIds.length - 1;
  return right === left + 1;
}

/** Keep residents in their original clip gap while scrolling. Binding identities
 * avoids center-first gap reselection teleporting pets on a one-pixel scroll. */
export function bindRopePerch(x: number, pegs: readonly RopePeg[], scrollLeft: number): RopePerchBinding {
  const sorted = [...pegs].sort((a, b) => a.x - b.x);
  const right = sorted.find(peg => peg.x >= x), left = [...sorted].reverse().find(peg => peg.x < x);
  return { left: left?.id, right: right?.id, fraction: left && right ? (x - left.x) / Math.max(1, right.x - left.x) : 0,
    contentX: x + scrollLeft, anchorOffset: x - (left?.x ?? right?.x ?? x) };
}
export function resolveRopePerch(binding: RopePerchBinding, pegs: ReadonlyMap<string, number>, scrollLeft: number) {
  const left = binding.left ? pegs.get(binding.left) : undefined, right = binding.right ? pegs.get(binding.right) : undefined;
  if (left !== undefined && right !== undefined) return left + (right - left) * binding.fraction;
  if (left !== undefined || right !== undefined) return (left ?? right)! + binding.anchorOffset;
  return binding.contentX - scrollLeft;
}

/** A closing FLIP gap must not compress several residents into one another. */
export function resolveRopePerches(bindings: readonly RopePerchBinding[], pegs: ReadonlyMap<string, number>, scrollLeft: number) {
  const positions = bindings.map(binding => resolveRopePerch(binding, pegs, scrollLeft));
  const groups = new Map<string, number[]>();
  bindings.forEach((binding, index) => {
    if (!binding.left || !binding.right || !pegs.has(binding.left) || !pegs.has(binding.right)) return;
    const key = `${binding.left}\0${binding.right}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const binding = bindings[indices[0]], left = pegs.get(binding.left!)!, right = pegs.get(binding.right!)!;
    const ordered = [...indices].sort((a, b) => positions[a] - positions[b]);
    const density = Math.min(1, (right - left) / (76 + 120 * (ordered.length - 1)));
    const separation = 120 * density, clearance = 38 * density;
    if (ordered.every((index, i) => i === 0 || positions[index] - positions[ordered[i - 1]] >= separation)) continue;
    const half = (ordered.length - 1) * separation / 2;
    const center = Math.max(left + clearance + half, Math.min(right - clearance - half, ordered.reduce((sum, index) => sum + positions[index], 0) / ordered.length));
    ordered.forEach((index, i) => { positions[index] = center + (i - (ordered.length - 1) / 2) * separation; });
  }
  return positions;
}

/** FLIP owns the card transform. Correct only the independent rope offset so
 * its clip follows the current visual X and does not count FLIP's Y twice. */
export function ropeAttachment(motion: ShelfRopeMotion, width: number, center: number, baseY: number, reflowX = 0, reflowY = 0) {
  const pose = motion.sample(center + reflowX, width);
  return { offset: pose.y - baseY - reflowY, angle: pose.angle };
}
