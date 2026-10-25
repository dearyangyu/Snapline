/// <reference types="vite/client" />

export const SPRITE_CELL = { width: 192, height: 208, columns: 8, rows: 11 } as const;
export const SPRITE_ACTIONS = [
  { id: 'idle', row: 0, frames: 6, frameMs: 180 },
  { id: 'running-right', row: 1, frames: 8, frameMs: 180 },
  { id: 'running-left', row: 2, frames: 8, frameMs: 180 },
  { id: 'waving', row: 3, frames: 4, frameMs: 250 },
  { id: 'jumping', row: 4, frames: 5, frameMs: 200 },
  { id: 'failed', row: 5, frames: 8, frameMs: 180 },
  { id: 'waiting', row: 6, frames: 6, frameMs: 180 },
  { id: 'running', row: 7, frames: 6, frameMs: 180 },
  { id: 'review', row: 8, frames: 6, frameMs: 180 },
  { id: 'look-right-side', row: 9, frames: 8, frameMs: 180 },
  { id: 'look-left-side', row: 10, frames: 8, frameMs: 180 },
] as const;
export type SpriteActionId = typeof SPRITE_ACTIONS[number]['id'];
export type SpriteAction = typeof SPRITE_ACTIONS[number];
export const SPRITE_PETS = [
  { id: 'gugu', resting: 'idle' },
  { id: 'deepseek', resting: 'waiting' },
  { id: 'claude', resting: 'idle' },
  { id: 'chatgpt', resting: 'idle' },
] as const;
export type SpritePetId = typeof SPRITE_PETS[number]['id'];
export type SpriteAssetMap = Readonly<Partial<Record<SpritePetId, string>>>;
/** Metadata stays available for saved settings and motion tests, independently
 * of optional user-provided artwork. Missing artwork is omitted at build time. */
export function resolveSpriteAssets(modules: Readonly<Record<string, unknown>>): SpriteAssetMap {
  const assets: Partial<Record<SpritePetId, string>> = {};
  for (const pet of SPRITE_PETS) {
    const source = modules[`./assets/pets/${pet.id}.webp`];
    if (typeof source === 'string' && source.trim()) assets[pet.id] = source;
  }
  return assets;
}
export const SPRITE_ASSETS = resolveSpriteAssets(import.meta.glob<string>(
  './assets/pets/{gugu,deepseek,claude,chatgpt}.webp',
  { eager: true, query: '?url', import: 'default' },
));
export function getSpriteAsset(id: SpritePetId, assets: SpriteAssetMap = SPRITE_ASSETS): string | undefined { return assets[id]; }
export interface SpriteSample { action: SpriteActionId; frame: number; contactY: number }
export function isSpritePetId(id: unknown): id is SpritePetId { return SPRITE_PETS.some(pet => pet.id === id); }
export function getSpritePet(id: SpritePetId) { return SPRITE_PETS.find(pet => pet.id === id)!; }
export function spriteAction(id: SpriteActionId): SpriteAction { return SPRITE_ACTIONS.find(action => action.id === id)!; }
export function spriteDuration(id: SpriteActionId) { const action = spriteAction(id); return action.frames * action.frameMs; }
/** GIF frame counts, not the number of nonempty sheet cells. Gugu idle's extra
 * cell is deliberately excluded. No intermediate poses are synthesized. */
export function spriteFrameAt(id: SpriteActionId, elapsedMs: number, loop = false) {
  const action = spriteAction(id), duration = spriteDuration(id);
  let elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (loop) elapsed %= duration;
  return Math.min(action.frames - 1, Math.floor(elapsed / action.frameMs));
}
/** DeepSeek alone has a prone waiting pose. The other assets retain their
 * complete standing/chair/table pixels and their original foot support. */
export function spriteContactY(id: SpritePetId, action: SpriteActionId) { return id === 'deepseek' && action === 'waiting' ? 173 : 203; }
export function spriteSample(id: SpritePetId, action: SpriteActionId, elapsed: number, loop = false): SpriteSample {
  return { action, frame: spriteFrameAt(action, elapsed, loop), contactY: spriteContactY(id, action) };
}
