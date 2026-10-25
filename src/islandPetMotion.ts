export type PetActivity = 'rest' | 'look' | 'walk' | 'stretch' | 'hop' | 'wiggle';
export interface PetPose {
  activity: PetActivity;
  x: number;
  y: number;
  lift: number;
  lean: number;
  scaleX: number;
  scaleY: number;
  gazeX: number;
  gazeY: number;
  eyeOpen: number;
  leftFootX: number;
  leftFootY: number;
  rightFootX: number;
  rightFootY: number;
}

export const petTravel = 24;
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const restPose = (x = 0): PetPose => ({ activity: 'rest', x, y: 0, lift: 0, lean: 0, scaleX: 1, scaleY: 1, gazeX: 0, gazeY: 0, eyeOpen: 1, leftFootX: 0, leftFootY: 0, rightFootX: 0, rightFootY: 0 });
interface Segment { activity: PetActivity; elapsed: number; duration: number; from: number; to: number; gazeX: number; gazeY: number; direction: number; cycles: number }
interface Blink { elapsed: number; first: number; gap: number; second: number }

/** A bounded plan, not a looping timeline. Randomness is sampled only at decisions. */
export class IslandPetMotion {
  private pose = restPose();
  private segment: Segment;
  private blink: Blink | null = null;
  private blinkWait: number;
  private reduced = false;
  private activeChain = 0;
  private lastActive: PetActivity = 'rest';

  constructor(private random: () => number = Math.random) {
    this.segment = this.rest(180 + this.unit() * 260);
    this.blinkWait = 1100 + this.unit() * 2500;
  }

  private unit() {
    const value = this.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  }

  private rest(duration = 250 + this.unit() ** 0.9 * 850): Segment {
    return { activity: 'rest', elapsed: 0, duration, from: this.pose.x, to: this.pose.x, gazeX: 0, gazeY: 0, direction: 1, cycles: 1 };
  }

  private next() {
    // Brief rests punctuate a few gestures, rather than forcing a long pause
    // after every action. Never concatenate rests or an endless dance chain.
    if (this.segment.activity !== 'rest' && (this.activeChain >= 4 || this.unit() < 0.42)) {
      this.activeChain = 0; this.segment = this.rest(); return;
    }
    const choice = this.unit();
    let activity: PetActivity = choice < 0.55 ? 'walk' : choice < 0.69 ? 'look' : choice < 0.83 ? 'stretch' : choice < 0.95 ? 'wiggle' : 'hop';
    if (activity === this.lastActive && activity !== 'walk') activity = 'walk';
    this.lastActive = activity; this.activeChain++;
    const direction = this.unit() < 0.5 ? -1 : 1;
    const base = { ...this.rest(0), activity, direction };
    if (activity === 'look') {
      this.segment = { ...base, duration: 700 + this.unit() * 650, gazeX: direction * (0.85 + this.unit() * 0.75), gazeY: (this.unit() - 0.6) * 1.2 }; return;
    }
    if (activity === 'stretch') { this.segment = { ...base, duration: 1050 + this.unit() * 650 }; return; }
    if (activity === 'wiggle') { this.segment = { ...base, duration: 750 + this.unit() * 500, cycles: this.unit() < 0.7 ? 1 : 2 }; return; }
    if (activity === 'hop') { this.segment = { ...base, duration: 680 + this.unit() * 260 }; return; }
    let to = (this.unit() * 2 - 1) * petTravel;
    // A near-identical destination becomes a small, deliberate step; no retries
    // or unbounded loops even for a faulty/constant random source.
    if (Math.abs(to - this.pose.x) < 7) to = Math.max(-petTravel, Math.min(petTravel, this.pose.x + (this.pose.x > 0 ? -1 : 1) * (9 + this.unit() * 8)));
    const speed = 22 + this.unit() * 18;
    this.segment = { ...base, duration: Math.max(750, Math.abs(to - this.pose.x) / speed * 1000), to };
  }

  private advanceBlink(elapsed: number) {
    if (!this.blink) {
      this.blinkWait -= elapsed;
      if (this.blinkWait <= 0) this.blink = { elapsed: 0, first: 95 + this.unit() * 55, gap: 85 + this.unit() * 90, second: this.unit() < 0.22 ? 90 + this.unit() * 45 : 0 };
    } else this.blink.elapsed += elapsed;
    if (!this.blink) return 1;
    const { elapsed: age, first, gap, second } = this.blink;
    const total = first + (second ? gap + second : 0);
    if (age >= total) {
      this.blink = null; this.blinkWait = 1700 + this.unit() ** 0.7 * 4900;
      return 1;
    }
    const local = age <= first ? age / first : second && age >= first + gap ? (age - first - gap) / second : 0;
    return 1 - 0.95 * Math.sin(Math.PI * local) ** 0.7;
  }

