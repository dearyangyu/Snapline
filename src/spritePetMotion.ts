import type { PetPose } from './islandPetMotion';
import type { Action as PerchAction } from './perchedPetMotion';
import { getSpritePet, spriteDuration, spriteSample, type SpriteActionId, type SpritePetId, type SpriteSample } from './spritePetCatalog';

export interface SpritePerchIntent { action: PerchAction; elapsed: number; direction?: number; reply?: boolean }
/** Translate the shared all-pet scheduler's intent into existing source art.
 * This is a pure sample: the rope owner supplies time, pauses and reply order.
 * A clip plays at its original FPS and holds its last frame until the next
 * intent. No made-up prone/stretch/deformation frames are introduced. */
export function spriteFromPerchIntent(id: SpritePetId, intent: SpritePerchIntent): SpriteSample {
  let action: SpriteActionId = getSpritePet(id).resting;
  if (intent.action === 'wave' || intent.action === 'duck' && intent.reply) action = 'waving';
  else if (intent.action === 'look') action = (intent.direction ?? 1) < 0 ? 'look-left-side' : 'look-right-side';
  else if (intent.action === 'peek' || intent.action === 'duck') action = 'review';
  return spriteSample(id, action, intent.elapsed);
}

const delta = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(40, value)) : 0;
function random(seed: number) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
interface RopeResident { action: SpriteActionId; started: number; active: boolean }

/** Source frame clips plus quiet intervals, driven by the rope's existing
 * clock. No timer, RAF, frame interpolation, or geometric body animation. */
export class SpritePetRopeMotion {
  private time = 0;
  private residents: RopeResident[];
  private rng: () => number;
  private nextAt: number;
  private pending: { target: number; at: number } | null = null;
  private interactions = true;
  private last = -1;
  constructor(private ids: readonly SpritePetId[], seed = Math.floor(Math.random() * 0xffffffff)) {
    this.rng = random(seed);
    this.residents = ids.map((id, index) => ({ action: getSpritePet(id).resting, started: index * 95, active: true }));
    this.nextAt = 1800 + this.rng() * 1300;
  }
  setInteractions(enabled: boolean) { this.interactions = enabled; if (!enabled) this.pending = null; }
  private start(index: number, action: SpriteActionId) { this.residents[index] = { action, started: this.time, active: true }; }
  advance(elapsedMs: number, paused = false, reducedMotion = false): SpriteSample[] {
    if (!paused && !reducedMotion) {
      this.time += delta(elapsedMs);
      this.residents.forEach((resident, index) => {
        if (resident.active && this.time - resident.started >= spriteDuration(resident.action)) {
          resident.action = getSpritePet(this.ids[index]).resting;
          resident.started = this.time - spriteDuration(resident.action);
          resident.active = false;
          this.nextAt = this.time + 1200 + this.rng() * 1300;
        }
      });
      if (this.pending && this.pending.at <= this.time && !this.residents[this.pending.target].active) {
        this.start(this.pending.target, 'waving'); this.pending = null;
      }
      if (this.time >= this.nextAt && !this.pending && !this.residents.some(resident => resident.active) && this.ids.length) {
        const candidates = this.ids.map((_, index) => index).filter(index => index !== this.last || this.ids.length === 1);
        const index = candidates[Math.floor(this.rng() * candidates.length)]; this.last = index;
        const wave = this.interactions && this.ids.length > 1 && this.rng() < .46;
        this.start(index, wave ? 'waving' : getSpritePet(this.ids[index]).resting);
        if (wave) {
          const target = index === 0 ? 1 : index === this.ids.length - 1 ? index - 1 : this.rng() < .5 ? index - 1 : index + 1;
          this.pending = { target, at: this.time + 430 + this.rng() * 540 };
        }
      }
    }
    return this.residents.map((resident, i) => spriteSample(this.ids[i], resident.action, this.time - resident.started));
  }
}

type IslandSourcePose = Pick<PetPose, 'x' | 'gazeX' | 'activity'> & { interaction?: 'none' | 'greet' | 'reply' | 'yield' };
/** Follows the existing island positions but replaces squash/foot transforms
 * with the artist's actual left/right walk, idle, greeting and jump clips. */
export class SpritePetIslandMotion {
  private time = 0;
  private action: SpriteActionId = 'idle';
  private started = 0;
  private idleNext: number;
  private previousX: number | undefined;
  private direction = 1;
  private greetingSeen = false;
  private hopSeen = false;
  private rng: () => number;
  constructor(private id: SpritePetId, seed = Math.floor(Math.random() * 0xffffffff)) {
    this.rng = random(seed); this.idleNext = spriteDuration('idle') + 1200 + this.rng() * 1300;
  }
  private change(action: SpriteActionId) {
    if (action === this.action) return;
    this.action = action; this.started = this.time;
    if (action === 'idle') this.idleNext = this.time + spriteDuration('idle') + 1200 + this.rng() * 1300;
  }
  advance(elapsedMs: number, pose: IslandSourcePose, options: { paused?: boolean; reducedMotion?: boolean; interactions?: boolean } = {}): SpriteSample {
    if (options.paused || options.reducedMotion) return this.sample();
    const elapsed = delta(elapsedMs);
    if (!elapsed) return this.sample();
    this.time += elapsed;
    const distance = this.previousX === undefined ? 0 : pose.x - this.previousX;
    if (Math.abs(distance) > .00001) this.direction = Math.sign(distance);
    else if (this.previousX === undefined && pose.gazeX) this.direction = Math.sign(pose.gazeX);
    this.previousX = pose.x;
    const greeting = options.interactions !== false && (pose.interaction === 'greet' || pose.interaction === 'reply');
    if (!greeting) this.greetingSeen = false;
    if (pose.activity !== 'hop') this.hopSeen = false;
    const walking = pose.activity === 'walk' || Math.abs(distance) > .025;
    if (walking) this.change(this.direction < 0 ? 'running-left' : 'running-right');
    // The shared formation marks the leader's and neighbor's hop at different
    // times. Use that cue rather than their simultaneous attention phase.
    else if (greeting && pose.activity === 'hop' && !this.greetingSeen) { this.greetingSeen = true; this.change('waving'); }
    else if (!greeting && pose.activity === 'hop' && !this.hopSeen) { this.hopSeen = true; this.change('jumping'); }
    else if ((this.action !== 'waving' && this.action !== 'jumping') || this.time - this.started >= spriteDuration(this.action)) this.change('idle');
    if (this.action === 'idle' && this.time >= this.idleNext) {
      this.started = this.time; this.idleNext = this.time + spriteDuration('idle') + 1200 + this.rng() * 1300;
    }
    return this.sample();
  }
  private sample() { return spriteSample(this.id, this.action, this.time - this.started, this.action === 'running-left' || this.action === 'running-right'); }
}
