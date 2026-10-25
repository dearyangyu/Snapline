import { getSpriteAsset, isSpritePetId, SPRITE_ASSETS, type SpriteAssetMap } from './spritePetCatalog';

/** Island companions; silhouettes and names remain distinct without color. */
export const PET_DEFINITIONS = [
  { id: 'mallow', name: '团团', temperament: '温和爱散步', description: '暖瓷色的小团子，头顶一撮软毛', colors: { highlight: '#fffdf4', base: '#eee8da', shade: '#aaa28f', cheek: '#d4a38c', ink: '#38352e' }, personality: { speed: 1, curiosity: 1, playfulness: 1 } },
  { id: 'mint', name: '芽芽', temperament: '慢热又好奇', description: '顶着新芽的青绿色小梨', colors: { highlight: '#e1ffe1', base: '#8bdaa5', shade: '#3b9673', cheek: '#e5b89f', ink: '#244c3b' }, personality: { speed: .88, curiosity: 1.2, playfulness: .92 } },
  { id: 'aqua', name: '泡泡', temperament: '轻快爱蹦跳', description: '清透蓝色的小水滴', colors: { highlight: '#e6fbff', base: '#7dd5ec', shade: '#368cbb', cheek: '#b4b3e4', ink: '#20475e' }, personality: { speed: 1.12, curiosity: 1.1, playfulness: 1.16 } },
  { id: 'ember', name: '啾啾', temperament: '活泼爱凑热闹', description: '珊瑚色的小鸟，带一对短翅膀', colors: { highlight: '#ffe6d8', base: '#ee9b85', shade: '#bb5f54', cheek: '#e66e65', ink: '#613832' }, personality: { speed: 1.2, curiosity: 1.15, playfulness: 1.25 } },
  { id: 'violet', name: '星星', temperament: '安静爱观察', description: '圆角五角星，泛着淡紫色光泽', colors: { highlight: '#f5e9ff', base: '#bc9ae8', shade: '#7961ac', cheek: '#e7a7cc', ink: '#493961' }, personality: { speed: .9, curiosity: 1.2, playfulness: 1.08 } },
  { id: 'peach', name: '布丁', temperament: '慢悠悠不着急', description: '有焦糖小帽的琥珀色布丁', colors: { highlight: '#fff2cf', base: '#edc078', shade: '#b78648', cheek: '#df936a', ink: '#654827' }, personality: { speed: .82, curiosity: .9, playfulness: .85 } },
  { id: 'ice', name: '方方', temperament: '认真又好奇', description: '冰蓝色的圆角小机器人', colors: { highlight: '#eaf7ff', base: '#a3cce7', shade: '#658fae', cheek: '#b6cde9', ink: '#365069' }, personality: { speed: 1.02, curiosity: 1.25, playfulness: .88 } },
  { id: 'rose', name: '绵绵', temperament: '轻巧爱互动', description: '柔粉色的长耳小兔子', colors: { highlight: '#fff1f1', base: '#edb3c5', shade: '#be829d', cheek: '#d980a2', ink: '#644152' }, personality: { speed: 1.08, curiosity: 1.08, playfulness: 1.2 } },
  { id: 'gugu', name: '咕咕嘎嘎', temperament: '呆萌又爱闹', description: '企鹅服造型：黄嘴帽、短黑刘海和奶白脸', colors: { highlight: '#999ba2', base: '#44464d', shade: '#202228', cheek: '#dba9a0', ink: '#5a5b63' }, personality: { speed: .92, curiosity: 1.08, playfulness: 1.15 } },
  { id: 'deepseek', name: 'DeepSeek', temperament: '温柔又好奇', description: '蓝色长卷发、鲸鱼尾饰与白色女仆围裙', colors: { highlight: '#b1e4ff', base: '#5375bb', shade: '#273963', cheek: '#e8a9b8', ink: '#263654' }, personality: { speed: .9, curiosity: 1.25, playfulness: 1.03 } },
  { id: 'claude', name: 'Claude', temperament: '明快爱招呼', description: '橙色长发、太阳花发饰与黑白橙色裙装', colors: { highlight: '#ffe0ae', base: '#e69a55', shade: '#955126', cheek: '#e8a18e', ink: '#553423' }, personality: { speed: 1.08, curiosity: 1.1, playfulness: 1.2 } },
  { id: 'chatgpt', name: 'ChatGPT · Luna', temperament: '安静爱观察', description: '原素材中的 Luna：银白长发与白蓝外套', colors: { highlight: '#ffffff', base: '#d6d3e7', shade: '#8c83af', cheek: '#e7b0bd', ink: '#55456b' }, personality: { speed: .88, curiosity: 1.2, playfulness: .94 } },
] as const;

export type PetId = typeof PET_DEFINITIONS[number]['id'];
export const DEFAULT_ISLAND_PETS: PetId[] = ['mallow'];
export function availablePetCatalog(assets: SpriteAssetMap = SPRITE_ASSETS) {
  return PET_DEFINITIONS.filter(pet => !isSpritePetId(pet.id) || Boolean(getSpriteAsset(pet.id, assets)));
}
export const PET_CATALOG = availablePetCatalog();

/** Rendering fallback only: this function neither mutates nor persists input. */
export function normalizeIslandPets(input: unknown, catalog: readonly { id: PetId }[] = PET_CATALOG): PetId[] {
  if (!Array.isArray(input)) return [...DEFAULT_ISLAND_PETS];
  const recognized = new Set<string>(catalog.map(pet => pet.id));
  const pets: PetId[] = [];
  for (const id of input) {
    if (typeof id === 'string' && recognized.has(id) && !pets.includes(id as PetId)) pets.push(id as PetId);
    if (pets.length === 3) break;
  }
  return pets.length ? pets : [...DEFAULT_ISLAND_PETS];
}
