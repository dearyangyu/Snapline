import { describe, expect, it } from 'vitest';
import { arrivalMotion, clotheslineTilt, ropeY, sampleClotheslineMotion } from './clothesline';
import { SPRITE_CELL, SPRITE_PETS, spriteContactY } from './spritePetCatalog';
import { ShelfRopeMotion, bindRopePerch, resolveRopePerches, ropeAttachment, ropeBindingFits, ropePerchScale, ropePerches, ropeReleaseMatches, type RopePose } from './shelfRopeMotion';

// Project the complete action/source-frame box, including the 203px standing
// contact, rather than asserting only a neutral 32×30 wrapper height.
function bodyBounds(x: number, pose: RopePose, scale: number) {
  const angle = pose.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const corners = [-22, 22].flatMap(dx => [-34, 10].map(dy => ({ x: x + (dx * c - dy * s) * scale, y: pose.y + (dx * s + dy * c) * scale })));
  return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)) };
}

describe('shared clothesline dynamics', () => {
  it('does not resume a new photo hold on a delayed capture loss from the old photo using the same mouse pointer', () => {
    const oldPhoto = {}, newPhoto = {}, held = { id: 1, owner: newPhoto };
    expect(ropeReleaseMatches(held, { pointerId: 1, type: 'lostpointercapture', target: oldPhoto })).toBe(false);
    expect(ropeReleaseMatches(held, { pointerId: 1, type: 'lostpointercapture', target: newPhoto }, true)).toBe(false);
    expect(ropeReleaseMatches(held, { pointerId: 1, type: 'lostpointercapture', target: newPhoto })).toBe(true);
    expect(ropeReleaseMatches(held, { pointerId: 2, type: 'pointerup', target: newPhoto })).toBe(false);
    expect(ropeReleaseMatches(held, { pointerId: 1, type: 'pointerup', target: {} })).toBe(true);
  });
  it('waits for the reveal to enter view, rebounds in different spatial modes, keeps endpoints fixed, and settles', () => {
    let maximum = 0, minimum = 0;
    for (const generation of [0, 1, 4, 12]) {
      const motion = new ShelfRopeMotion(); motion.present(generation, true, false);
      const firstPeak: number[] = [];
      for (let time = 0; time < 3200; time += 10) {
        motion.advance(10);
        expect(motion.sample(0, 2560).y).toBe(24); expect(motion.sample(2560, 2560).y).toBe(24);
        const values = [.2, .5, .78].map(fraction => motion.sample(fraction * 2560, 2560).offset);
        maximum = Math.max(maximum, ...values); minimum = Math.min(minimum, ...values);
        if (time < 150) expect(values).toEqual([0, 0, 0]);
        if (time >= 250 && time < 450) firstPeak.push(values[1]);
        if (time > 2700) expect(Math.max(...values.map(Math.abs))).toBeLessThan(.01);
      }
      expect(Math.max(...firstPeak)).toBeGreaterThan(3.5); expect(motion.moving).toBe(false);
    }
    expect(maximum).toBeLessThan(7); expect(minimum).toBeGreaterThan(-3);
    expect(minimum).toBeLessThan(-1);
  });

  it('keeps photo reveal, rope rebound and hover together above the toolbar in the unchanged 250px stage', () => {
    let deepestPhoto = 0, deepestRope = 0;
    for (const width of [720, 1280, 2560, 3840]) for (let generation = 0; generation < 12; generation++) {
      const motion = new ShelfRopeMotion(); motion.present(generation, true, false);
      const plans = Array.from({ length: 20 }, (_, i) => ({ ...arrivalMotion(`photo-${i}`, generation), tilt: clotheslineTilt(`photo-${i}`) }));
      for (let time = 0; time < 3200; time += 16) {
        if (time) motion.advance(16);
        for (const fraction of [.24, .4, .5, .6, .76]) {
          const rope = motion.sample(width * fraction, width);
          deepestRope = Math.max(deepestRope, rope.y);
          for (const plan of plans) {
            const photo = sampleClotheslineMotion(plan, Math.max(0, time - plan.delay));
            const angle = (photo.angle + plan.tilt) * Math.PI / 180;
            // 144×112 actual frame incl padding, 1.035 hover scale, swing
            // origin9.5 and photo top14. The copy badge now sits inside it.
            deepestPhoto = Math.max(deepestPhoto, rope.y + photo.y + Math.abs(Math.sin(angle)) * 72 * 1.035 + Math.cos(angle) * (4.5 + 112 * 1.035));
          }
        }
      }
    }
    expect(deepestPhoto).toBeLessThan(214);
    expect(deepestRope + 1.2 + 3 * 1.2).toBeLessThan(94); // shifted soft rope shadow stays in mask
  });

  it('freezes exact positions during a hold/hidden close and continues the same trajectory after quick reversal', () => {
    const motion = new ShelfRopeMotion(), reference = new ShelfRopeMotion();
    for (const instance of [motion, reference]) { instance.present(3, true, false); for (let i = 0; i < 24; i++) instance.advance(16); }
    const before = motion.sample(730, 1920);
    for (let i = 0; i < 10; i++) motion.advance(5000, true);
    expect(motion.sample(730, 1920)).toEqual(before);
    motion.present(3, false, false); motion.advance(5000);
    expect(motion.sample(730, 1920)).toEqual(before);
    motion.present(4, true, true);
    expect(motion.sample(730, 1920)).toEqual(before);
    for (let i = 0; i < 80; i++) {
      motion.advance(16); reference.advance(16);
      expect(motion.sample(730, 1920)).toEqual(reference.sample(730, 1920));
    }
  });

  it('uses the current visual X and compensates FLIP Y without changing the transform owner', () => {
    const motion = new ShelfRopeMotion(); motion.present(2, true, false);
    for (let i = 0; i < 20; i++) motion.advance(16);
    for (const scroll of [0, 153, 500]) for (const progress of [0, .2, .65, 1]) {
      const center = 780 - scroll, x = 174 * (1 - progress), y = -8 * (1 - progress), baseY = ropeY(center, 1920);
      const attachment = ropeAttachment(motion, 1920, center, baseY, x, y);
      expect(baseY + y + attachment.offset).toBeCloseTo(motion.sample(center + x, 1920).y, 10);
      expect(attachment.angle).toBe(motion.sample(center + x, 1920).angle);
    }
  });

  it('keeps the SVG Hermite segments and every contact point on the same smooth curve', () => {
    const motion = new ShelfRopeMotion(); motion.present(4, true, false);
    for (let i = 0; i < 19; i++) motion.advance(16);
    for (const width of [320, 1280, 2560, 3840]) {
      const values = motion.path(width).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      let [x, y] = values;
      for (let i = 2; i < values.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = values.slice(i, i + 6);
        for (const t of [.25, .5, .75]) {
          const q = 1 - t;
          const px = q ** 3 * x + 3 * q ** 2 * t * x1 + 3 * q * t ** 2 * x2 + t ** 3 * x3;
          const py = q ** 3 * y + 3 * q ** 2 * t * y1 + 3 * q * t ** 2 * y2 + t ** 3 * y3;
          expect(Math.abs(py - motion.sample(px, width).y)).toBeLessThan(.003);
        }
        x = x3; y = y3;
      }
    }
  });

  it('keeps reduced motion static and ignores metadata updates instead of replaying impact', () => {
    const motion = new ShelfRopeMotion(); motion.present(8, true, false); motion.advance(40, false, true);
    expect(motion.sample(1000, 2000).offset).toBe(0); expect(motion.moving).toBe(false);
    for (let i = 0; i < 80; i++) { motion.present(8, true, false); motion.advance(16); }
    expect(motion.sample(1000, 2000).offset).toBe(0);
    motion.present(9, true, false); for (let i = 0; i < 20; i++) motion.advance(16);
    expect(motion.sample(1000, 2000).offset).toBeGreaterThan(3);
  });
});

