export type Action = 'rest' | 'peek' | 'look' | 'stretch' | 'wave' | 'duck';
export interface Pose { headX: number; headY: number; angle: number; scaleX: number; scaleY: number; gazeX: number; gazeY: number; eyes: number; leftY: number; rightY: number; leftAngle: number; rightAngle: number; bodyX: number; bodyY: number; chinY: number }
export const quietPose = (): Pose => ({ headX: 0, headY: 0, angle: 0, scaleX: 1, scaleY: 1, gazeX: 0, gazeY: 0, eyes: 1, leftY: 0, rightY: 0, leftAngle: 0, rightAngle: 0, bodyX: 1, bodyY: 1, chinY: 0 });
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const ease = (n: number) => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
const envelope = (p: number) => ease(p / .22) * (1 - ease((p - .73) / .27));
export function seededRandom(seed: number) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
interface Resident { action: Action; start: number; duration: number; direction: number; gain: number; from: Pose; cooldown: Partial<Record<Action, number>>; replyTo?: number; blinkAt: number; blinkStart: number; doubleBlink: boolean }
interface Reply { target: number; from: number; at: number; expires: number; action: 'look' | 'duck' }
export interface MotionFrame { action: Action; pose: Pose }
export interface PerchMotionOptions { showcase?: boolean }

/** Only pose variables are written; the rope owns attachment geometry. */
export const PERCHED_POSE_FIELDS: readonly [keyof Pose, string, string][] = [
  ['headX', 'head-x', 'px'], ['headY', 'head-y', 'px'], ['angle', 'head-angle', 'deg'],
  ['scaleX', 'head-scale-x', ''], ['scaleY', 'head-scale-y', ''], ['gazeX', 'gaze-x', 'px'], ['gazeY', 'gaze-y', 'px'],
  ['eyes', 'eye-open', ''], ['leftY', 'paw-left-y', 'px'], ['rightY', 'paw-right-y', 'px'],
  ['leftAngle', 'paw-left-angle', 'deg'], ['rightAngle', 'paw-right-angle', 'deg'],
  ['bodyX', 'body-scale-x', ''], ['bodyY', 'body-scale-y', ''], ['chinY', 'chin-y', 'px'],
];
export function applyPerchedPose(element: { style: Pick<CSSStyleDeclaration, 'setProperty'> }, pose: Pose) {
  for (const [key, property, unit] of PERCHED_POSE_FIELDS) element.style.setProperty(`--candidate-${property}`, `${pose[key].toFixed(4)}${unit}`);
}

/** Finite clothesline action scheduler. Time advances only while the caller
 * presents frames; no wall-clock catch-up, per-frame randomness or shared loop. */
