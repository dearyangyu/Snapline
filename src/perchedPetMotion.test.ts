import { describe, expect, it } from 'vitest';
import { applyPerchedPose, PerchMotion, quietPose, type Action } from './perchedPetMotion';

const advance = (engine: PerchMotion, milliseconds: number) => { for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) engine.advance(20); };

describe('production clothesline pet actions', () => {
  it('varies its first gesture and resident instead of replaying the preview showcase on every reveal', () => {
    const openings = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const engine = new PerchMotion(3, seed); advance(engine, 1400);
      expect(engine.history.length).toBeGreaterThan(0);
      openings.add(`${engine.history[0].index}/${engine.history[0].action}`);
    }
    expect(openings.size).toBeGreaterThan(4);
    const explicitDemo = new PerchMotion(3, 418, { showcase: true }); advance(explicitDemo, 14000);
    expect(explicitDemo.history.filter(event => event.replyTo === undefined).slice(0, 3).map(event => event.action)).toEqual(['peek', 'stretch', 'wave']);
  });

  it('keeps one initiator and at most one delayed reply, with varied spacing and natural cooldowns', () => {
    const engine = new PerchMotion(3, 91);
    for (let elapsed = 0; elapsed < 120000; elapsed += 20) {
      engine.advance(20);
      const active = engine.residents.filter(resident => resident.action !== 'rest');
      expect(active.length).toBeLessThanOrEqual(2);
      expect(active.filter(resident => resident.replyTo === undefined).length).toBeLessThanOrEqual(1);
    }
    const previous = new Map<string, number>();
    for (const event of engine.history) {
      const key = `${event.index}/${event.action}`;
      if (previous.has(key)) expect(event.at - previous.get(key)!).toBeGreaterThan(5500);
      previous.set(key, event.at);
      if (event.replyTo !== undefined) {
        const invitation = engine.history.filter(other => other.index === event.replyTo && other.action === 'wave' && other.at < event.at).at(-1)!;
        expect(event.at - invitation.at).toBeGreaterThanOrEqual(440);
      }
    }
    expect(engine.history.some(event => event.replyTo !== undefined)).toBe(true);
    const starts = engine.history.filter(event => event.replyTo === undefined).map(event => event.at);
    expect(new Set(starts.slice(1).map((at, index) => Math.round((at - starts[index]) / 100))).size).toBeGreaterThan(8);
    expect(new Set(engine.history.map(event => event.action)).size).toBe(5);
  });

  it('freezes current poses and pending response time through holds, hidden close and immediate reopen', () => {
    const engine = new PerchMotion(3, 8); engine.trigger('wave'); advance(engine, 220);
    const time = engine.time, pose = engine.sample(), history = [...engine.history];
    for (let i = 0; i < 10; i++) expect(engine.advance(60000, true)).toEqual(pose);
    expect(engine.time).toBe(time); expect(engine.history).toEqual(history);
    expect(engine.advance(0)).toEqual(pose);
    advance(engine, 1400);
    expect(engine.history.some(event => event.replyTo === 0)).toBe(true);
    const beforeGap = engine.time; engine.advance(60000); expect(engine.time - beforeGap).toBe(40);
  });

  it('stays quiet under reduced motion and resumes smoothly without resurrecting a raised pose or pending reply', () => {
    const engine = new PerchMotion(3, 5); engine.trigger('stretch'); advance(engine, 700);
    const time = engine.time;
    for (let i = 0; i < 20; i++) {
      expect(engine.advance(10000, false, true).map(frame => frame.pose)).toEqual([quietPose(), quietPose(), quietPose()]);
    }
    expect(engine.time).toBe(time);
    expect(engine.advance(60000).map(frame => frame.pose)).toEqual([quietPose(), quietPose(), quietPose()]);
    expect(engine.time).toBe(time);
    const resumed = engine.advance(20);
    expect(resumed.every(frame => Math.abs(frame.pose.headY) < .01 && frame.pose.leftY === 0 && frame.pose.rightY === 0)).toBe(true);
    const invitation = new PerchMotion(3, 6); invitation.trigger('wave'); advance(invitation, 200);
    invitation.advance(0, false, true); invitation.advance(0); advance(invitation, 600);
    expect(invitation.history.some(event => event.replyTo !== undefined)).toBe(false);
  });

  it('cancels pending responses when interaction is disabled and can enable future responses again', () => {
    const engine = new PerchMotion(3, 5); engine.trigger('wave'); engine.setInteractions(false); advance(engine, 14000);
    expect(engine.history.some(event => event.replyTo !== undefined)).toBe(false);
    engine.setInteractions(true); engine.trigger('wave'); advance(engine, 1800);
    expect(engine.history.some(event => event.replyTo === 0 && event.at > 14000)).toBe(true);
  });

  it('keeps action transitions continuous and at least one paw supporting the body', () => {
    const engine = new PerchMotion(1, 54); advance(engine, 1400);
    for (const action of ['peek', 'look', 'stretch', 'wave', 'duck'] as Exclude<Action, 'rest'>[]) {
      const before = engine.sample()[0].pose; engine.trigger(action);
      expect(engine.sample()[0].pose).toEqual(before);
      for (let elapsed = 0; elapsed < 2500; elapsed += 20) {
        const pose = engine.advance(20)[0].pose;
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(Math.abs(pose.headX)).toBeLessThan(1.5); expect(Math.abs(pose.headY)).toBeLessThan(3);
        expect(pose.eyes).toBeGreaterThanOrEqual(0); expect(pose.eyes).toBeLessThanOrEqual(1);
        expect(Math.min(Math.abs(pose.leftY), Math.abs(pose.rightY))).toBeLessThan(.001);
      }
    }
    for (let seed = 1; seed <= 8; seed++) {
      const repeated = new PerchMotion(1, seed); repeated.trigger('wave'); advance(repeated, 600); repeated.trigger('wave');
      for (let elapsed = 0; elapsed < 500; elapsed += 20) {
        const pose = repeated.advance(20)[0].pose;
        expect(Math.min(Math.abs(pose.leftY), Math.abs(pose.rightY))).toBeLessThan(.001);
      }
    }
  });

  it('writes inherited pose without taking over attachment position or the rope tangent', () => {
    const values = new Map([['transform', 'translate(500px, 35px) rotate(4deg) scale(1.5)'], ['left', '0px'], ['top', '0px']]);
    const originalGeometry = new Map(values);
    const element = { style: { setProperty(name: string, value: string) { values.set(name, value); } } };
    const engine = new PerchMotion(3, 21); engine.trigger('wave'); advance(engine, 800);
    applyPerchedPose(element, engine.sample()[0].pose);
    for (const [name, value] of originalGeometry) expect(values.get(name)).toBe(value);
    expect([...values.keys()].filter(name => !originalGeometry.has(name)).every(name => name.startsWith('--candidate-'))).toBe(true);
    expect([...values.values()].every(value => !value.includes('NaN') && !value.includes('Infinity'))).toBe(true);
  });
});
