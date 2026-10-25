/// <reference types="vite/client" />
import nativeLibrarySource from '../src-tauri/src/library.rs?raw';
import { describe, it, expect } from 'vitest';
import { PET_CATALOG, PET_DEFINITIONS, availablePetCatalog, normalizeIslandPets, DEFAULT_ISLAND_PETS } from './petCatalog';
import { SPRITE_ASSETS, SPRITE_PETS, resolveSpriteAssets } from './spritePetCatalog';

const builtinIds = ['mallow', 'mint', 'aqua', 'ember', 'violet', 'peach', 'ice', 'rose'];
const allAssets = resolveSpriteAssets(Object.fromEntries(SPRITE_PETS.map(pet => [`./assets/pets/${pet.id}.webp`, `/assets/${pet.id}.webp`])));

describe('optional companion selection contract', () => {
  it('retains all known IDs in the native whitelist independently of available artwork', () => {
    const declaration = nativeLibrarySource.match(/ISLAND_PET_IDS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
    const ids = [...declaration.matchAll(/"([a-z]+)"/g)].map(match => match[1]);
    expect(ids).toEqual(PET_DEFINITIONS.map(pet => pet.id));
    expect(ids).toHaveLength(12);
    expect(DEFAULT_ISLAND_PETS).toEqual(['mallow']);
    expect(PET_CATALOG).toEqual(availablePetCatalog(SPRITE_ASSETS));
  });

  it('offers eight built-in characters without files and falls back in memory without changing saved choices', () => {
    const catalog = availablePetCatalog({});
    expect(catalog.map(pet => pet.id)).toEqual(builtinIds);
    const saved = ['gugu', 'deepseek', 'chatgpt'];
    expect(normalizeIslandPets(saved, catalog)).toEqual(['mallow']);
    expect(normalizeIslandPets(['gugu', 'rose', 'rose', 'mint'], catalog)).toEqual(['rose', 'mint']);
    expect(saved).toEqual(['gugu', 'deepseek', 'chatgpt']);
  });

  it('retains all twelve local choices, order and de-duplication when the four source sheets are present', () => {
    const catalog = availablePetCatalog(allAssets);
    expect(catalog.map(pet => pet.id)).toEqual(PET_DEFINITIONS.map(pet => pet.id));
    expect(catalog).toHaveLength(12);
    expect(normalizeIslandPets(['unknown', 'chatgpt', 'chatgpt', 'gugu', 'deepseek', 'claude'], catalog)).toEqual(['chatgpt', 'gugu', 'deepseek']);
    expect(normalizeIslandPets(['gugu', 'rose'], catalog)).toEqual(['gugu', 'rose']);
  });

  it('allows a partial local asset set while rejecting unrelated files and invalid module values', () => {
    const assets = resolveSpriteAssets({
      './assets/pets/gugu.webp': '/assets/gugu-local.webp',
      './assets/pets/deepseek.webp': '',
      './assets/pets/claude.webp': { default: '/assets/not-a-url.webp' },
      './assets/pets/unknown.webp': '/assets/unknown.webp',
      '../Downloads/chatgpt.webp': '/assets/wrong-location.webp',
    });
    expect(assets).toEqual({ gugu: '/assets/gugu-local.webp' });
    const catalog = availablePetCatalog(assets);
    expect(catalog.map(pet => pet.id)).toEqual([...builtinIds, 'gugu']);
    expect(normalizeIslandPets(['gugu', 'deepseek'], catalog)).toEqual(['gugu']);
  });
});
