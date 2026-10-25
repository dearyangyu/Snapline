import type { PetPose } from './islandPetMotion';

export interface PetPersonality { speed: number; curiosity: number; playfulness: number }
export interface GroupPetPose extends PetPose { interaction: 'none' | 'greet' | 'reply' | 'yield'; partner: number | null }
type Kind = 'rest' | 'walk' | 'meet' | 'yield' | 'solo';
interface Plan { kind: Kind; age: number; duration: number; from: number[]; to: number[]; leader: number; partner: number; direction: number; gesture: number }
interface Blink { wait: number; age: number }
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
const pulse = (t: number, from: number, to: number) => t > from && t < to ? Math.sin(Math.PI * (t - from) / (to - from)) ** 2 : 0;
const rest = (x: number): GroupPetPose => ({ activity: 'rest', interaction: 'none', partner: null, x, y: 0, lift: 0, lean: 0, scaleX: 1, scaleY: 1, gazeX: 0, gazeY: 0, eyeOpen: 1, leftFootX: 0, leftFootY: 0, rightFootX: 0, rightFootY: 0 });

/** Centers stay ordered. Even rotation/squash fits between neighboring bodies. */
export const groupPetLayout = (count: number) => count === 2
  ? { width: 24, height: 28 * 24 / 26, limit: 32, separation: 30 }
  : { width: 22, height: 28 * 22 / 26, limit: 33, separation: 28 };

/** A small shared stage: decisions are irregular, replies follow a particular
 * neighbor, and a passing gesture makes room without swapping/crossing bodies. */
export class IslandPetGroupMotion {
  private readonly count: number;
  private readonly layout;
  private poses: GroupPetPose[];
  private plan: Plan;
  private readonly blinks: Blink[];
  private reduced = false;
  private lastLeader = -1;

  constructor(count: number, private interactions = true, private random: () => number = Math.random, private personalities: readonly PetPersonality[] = []) {
    this.count = count === 2 ? 2 : 3;
    this.layout = groupPetLayout(this.count);
    this.poses = Array.from({ length: this.count }, (_, i) => rest((i - (this.count - 1) / 2) * (this.count === 2 ? 40 : 28)));
    this.plan = this.makePlan('rest', 180 + this.unit() * 300);
    this.blinks = this.poses.map((_, i) => ({ wait: 800 + i * 350 + this.unit() * 2300, age: -1 }));
  }

  setInteractions(enabled: boolean) { this.interactions = enabled; } // Finish the current reply smoothly.
  private unit() { const value = this.random(); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5; }
  private personality(index: number) {
    const source = this.personalities[index];
    const value = (key: keyof PetPersonality) => Number.isFinite(source?.[key]) ? Math.max(.75, Math.min(1.25, source[key])) : 1;
    return { speed: value('speed'), curiosity: value('curiosity'), playfulness: value('playfulness') };
  }
  private makePlan(kind: Kind, duration: number): Plan {
    return { kind, age: 0, duration, from: this.poses.map(pose => pose.x), to: this.poses.map(pose => pose.x), leader: 0, partner: 1, direction: 1, gesture: 0 };
  }
  private formation() {
    // Distribute the available slack between and outside the bodies. Convex
    // interpolation between valid formations preserves both ordering and gaps.
    const { limit, separation } = this.layout;
    const weights = Array.from({ length: this.count + 1 }, () => .15 + this.unit());
    const slack = 2 * limit - (this.count - 1) * separation, total = weights.reduce((a, b) => a + b);
    let x = -limit;
    return this.poses.map((_, i) => { x += weights[i] / total * slack + (i ? separation : 0); return x; });
  }
  private next() {
    if (this.plan.kind !== 'rest') { this.plan = this.makePlan('rest', 220 + this.unit() * 560); return; }
    let leader = Math.min(this.count - 1, Math.floor(this.unit() * this.count));
    if (leader === this.lastLeader) leader = (leader + 1) % this.count;
    this.lastLeader = leader;
    const neighbor = leader === 0 ? 1 : leader === this.count - 1 ? leader - 1 : this.unit() < .5 ? leader - 1 : leader + 1;
    const personality = this.personality(leader), choice = this.unit();
    const kind: Kind = this.interactions && choice < .56 * personality.curiosity ? (this.unit() < .34 ? 'yield' : 'meet') : this.unit() < .72 ? 'walk' : 'solo';
    const plan = this.makePlan(kind, (kind === 'meet' ? 2450 + this.unit() * 650 : kind === 'yield' ? 1850 + this.unit() * 500 : kind === 'solo' ? 850 + this.unit() * 650 : 1050 + this.unit() * 650) / personality.speed);
    plan.leader = leader; plan.partner = neighbor; plan.direction = Math.sign(neighbor - leader); plan.gesture = this.unit();
    if (kind === 'walk' || kind === 'meet') plan.to = this.formation();
    if (kind === 'yield') {
      const leftSpace = this.layout.limit + plan.from[0], rightSpace = this.layout.limit - plan.from[this.count - 1];
      plan.direction = rightSpace >= leftSpace ? 1 : -1;
      const distance = (plan.direction > 0 ? rightSpace : leftSpace) * (.75 + this.unit() * .25) * plan.direction;
      plan.to = plan.from.map(x => x + distance);
    }
    // A large two-pet reposition must not rush just to fit the greeting's first
    // third. Quintic easing peaks at 1.875× mean speed; cap it at 42 CSS px/s.
    const travel = Math.max(...plan.to.map((x, i) => Math.abs(x - plan.from[i])));
    const walkingFraction = kind === 'meet' ? .32 : kind === 'yield' ? .57 : 1;
    plan.duration = Math.max(plan.duration, travel * 1.875 / 42 * 1000 / walkingFraction);
    this.plan = plan;
  }
  private blink(index: number, elapsed: number) {
    const blink = this.blinks[index];
    if (blink.age < 0) { blink.wait -= elapsed; if (blink.wait <= 0) blink.age = 0; }
    else blink.age += elapsed;
    if (blink.age < 0) return 1;
    if (blink.age >= 150) { blink.age = -1; blink.wait = 1700 + this.unit() * 4400; return 1; }
    return 1 - .93 * Math.sin(Math.PI * blink.age / 150) ** 2;
  }