  /** Elapsed means active time. Pause is exact; a resumed/hidden frame cannot fast-forward. */
  advance(elapsedMs: number, options: { paused?: boolean; reducedMotion?: boolean } = {}): PetPose {
    if (options.reducedMotion) {
      if (!this.reduced) {
        this.reduced = true; this.pose = restPose(this.pose.x); this.blink = null;
        this.segment = this.rest(700); this.blinkWait = 2200; this.activeChain = 0;
      }
      return { ...this.pose };
    }
    this.reduced = false;
    if (options.paused) return { ...this.pose };
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(40, elapsedMs)) : 0;
    this.segment.elapsed = Math.min(this.segment.duration, this.segment.elapsed + elapsed);
    const { activity, from, to, duration } = this.segment;
    const progress = this.segment.elapsed / duration;
    let pose = restPose(from);
    pose.activity = activity;
    if (activity === 'walk') {
      const distance = to - from, ease = smooth(progress);
      pose.x = from + distance * ease;
      const velocity = distance * 30 * progress ** 2 * (progress - 1) ** 2 / (duration / 1000);
      const energy = Math.min(1, Math.abs(velocity) / 26);
      const stride = Math.abs(pose.x - from) * Math.PI * 2 / 10;
      const step = Math.sin(stride), direction = Math.sign(distance);
      pose.y = -Math.abs(step) * 0.72 * energy;
      pose.lean = direction * 2.3 * energy + step * 0.7 * energy;
      pose.gazeX = direction * 1.15 * Math.sin(Math.PI * progress);
      pose.leftFootX = step * 1.2 * energy; pose.rightFootX = -pose.leftFootX;
      pose.leftFootY = -Math.max(0, step) * 1.15 * energy;
      pose.rightFootY = -Math.max(0, -step) * 1.15 * energy;
    } else if (activity === 'look') {
      const weight = progress < 0.3 ? smooth(progress / 0.3) : progress > 0.6 ? smooth((1 - progress) / 0.4) : 1;
      pose.gazeX = this.segment.gazeX * weight; pose.gazeY = this.segment.gazeY * weight;
      pose.lean = this.segment.direction * 4.5 * weight;
      pose.scaleY = 1 + 0.025 * weight;
    } else if (activity === 'stretch') {
      const weight = progress < 0.35 ? smooth(progress / 0.35) : progress > 0.65 ? smooth((1 - progress) / 0.35) : 1;
      pose.scaleX = 1 - 0.065 * weight; pose.scaleY = 1 + 0.12 * weight;
      pose.lean = this.segment.direction * 1.6 * weight; pose.gazeY = -0.65 * weight;
      pose.leftFootX = -0.5 * weight; pose.rightFootX = 0.5 * weight;
    } else if (activity === 'wiggle') {
      const envelope = Math.sin(Math.PI * progress) ** 2;
      const sway = Math.sin(progress * Math.PI * 2 * this.segment.cycles) * envelope;
      pose.lean = sway * 4.5 * this.segment.direction;
      pose.scaleX = 1 + envelope * 0.025; pose.scaleY = 1 - envelope * 0.025;
      pose.gazeX = -sway * 0.65 * this.segment.direction;
      pose.leftFootX = sway * 0.35; pose.rightFootX = -sway * 0.35;
    } else if (activity === 'hop') {
      const flight = progress > 0.2 && progress < 0.8 ? Math.sin(Math.PI * (progress - 0.2) / 0.6) ** 2 : 0;
      const squash = progress <= 0.2 ? Math.sin(Math.PI * progress / 0.2) ** 2 : progress >= 0.8 ? Math.sin(Math.PI * (progress - 0.8) / 0.2) ** 2 : 0;
      // Lift is shared by the body AND feet; the contact shadow stays grounded.
      pose.lift = -3.2 * flight;
      pose.scaleX = 1 + 0.1 * squash - 0.025 * flight;
      pose.scaleY = 1 - 0.1 * squash + 0.035 * flight;
      pose.y = 0.15 * squash; pose.gazeY = -0.35 * flight;
      pose.leftFootX = -0.4 * squash; pose.rightFootX = 0.4 * squash;
    }
    pose.eyeOpen = this.advanceBlink(elapsed);
    this.pose = pose;
    if (this.segment.elapsed === duration) this.next();
    return { ...pose };
  }
}
