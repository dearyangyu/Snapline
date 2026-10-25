import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SpritePet, paintSpritePet } from './SpritePet';
import { SPRITE_ACTIONS, SPRITE_PETS, spriteContactY, spriteFrameAt, type SpriteSample } from './spritePetCatalog';
import * as spriteCatalog from './spritePetCatalog';
import { SpritePetIslandMotion, SpritePetRopeMotion, spriteFromPerchIntent } from './spritePetMotion';
import { PerchMotion } from './perchedPetMotion';
import { IslandPetMotion } from './islandPetMotion';
import { IslandPetGroupMotion } from './islandPetGroupMotion';

const resting = { activity: 'rest' as const, x: 0, gazeX: 0 };
function seeded(seed = 123) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

afterEach(() => { vi.restoreAllMocks(); });

describe('optional source sprite playback', () => {
  it('maps a shared mixed-pet intent to complete original clips and the correct source support point', () => {
    expect(spriteFromPerchIntent('deepseek', { action: 'rest', elapsed: 180 })).toEqual({ action: 'waiting', frame: 1, contactY: 173 });
    expect(spriteFromPerchIntent('gugu', { action: 'stretch', elapsed: 60000 })).toEqual({ action: 'idle', frame: 5, contactY: 203 });
    expect(spriteFromPerchIntent('claude', { action: 'wave', elapsed: 249 })).toEqual({ action: 'waving', frame: 0, contactY: 203 });
    expect(spriteFromPerchIntent('claude', { action: 'wave', elapsed: 250 }).frame).toBe(1);
    expect(spriteFromPerchIntent('chatgpt', { action: 'look', elapsed: 180, direction: -1 }).action).toBe('look-left-side');
    expect(spriteFromPerchIntent('chatgpt', { action: 'look', elapsed: 180, direction: 1 }).action).toBe('look-right-side');
    expect(spriteFromPerchIntent('gugu', { action: 'duck', elapsed: 60000, reply: true })).toEqual({ action: 'waving', frame: 3, contactY: 203 });
    expect(spriteFromPerchIntent('deepseek', { action: 'peek', elapsed: 180 }).action).toBe('review');
    const intent = { action: 'wave' as const, elapsed: 350, direction: 1 };
    expect(spriteFromPerchIntent('gugu', intent)).toEqual(spriteFromPerchIntent('gugu', intent));
    expect(intent).toEqual({ action: 'wave', elapsed: 350, direction: 1 });
  });

  it('lets a vector neighbor invite a sprite through the same scheduler, and cancels an unstarted mixed reply', () => {
    const enabled = new PerchMotion(3, 204), disabled = new PerchMotion(3, 204);
    enabled.trigger('wave', 0); disabled.trigger('wave', 0);
    disabled.setInteractions(false);
    let responded = false;
    for (let elapsed = 0; elapsed < 1500; elapsed += 20) {
      enabled.advance(20); disabled.advance(20);
      const resident = enabled.residents[1];
      if (resident.replyTo === 0) {
        const sample = spriteFromPerchIntent('gugu', { action: resident.action, elapsed: enabled.time - resident.start, direction: resident.direction, reply: true });
        expect(['waving', 'look-left-side']).toContain(sample.action);
        expect(enabled.time).toBeGreaterThanOrEqual(440); responded = true;
      }
      expect(disabled.residents[1].replyTo).toBeUndefined();
    }
    expect(responded).toBe(true);
    const resident = enabled.residents[1], intent = { action: resident.action, elapsed: enabled.time - resident.start, direction: resident.direction, reply: resident.replyTo !== undefined };
    const held = spriteFromPerchIntent('gugu', intent);
    enabled.advance(60000, true);
    expect(spriteFromPerchIntent('gugu', { ...intent, elapsed: enabled.time - resident.start })).toEqual(held);
  });
  it('uses exactly the verified GIF cells and original frame periods for every action', () => {
    expect(SPRITE_PETS.map(pet => pet.id)).toEqual(['gugu', 'deepseek', 'claude', 'chatgpt']);
    expect(SPRITE_ACTIONS.map(action => action.frames)).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
    for (const action of SPRITE_ACTIONS) {
      expect(spriteFrameAt(action.id, action.frameMs - 1)).toBe(0);
      expect(spriteFrameAt(action.id, action.frameMs)).toBe(1);
      expect(spriteFrameAt(action.id, 60000)).toBe(action.frames - 1);
      expect(spriteFrameAt(action.id, action.frameMs * action.frames, true)).toBe(0);
      expect(spriteFrameAt(action.id, NaN)).toBe(0);
    }
    expect(spriteFrameAt('idle', 1080)).toBe(5); // Extra nonempty Gugu cell 6 is not part of the clip.
    expect(spriteContactY('deepseek', 'waiting')).toBe(173);
    for (const pet of SPRITE_PETS) expect(spriteContactY(pet.id, 'waving')).toBe(203);
  });

  it('clips all four available source sheets without character redraw or source deformation', () => {
    vi.spyOn(spriteCatalog, 'getSpriteAsset').mockImplementation(id => `/assets/${id}-fixture.webp`);
    for (const pet of SPRITE_PETS) {
      const markup = renderToStaticMarkup(createElement(SpritePet, { petId: pet.id, mode: 'perched', paused: true }));
      expect(markup).toContain(`href="/assets/${pet.id}-fixture.webp"`);
      expect(markup).toContain('viewBox="0 0 192 208"');
      expect(markup).toContain('width="1536" height="2288"');
      expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(markup).toContain(`--sprite-contact-y:${pet.id === 'deepseek' ? 173 : 203}`);
      expect(markup).not.toContain('<path');
    }
  });

  it('renders no broken image when a known sprite is requested without its optional sheet', () => {
    vi.spyOn(spriteCatalog, 'getSpriteAsset').mockReturnValue(undefined);
    for (const pet of SPRITE_PETS) {
      for (const mode of ['standing', 'perched'] as const) {
        expect(renderToStaticMarkup(createElement(SpritePet, { petId: pet.id, mode }))).toBe('');
      }
      // Clip metadata is still usable in a checkout with no artwork.
      expect(spriteFromPerchIntent(pet.id, { action: 'wave', elapsed: 750 })).toEqual({ action: 'waving', frame: 3, contactY: 203 });
    }
  });

  it('keeps a paused paint unchanged and clamps malformed frame indices to a valid source cell', () => {
    const attributes = new Map<string, string>(), properties = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, querySelector: () => ({ setAttribute: (key: string, value: string) => attributes.set(key, value) }), style: { setProperty: (key: string, value: string) => properties.set(key, value) } };
    paintSpritePet(root as unknown as HTMLElement, { action: 'waiting', frame: 99, contactY: 173 });
    expect(attributes.get('x')).toBe('-960'); expect(attributes.get('y')).toBe('-1248');
    expect(properties.get('--sprite-contact-y')).toBe('173');
    root.dataset.spritePaused = 'true';
    paintSpritePet(root as unknown as HTMLElement, { action: 'waving', frame: 0, contactY: 203 });
    expect(attributes.get('x')).toBe('-960'); expect(properties.get('--sprite-contact-y')).toBe('173');
  });

  it('freezes rope frames and pending replies on pause/reduce, resumes without wall-clock fast forward', () => {
    const a = new SpritePetRopeMotion(['gugu', 'deepseek', 'claude'], 14);
    const b = new SpritePetRopeMotion(['gugu', 'deepseek', 'claude'], 14);
    for (let i = 0; i < 500; i++) { a.advance(20); b.advance(20); }
    const held = a.advance(0);
    for (let i = 0; i < 20; i++) { expect(a.advance(60000, true)).toEqual(held); expect(a.advance(60000, false, true)).toEqual(held); }
    expect(a.advance(0)).toEqual(held);
    for (let i = 0; i < 200; i++) expect(a.advance(20)).toEqual(b.advance(20));
    expect(a.advance(60000)).toEqual(b.advance(40));
  });

  it('uses each source resting pose and cancels unstarted neighbor replies when interactions are disabled', () => {
    const stage = new SpritePetRopeMotion(['gugu', 'deepseek', 'claude'], 2);
    expect(stage.advance(0).map(sample => sample.action)).toEqual(['idle', 'waiting', 'idle']);
    let samples: SpriteSample[] = [], found = false;
    for (let elapsed = 0; elapsed < 60000; elapsed += 20) {
      samples = stage.advance(20);
      expect(samples.filter(sample => sample.action === 'waving').length).toBeLessThanOrEqual(2);
      if (samples.filter(sample => sample.action === 'waving').length === 1) { found = true; break; }
    }
    expect(found).toBe(true);
    const initiator = samples.findIndex(sample => sample.action === 'waving');
    stage.setInteractions(false);
    for (let elapsed = 0; elapsed < 20000; elapsed += 20) {
      const next = stage.advance(20);
      next.forEach((sample, index) => { if (index !== initiator || elapsed > 1000) expect(sample.action).not.toBe('waving'); });
    }
  });

  it('uses original directional running, finite gestures, and quiet nonuniform idle repeats on the island', () => {
    const motion = new SpritePetIslandMotion('gugu', 71);
    expect(motion.advance(20, { ...resting, activity: 'walk', x: 1, gazeX: 1 }).action).toBe('running-right');
    expect(motion.advance(20, { ...resting, activity: 'walk', x: -1 }).action).toBe('running-left');
    const frozen = motion.advance(20, { ...resting, activity: 'hop', x: -1, interaction: 'greet' });
    expect(frozen.action).toBe('waving');
    expect(motion.advance(60000, resting, { paused: true })).toEqual(frozen);
    expect(motion.advance(60000, resting, { reducedMotion: true })).toEqual(frozen);
    expect(motion.advance(0, resting)).toEqual(frozen);
    let sample = frozen;
    for (let i = 0; i < 55; i++) sample = motion.advance(20, { ...resting, x: -1 });
    expect(sample.action).toBe('idle');
    const starts: number[] = []; let previous = sample.frame;
    for (let time = 0; time < 45000; time += 20) {
      sample = motion.advance(20, { ...resting, x: -1 });
      if (previous === 5 && sample.frame === 0) starts.push(time);
      previous = sample.frame;
    }
    expect(starts.length).toBeGreaterThan(10);
    expect(new Set(starts.slice(1).map((value, i) => value - starts[i])).size).toBeGreaterThan(4);
  });

  it.each([1, 2, 3])('retains existing %s-pet island positions and delayed greeting cues with only source frames', count => {
    const motion = count === 1 ? new IslandPetMotion(seeded(29)) : null;
    const group = count > 1 ? new IslandPetGroupMotion(count, true, seeded(29)) : null;
    const sprites = Array.from({ length: count }, (_, index) => new SpritePetIslandMotion(SPRITE_PETS[index].id, index));
    const width = count === 1 ? 26 : count === 2 ? 24 : 22;
    const actions = new Set<string>();
    let firstGreeting = -1, delayedGreeting = false;
    const previous = Array.from({ length: count }, () => 'idle');
    for (let elapsed = 0; elapsed < 90000; elapsed += 20) {
      const poses = group ? group.advance(20) : [motion!.advance(20)];
      poses.forEach((pose, index) => {
        expect(Math.abs(pose.x) + width / 2).toBeLessThan(48);
        const sample = sprites[index].advance(20, pose);
        actions.add(sample.action);
        if (sample.action === 'waving' && previous[index] !== 'waving') {
          if (firstGreeting >= 0 && elapsed - firstGreeting > 100 && elapsed - firstGreeting < 1000) delayedGreeting = true;
          firstGreeting = elapsed;
        }
        previous[index] = sample.action;
        expect(Number.isInteger(sample.frame)).toBe(true);
        expect(sample.frame).toBeLessThan(SPRITE_ACTIONS.find(action => action.id === sample.action)!.frames);
      });
    }
    expect(actions.has('running-left')).toBe(true); expect(actions.has('running-right')).toBe(true);
    if (count > 1) { expect(actions.has('waving')).toBe(true); expect(delayedGreeting).toBe(true); }
  });
});
