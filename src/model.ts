import { DEFAULT_ISLAND_PETS, PET_CATALOG, normalizeIslandPets, type PetId } from "./petCatalog";

export interface Capture {
  id: string;
  name: string;
  path: string;
  thumbnail: string;
  kind: "image" | "video";
  width: number;
  height: number;
  createdAt: number;
  source: string;
  pinned: boolean;
  shelfHidden: boolean;
}
export interface Settings {
  captureShortcut: string;
  pasteShortcut: string;
  shelfShortcut: string;
  hideWindowsOnCapture: boolean;
  watchClipboard: boolean;
  watchFolders: string[];
  edgeReveal: boolean;
  peekOnCapture: boolean;
  shelfShakeToDismiss: boolean;
  shelfHoverPreview: boolean;
  shelfHoverDelayMs: number;
  islandPets: PetId[];
  islandPetInteractions: boolean;
  startAtLogin: boolean;
  pinDoubleClickAction: "close" | "collapse" | "none";
  shelfAnchor: { monitor: string | null; ratio: number };
  theme: "system" | "light" | "dark";
  maxItems: number;
}
export interface AppSnapshot {
  items: Capture[];
  settings: Settings;
  storagePath: string;
}
export const defaultSettings: Settings = {
  captureShortcut: "F1",
  pasteShortcut: "F3",
  shelfShortcut: "Control+Alt+T",
  hideWindowsOnCapture: false,
  watchClipboard: false,
  watchFolders: [],
  edgeReveal: true,
  peekOnCapture: true,
  shelfShakeToDismiss: true,
  shelfHoverPreview: true,
  shelfHoverDelayMs: 1000,
  islandPets: [...DEFAULT_ISLAND_PETS],
  islandPetInteractions: true,
  startAtLogin: false,
  pinDoubleClickAction: "close",
  shelfAnchor: { monitor: null, ratio: 0.5 },
  theme: "system",
  maxItems: 200,
};

/** Keep the user's existing order when changing the number of island residents. */
export function islandPetsForCount(input: unknown, count: 1 | 2 | 3): PetId[] {
  const pets = normalizeIslandPets(input).slice(0, count);
  for (const pet of PET_CATALOG) {
    if (pets.length >= count) break;
    if (!pets.includes(pet.id)) pets.push(pet.id);
  }
  return pets;
}

/** A character can occupy only one slot; rejecting a duplicate preserves order. */
export function replaceIslandPet(input: unknown, slot: number, id: PetId): PetId[] {
  const pets = normalizeIslandPets(input);
  if (!Number.isInteger(slot) || slot < 0 || slot >= pets.length
    || pets.some((pet, index) => index !== slot && pet === id)) return pets;
  return pets.map((pet, index) => index === slot ? id : pet);
}
/** Shelf dismissal is independent of library membership and favorites. */
export function shelfItems(items: Capture[]): Capture[] {
  return items.filter(item => !item.shelfHidden);
}
export function selectItems(
  items: Capture[],
  query: string,
  pinned: boolean,
  kind: string,
): Capture[] {
  const term = query.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        (!pinned || item.pinned) &&
        (kind === "all" || item.kind === kind) &&
        (!term ||
          `${item.name} ${item.source}`.toLocaleLowerCase().includes(term)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}
export function dayLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp),
    today = new Date(now);
  if (date.toDateString() === today.toDateString()) return "今天";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}
export const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