export class PerchMotion {
  time = 0;
  readonly residents: Resident[];
  readonly history: { at: number; index: number; action: Action; replyTo?: number }[] = [];
  private random: () => number;
  private replies: Reply[] = [];
  private showcase: { index: number; action: Action }[];
  private nextActionAt = 700;
  private interactions = true;
  private lastInitiator = -1;
  private reduced = false;
  constructor(count: number, seed = Date.now(), options: PerchMotionOptions = {}) {
    this.random = seededRandom(seed);
    const residents = Number.isFinite(count) ? clamp(Math.floor(count), 1, 3) : 1;
    this.residents = Array.from({ length: residents }, (_, index) => ({ action: 'rest', start: 0, duration: 650 + index * 590 + this.range(0, 350), direction: index % 2 ? -1 : 1, gain: 1,
      from: quietPose(), cooldown: {},
      blinkAt: this.range(1100, 3100) + index * 370, blinkStart: -1000, doubleBlink: false }));
    this.showcase = options.showcase ? [{ index: 0, action: 'peek' }, { index: this.residents.length - 1, action: 'stretch' }, { index: Math.min(1, this.residents.length - 1), action: 'wave' }] : [];
    this.nextActionAt = this.range(500, 1000);
  }
  private range(a: number, b: number) { return a + (b - a) * this.random(); }
  private pose(index: number): Pose {
    const r = this.residents[index], p = clamp((this.time - r.start) / r.duration, 0, 1), strength = envelope(p) * r.gain, d = r.direction, result = quietPose();
    // Breathing is small enough to leave the chin and paws planted on the rope.
    result.headY = -.16 * Math.sin(this.time / (1700 + index * 211) + index * 1.7);
    result.bodyY = 1 + .014 * Math.sin(this.time / (1800 + index * 193) + index * 2);
    if (r.action === 'peek') { result.headX = .7 * d * strength; result.headY += 2.2 * strength; result.angle = 5.5 * d * strength; result.gazeY = 1.7 * strength; result.scaleY = 1 - .025 * strength; }
    if (r.action === 'look') { result.headX = 1.25 * d * strength; result.angle = 7 * d * strength; result.gazeX = 1.8 * d * strength; result.gazeY = -.35 * strength; }
    if (r.action === 'stretch') { result.headY -= 2.5 * strength; result.scaleX = 1 - .035 * strength; result.scaleY = 1 + .085 * strength; result.bodyX = 1 + .07 * strength; result.bodyY = 1 - .06 * strength; result.eyes = 1 - .58 * strength; result.chinY = -.7 * strength; result.angle = -2 * d * strength; }
    if (r.action === 'wave') {
      result.headX = .9 * d * strength; result.angle = 5 * d * strength; result.gazeX = 1.6 * d * strength;
      const flutter = Math.sin(p * Math.PI * 5) * 12 * strength;
      if (d > 0) { result.rightY = -3.6 * strength; result.rightAngle = (-33 * strength + flutter); }
      else { result.leftY = -3.6 * strength; result.leftAngle = (33 * strength + flutter); }
    }
    if (r.action === 'duck') { result.headX = -1.15 * d * strength; result.headY += 2.1 * strength; result.angle = -8.5 * d * strength; result.scaleY = 1 - .06 * strength; result.gazeX = d * strength; result.eyes = 1 - .72 * strength; result.bodyY = 1 - .035 * strength; }
    const blink = this.time - r.blinkStart;
    const close = (elapsed: number) => elapsed >= 0 && elapsed <= 170 ? Math.sin(Math.PI * elapsed / 170) ** 2 : 0;
    result.eyes *= 1 - .94 * Math.max(close(blink), r.doubleBlink ? close(blink - 255) : 0);
    const blend = ease((this.time - r.start) / 160);
    for (const key of Object.keys(result) as (keyof Pose)[]) result[key] = r.from[key] + (result[key] - r.from[key]) * blend;
    return result;
  }
  private begin(index: number, action: Action, replyTo?: number) {
    const resident = this.residents[index];
    const current = this.pose(index);
    resident.from = current; resident.action = action; resident.start = this.time; resident.replyTo = replyTo;
    resident.gain = this.range(.86, 1.08);
    resident.duration = action === 'rest' ? this.range(600, 1900) : action === 'stretch' ? this.range(2200, 3000) : action === 'wave' ? this.range(1800, 2400) : this.range(1600, 2550);
    const neighbor = index === 0 ? 1 : index === this.residents.length - 1 ? index - 1 : this.random() < .5 ? index - 1 : index + 1;
    resident.direction = replyTo !== undefined ? Math.sign(replyTo - index) : this.residents.length > 1 ? Math.sign(neighbor - index) : this.random() < .5 ? -1 : 1;
    // Repeated manual waves keep the supporting hand planted during the
    // crossfade, even when a new random glance would face the other way.
    if (action === 'wave' && current.leftY < -.01) resident.direction = -1;
    if (action === 'wave' && current.rightY < -.01) resident.direction = 1;
    if (action !== 'rest') {
      resident.cooldown[action] = this.time + resident.duration + this.range(5500, 11000);
      this.history.push({ at: this.time, index, action, replyTo });
      if (this.history.length > 1000) this.history.shift();
    }
    if (action === 'wave' && replyTo === undefined && this.interactions && this.residents.length > 1) {
      const delay = this.range(440, 920);
      this.replies = this.replies.filter(reply => reply.target !== neighbor);
      this.replies.push({ target: neighbor, from: index, at: this.time + delay, expires: this.time + delay + 2500, action: this.random() < .58 ? 'duck' : 'look' });
    }
  }
  setInteractions(enabled: boolean) { this.interactions = enabled; if (!enabled) this.replies = []; }
  trigger(action: Exclude<Action, 'rest'>, index = 0) {
    if (!this.residents[index]) return;
    this.replies = [];
    this.residents.forEach((resident, i) => { if (i !== index && resident.action !== 'rest') this.begin(i, 'rest'); });
    this.begin(index, action); this.lastInitiator = index;
  }
  sample(reduced = false): MotionFrame[] { return this.residents.map((r, i) => ({ action: reduced ? 'rest' : r.action, pose: reduced ? quietPose() : this.pose(i) })); }
  advance(deltaMs: number, paused = false, reduced = false): MotionFrame[] {
    if (reduced) {
      if (!this.reduced) {
        this.replies = [];
        for (const resident of this.residents) {
          resident.action = 'rest'; resident.from = quietPose(); resident.start = this.time;
          resident.replyTo = undefined; resident.blinkStart = this.time - 1000;
          resident.blinkAt = this.time + this.range(1300, 3200);
        }
        this.nextActionAt = this.time + this.range(700, 1400);
      }
      this.reduced = true;
      return this.sample(true);
    }
    // Resume from the quiet posture instead of popping back to the old lifted
    // head or raised paw. Ordinary holds/hidden windows preserve their pose.
    if (this.reduced) { this.reduced = false; return this.sample(); }
    if (paused) return this.sample();
    this.time += Number.isFinite(deltaMs) ? clamp(deltaMs, 0, 40) : 0;
    for (const [index, r] of this.residents.entries()) {
      if (this.time >= r.blinkAt) { r.blinkStart = this.time; r.doubleBlink = this.random() < .26; r.blinkAt = this.time + this.range(2600, 6600); }
      if (r.action !== 'rest' && this.time - r.start >= r.duration) {
        this.begin(index, 'rest');
        this.nextActionAt = this.time + this.range(320, 1050);
      }
    }
    this.replies = this.replies.filter(reply => {
      if (!this.interactions || reply.expires < this.time) return false;
      if (reply.at > this.time || this.residents[reply.target].action !== 'rest') return true;
      const resident = this.residents[reply.target];
      const action = ([reply.action, reply.action === 'look' ? 'duck' : 'look'] as const).find(candidate => (resident.cooldown[candidate] ?? 0) <= this.time);
      if (action) this.begin(reply.target, action, reply.from);
      return false;
    });
    if (this.time >= this.nextActionAt && this.residents.every(resident => resident.action === 'rest')) {
      const requested = this.showcase[0];
      const next = requested && (this.residents[requested.index].cooldown[requested.action] ?? 0) <= this.time ? this.showcase.shift() : undefined;
      const actors = this.residents.map((_, index) => index).filter(index => index !== this.lastInitiator || this.residents.length === 1);
      const index = next?.index ?? actors[Math.floor(this.random() * actors.length)];
      const resident = this.residents[index];
      const available = (['peek', 'look', 'stretch', 'wave', 'duck'] as Action[]).filter(action => (resident.cooldown[action] ?? 0) <= this.time);
      const action = next?.action ?? available[Math.floor(this.random() * available.length)];
      if (action) { this.begin(index, action); this.lastInitiator = index; }
      else this.nextActionAt = this.time + 500;
    }
    return this.sample();
  }
}
