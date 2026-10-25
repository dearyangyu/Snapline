import { describe, expect, it } from "vitest";
import { dayLabel, defaultSettings, islandPetsForCount, replaceIslandPet, selectItems, shelfItems, type Capture } from "./model";
const make = (id: string, options: Partial<Capture> = {}): Capture => ({
  id,
  name: "Screenshot.png",
  path: "C:/library/a.png",
  thumbnail: "",
  kind: "image",
  width: 100,
  height: 100,
  createdAt: 100,
  source: "clipboard",
  pinned: false,
  shelfHidden: false,
  ...options,
});
describe("library selection", () => {
  it("combines pinned, type and case-insensitive search without changing stored order", () => {
    const items = [
      make("a", { pinned: true, createdAt: 10 }),
      make("b", {
        pinned: true,
        kind: "video",
        name: "Screenshot.mp4",
        createdAt: 20,
      }),
      make("c", { createdAt: 30 }),
    ];
    expect(
      selectItems(items, " SCREENSHOT ", true, "image").map((item) => item.id),
    ).toEqual(["a"]);
    expect(selectItems(items, "", false, "all").map((item) => item.id)).toEqual(
      ["c", "b", "a"],
    );
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
  it("finds items by source and handles an empty library", () => {
    expect(selectItems([make("a")], "clipboard", false, "all")).toHaveLength(1);
    expect(selectItems([], "", true, "all")).toEqual([]);
  });
  it("groups by local calendar day across a month boundary", () => {
    const now = new Date(2026, 9, 1, 0, 1).getTime();
    expect(dayLabel(new Date(2026, 9, 1, 0, 0).getTime(), now)).toBe("今天");
    expect(dayLabel(new Date(2026, 8, 30, 23, 59).getTime(), now)).toBe("昨天");
    expect(dayLabel(new Date(2026, 8, 29).getTime(), now)).not.toBe("昨天");
  });
});

it("shelf dismissal keeps the full library, favorite status and source intact and can be restored", () => {
  const kept = make("kept"), hidden = make("hidden", { shelfHidden: true, pinned: true });
  const items = [kept, hidden];
  expect(shelfItems(items).map(item => item.id)).toEqual(["kept"]);
  expect(selectItems(items, "", false, "all")).toHaveLength(2);
  expect(selectItems(items, "", true, "all")).toEqual([hidden]);
  const restored = items.map(item => item.id === "hidden" ? { ...item, shelfHidden: false } : item);
  expect(shelfItems(restored)).toHaveLength(2);
  expect(restored[1].path).toBe(hidden.path);
  expect(restored[1].pinned).toBe(true);
  expect(hidden.shelfHidden).toBe(true);
});

describe('island resident settings', () => {
  it('changes the count without replacing existing choices or mutating input', () => {
    const original = ['rose', 'mint'];
    expect(islandPetsForCount(original, 1)).toEqual(['rose']);
    expect(islandPetsForCount(original, 3)).toEqual(['rose', 'mint', 'mallow']);
    expect(original).toEqual(['rose', 'mint']);
    expect(islandPetsForCount(undefined, 3)).toEqual(['mallow', 'mint', 'aqua']);
    expect(defaultSettings.islandPets).toEqual(['mallow']);
    expect(defaultSettings.islandPetInteractions).toBe(true);
  });
  it('replaces only the selected slot and keeps other assigned characters unique', () => {
    const original = ['mint', 'aqua', 'rose'];
    expect(replaceIslandPet(original, 1, 'ember')).toEqual(['mint', 'ember', 'rose']);
    expect(replaceIslandPet(original, 1, 'rose')).toEqual(original);
    for (const slot of [-1, .5, 3, Number.NaN]) expect(replaceIslandPet(original, slot, 'ember')).toEqual(original);
    expect(original).toEqual(['mint', 'aqua', 'rose']);
  });
});
