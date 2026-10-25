export const ISLAND_PERIMETER = 252 + 2 * Math.PI * 20.6;
export const wrapPhase = (value: number) => ((value % ISLAND_PERIMETER) + ISLAND_PERIMETER) % ISLAND_PERIMETER;
export interface IslandLightState {
  owner: number; revision: number; at: number; phase: number; travel: number;
  velocity: number; brightness: number; active: boolean; playing: boolean;
}

/** Both WebViews evaluate the same shared wall-clock ledger. Integrating the
 * preview's 230ms exponential easing analytically avoids frame-rate drift. */
export function lightAt(state: IslandLightState, now: number) {
  if (!state.playing) return { phase: state.phase, travel: state.travel, velocity: state.velocity, brightness: state.brightness };
  const seconds = Math.max(0, now - state.at) / 1000, tau = .23;
  const decay = Math.exp(-seconds / tau), targetSpeed = state.active ? 2.6 : 1;
  const travel = state.travel + ISLAND_PERIMETER / 16 * (targetSpeed * seconds + (state.velocity - targetSpeed) * tau * (1 - decay));
  return {
    phase: wrapPhase(travel), travel,
    velocity: targetSpeed + (state.velocity - targetSpeed) * decay,
    brightness: (state.active ? 1.32 : 1) + (state.brightness - (state.active ? 1.32 : 1)) * decay,
  };
}

export class IslandRimMotion {
  state: IslandLightState;
  constructor(now: number) {
    this.state = { owner: now, revision: 0, at: now, phase: 26, travel: 26, velocity: 1, brightness: 1, active: false, playing: false };
  }
  update(active: boolean, playing: boolean, now: number) {
    if (active === this.state.active && playing === this.state.playing) return false;
    const pose = lightAt(this.state, now);
    this.state = {
      ...this.state, ...pose, revision: this.state.revision + 1, at: now, active, playing,
    };
    return true;
  }
}

export function newerLightState(next: IslandLightState, previous: IslandLightState | null) {
  return [next.owner, next.revision, next.at, next.phase, next.travel, next.velocity, next.brightness].every(Number.isFinite)
    && typeof next.active === 'boolean' && typeof next.playing === 'boolean'
    && (!previous || next.owner > previous.owner || (next.owner === previous.owner && next.revision >= previous.revision));
}