describe('stable pet perches', () => {
  it('invalidates an empty-stage or restored-over-the-pet gap, while scroll/metadata keep the same neighboring identities', () => {
    const empty = bindRopePerch(640, [], 0);
    expect(ropeBindingFits(empty, [])).toBe(true);
    expect(ropeBindingFits(empty, ['first'])).toBe(false);
    const pair = bindRopePerch(640, [{ id: 'left', x: 560 }, { id: 'right', x: 734 }], 0);
    expect(ropeBindingFits(pair, ['left', 'right'])).toBe(true);
    expect(ropeBindingFits(pair, ['left', 'restored', 'right'])).toBe(false);
    expect(ropeBindingFits(pair, ['right'])).toBe(false);
    const revised = ropePerches(1280, 1, [560, 640, 734])[0];
    expect(Math.abs(revised.x - 640)).toBeGreaterThan(6);
  });
  it('spreads 48px residents near the requested fractions and gives them distinct clip gaps', () => {
    expect(ropePerches(2560, 1, [])[0].scale).toBe(1.5);
    for (const fractions of [[.29, .71], [.24, .5, .76]]) {
      const empty = ropePerches(2560, fractions.length, []);
      empty.forEach((slot, i) => expect(Math.abs(slot.x / 2560 - fractions[i])).toBeLessThan(.001));
      const pegs = Array.from({ length: 15 }, (_, i) => 86 + 174 * i);
      const slots = ropePerches(2560, fractions.length, pegs);
      const gaps = slots.map(slot => pegs.filter(peg => peg < slot.x).length);
      expect(new Set(gaps).size).toBe(fractions.length);
      for (let i = 1; i < slots.length; i++) expect(slots[i].x - slots[i - 1].x).toBeGreaterThan(120);
    }
  });

  it('preserves visibly large source characters on common windows instead of solving headroom by excessive shrinking', () => {
    for (const width of [720, 1280, 1920, 2560]) for (const count of [0, 4, 10]) {
      const pegs = Array.from({ length: count }, (_, index) => width / 2 + (index - (count - 1) / 2) * 174);
      const slots = ropePerches(width, 3, pegs);
      expect(slots).toHaveLength(3);
      for (const slot of slots) expect(slot.scale * 32).toBeGreaterThanOrEqual(width < 1000 ? 43 : 46);
    }
  });
  it('keeps full animated heads inside the production stage throughout the rope rebound, including shallow windows', () => {
    for (const width of [320, 800, 1280, 2560]) for (const count of [1, 2, 3]) {
      const pegs = [width / 2 - 87, width / 2 + 87];
      const slots = ropePerches(width, count, pegs);
      expect(slots).toHaveLength(count);
      for (const generation of [1, 4, 12]) {
        const motion = new ShelfRopeMotion(); motion.present(generation, true, false);
        for (let step = 0; step < 100; step++) {
          motion.advance(32);
          const boxes = slots.map(slot => bodyBounds(slot.x, motion.sample(slot.x, width), slot.scale));
          boxes.forEach((box, i) => {
            expect(box.top).toBeGreaterThan(2.99);
            expect(box.left).toBeGreaterThan(2.99); expect(box.right).toBeLessThan(width - 2.99);
            for (const peg of pegs) expect(box.right <= peg - 5.99 || box.left >= peg + 5.99).toBe(true);
            if (i) expect(box.left - boxes[i - 1].right).toBeGreaterThan(0);
          });
        }
      }
    }
  });

  it('keeps the fixed metal clip width when a compressed gap shrinks a body', () => {
    const motion = new ShelfRopeMotion();
    expect(ropePerchScale(640, 1280, [645])).toBe(0);
    const scale = ropePerchScale(640, 1280, [647.6]);
    expect(scale).toBeGreaterThan(0); expect(scale).toBeLessThan(.1);
    expect(bodyBounds(640, motion.sample(640, 1280), scale).right).toBeLessThanOrEqual(647.6 - 6);
  });

  it('fits complete proportional source frames both lying down and standing, including the 208px frame height', () => {
    const sourceScale = 32 / SPRITE_CELL.width;
    const contacts = [...new Set(SPRITE_PETS.flatMap(pet => ['idle', 'waiting', 'waving'].map(action => spriteContactY(pet.id, action as 'idle' | 'waiting' | 'waving'))))];
    expect(contacts.sort((a, b) => a - b)).toEqual([173, 203]);
    for (const width of [320, 800, 2560]) {
      const slots = ropePerches(width, 3, [width / 2 - 87, width / 2 + 87]);
      const motion = new ShelfRopeMotion(); motion.present(12, true, false);
      for (let step = 0; step < 100; step++) {
        motion.advance(32);
        for (const slot of slots) for (const contact of contacts) {
          const pose = motion.sample(slot.x, width), angle = pose.angle * Math.PI / 180;
          for (const sourceX of [0, SPRITE_CELL.width]) for (const sourceY of [0, SPRITE_CELL.height]) {
            const x = (sourceX - SPRITE_CELL.width / 2) * sourceScale * slot.scale;
            const y = (sourceY - contact) * sourceScale * slot.scale;
            const actualX = slot.x + x * Math.cos(angle) - y * Math.sin(angle);
            const actualY = pose.y + x * Math.sin(angle) + y * Math.cos(angle);
            expect(actualX).toBeGreaterThan(2.99); expect(actualX).toBeLessThan(width - 2.99);
            expect(actualY).toBeGreaterThan(2.99); expect(actualY).toBeLessThan(250);
          }
        }
      }
    }
  });

  it('preserves each gap identity across one-pixel scrolling and independent FLIP progress without compressing bodies', () => {
    const pegs = [{ id: 'left', x: 410 }, { id: 'right', x: 1010 }];
    const bindings = [590, 710, 830].map(x => bindRopePerch(x, pegs, 0));
    const start = resolveRopePerches(bindings, new Map(pegs.map(peg => [peg.id, peg.x])), 0);
    const scrolled = resolveRopePerches(bindings, new Map(pegs.map(peg => [peg.id, peg.x - 1])), 1);
    expect(scrolled).toEqual(start.map(x => x - 1));
    let previous = start;
    for (let step = 1; step <= 100; step++) {
      const progress = step / 100, left = 410 + 174 * progress, right = 1010 - 252 * progress;
      const positions = resolveRopePerches(bindings, new Map([['left', left], ['right', right]]), 0);
      const motion = new ShelfRopeMotion();
      const boxes = positions.map((x, i) => bodyBounds(x, motion.sample(x, 1280), ropePerchScale(x, 1280, [left, right], positions.filter((_, j) => j !== i))));
      positions.forEach((x, i) => {
        expect(boxes[i].left - left).toBeGreaterThan(5.99); expect(right - boxes[i].right).toBeGreaterThan(5.99);
        if (i) expect(boxes[i].left - boxes[i - 1].right).toBeGreaterThan(0);
        expect(Math.abs(x - previous[i])).toBeLessThan(3);
      });
      previous = positions;
    }
  });
});