  advance(elapsedMs: number, options: { paused?: boolean; reducedMotion?: boolean } = {}): GroupPetPose[] {
    if (options.reducedMotion) {
      if (!this.reduced) {
        this.poses = this.poses.map(pose => rest(pose.x)); this.plan = this.makePlan('rest', 650); this.reduced = true;
        this.blinks.forEach((blink, index) => { blink.age = -1; blink.wait = 2200 + index * 350; });
      }
      return this.poses.map(pose => ({ ...pose }));
    }
    this.reduced = false;
    if (options.paused) return this.poses.map(pose => ({ ...pose }));
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(40, elapsedMs)) : 0;
    const plan = this.plan;
    plan.age = Math.min(plan.duration, plan.age + elapsed);
    const t = plan.age / plan.duration;
    this.poses = this.poses.map((_, i) => {
      let move = plan.kind === 'meet' ? t / .32 : t;
      if (plan.kind === 'yield') {
        // Whoever is ahead steps first. Equal translations with ordered easing
        // can only increase a gap, never collide with the pet behind.
        const order = plan.direction > 0 ? this.count - 1 - i : i;
        move = (t - order * .09) / .57;
      }
      const progress = Math.max(0, Math.min(1, move)), x = plan.from[i] + (plan.to[i] - plan.from[i]) * smooth(progress);
      const pose = rest(x), distance = plan.to[i] - plan.from[i], direction = Math.sign(distance);
      if (Math.abs(distance) > .01 && progress > 0 && progress < 1) {
        const energy = Math.sin(Math.PI * progress), stride = Math.sin(Math.abs(x - plan.from[i]) * Math.PI * 2 / 7);
        pose.activity = 'walk'; pose.y = -.55 * Math.abs(stride) * energy;
        pose.lean = direction * 1.8 * energy; pose.gazeX = direction * .9 * energy;
        pose.leftFootX = stride * energy; pose.rightFootX = -pose.leftFootX;
        pose.leftFootY = -Math.max(0, stride) * energy; pose.rightFootY = -Math.max(0, -stride) * energy;
      }
      const isPair = i === plan.leader || i === plan.partner;
      if (plan.kind === 'meet' && isPair) {
        const other = i === plan.leader ? plan.partner : plan.leader, direction = Math.sign(other - i);
        const attention = smooth((t - .18) / .18) * (1 - smooth((t - .85) / .15));
        pose.partner = other; pose.interaction = i === plan.leader ? 'greet' : 'reply';
        pose.gazeX = direction * 1.35 * attention; pose.lean += direction * 1.8 * attention;
        const hop = i === plan.leader ? pulse(t, .36, .57) : pulse(t, .62, .85);
        pose.lift = -2.8 * hop * this.personality(i).playfulness;
        pose.scaleY = 1 + .025 * hop; pose.gazeY = -.4 * hop;
        if (hop > 0) pose.activity = 'hop'; else if (attention > .2 && progress >= 1) pose.activity = 'look';
      } else if (plan.kind === 'yield' && isPair) {
        const attention = pulse(t, .08, .94);
        pose.interaction = 'yield'; pose.partner = i === plan.leader ? plan.partner : plan.leader;
        pose.gazeX = Math.sign(pose.partner - i) * attention;
        pose.lean += (i === plan.partner ? -plan.direction : plan.direction) * .8 * attention;
      } else if (plan.kind === 'solo' && i === plan.leader) {
        const envelope = Math.sin(Math.PI * t) ** 2;
        if (plan.gesture < .35) { pose.activity = 'hop'; pose.lift = -2.4 * pulse(t, .18, .83) * this.personality(i).playfulness; }
        else if (plan.gesture < .68) { pose.activity = 'stretch'; pose.scaleX = 1 - .035 * envelope; pose.scaleY = 1 + .08 * envelope; pose.gazeY = -.5 * envelope; }
        else { pose.activity = 'wiggle'; pose.lean = Math.sin(t * Math.PI * 4) * envelope * 3; pose.gazeX = -pose.lean * .18; }
      }
      pose.eyeOpen = this.blink(i, elapsed);
      return pose;
    });
    if (plan.age === plan.duration) this.next();
    return this.poses.map(pose => ({ ...pose }));
  }
}
