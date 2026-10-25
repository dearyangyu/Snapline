/** Original photo and clip dimensions, with room for the deeper desktop rope. */
export const clotheslineLayout = { photoWidth: 136, photoHeight: 104, cardWidth: 150, gap: 24, inset: 4, radius: 16, clipHeight: 26, pinAbove: 9.5, height: 250 } as const;

export function fitClotheslinePhoto(width: number, height: number) {
  const { photoWidth, photoHeight } = clotheslineLayout;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: photoWidth, height: photoHeight };
  const scale = Math.min(photoWidth / width, photoHeight / height);
  return { width: width * scale, height: height * scale };
}

export const ropeSag = (width: number) => {
  const w = Math.max(0, width);
  // Reserve real headroom for the 48px source sprites on ordinary windows.
  // Below 720px the curve shallows continuously instead of imposing a steep
  // fixed sag on a tiny viewport; large desktops retain their natural depth.
  // Cap at 54px so the 112px frame, reveal bounce and angular swing still fit
  // above the toolbar in the unchanged 250px native stage.
  return Math.min(54, Math.max(Math.min(50, w * 50 / 720), w * .023));
};
/** A single smooth loaded curve; the small bias avoids a perfectly mirrored arc. */
export function ropeCurve(width: number) {
  const sag = ropeSag(width), bias = 0.13;
  return { startY: 24, control1Y: 24 + 4 * sag * (1 - bias) / 3, control2Y: 24 + 4 * sag * (1 + bias) / 3, endY: 24 };
}
export function ropePath(width: number) {
  const curve = ropeCurve(width);
  return `M 0 ${curve.startY} C ${width / 3} ${curve.control1Y} ${width * 2 / 3} ${curve.control2Y} ${width} ${curve.endY}`;
}
export function ropeY(x: number, width: number) {
  if (width <= 0) return 24;
  const f = Math.min(1, Math.max(0, x / width)), inverse = 1 - f;
  const curve = ropeCurve(width);
  // The cubic's x control points are at 1/3 and 2/3, so its parameter is x/width.
  return inverse ** 3 * curve.startY + 3 * inverse ** 2 * f * curve.control1Y + 3 * inverse * f ** 2 * curve.control2Y + f ** 3 * curve.endY;
}

/** Recompute from viewport position when scrolling, so clips stay on the rope. */
export function clotheslineAttachment(left: number, width: number, scrollLeft: number, viewport: number) {
  const center = left + width / 2 - scrollLeft;
  return { top: ropeY(center, viewport) - clotheslineLayout.pinAbove, opacity: Math.min(1, Math.max(0, Math.min(center, viewport - center) / 90)) };
}

/** Stable across reorders, favorite updates, and WebView remounts. */
function hashClotheslineSeed(id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function clotheslineTilt(id: string) {
  const hash = hashClotheslineSeed(id);
  return ((hash >>> 0) % 501) / 100 - 2.5;
}

/** Unit-mass damped spring, including velocity for interruption continuity. */
export function dampedSpring(seconds: number, displacement: number, velocity = 0, stiffness = 46, damping = 2.6) {
  const t = Math.max(0, seconds);
  const decay = damping / 2;
  const frequency = Math.sqrt(stiffness - decay * decay);
  const a = displacement;
  const b = (velocity + decay * displacement) / frequency;
  const cosine = Math.cos(frequency * t), sine = Math.sin(frequency * t), envelope = Math.exp(-decay * t);
  return {
    position: envelope * (a * cosine + b * sine),
    velocity: envelope * ((b * frequency - decay * a) * cosine - (a * frequency + decay * b) * sine),
  };
}

export interface ClotheslineMotion { angle: number; velocity: number; drop: number; dropVelocity?: number; duration: number; stiffness: number; damping: number }
/** Stop only when the analytical angular envelope is below a subpixel angle. */
export function settledClotheslineMotion(parameters: Omit<ClotheslineMotion, 'duration'>): ClotheslineMotion {
  const decay = parameters.damping / 2;
  const frequency = Math.sqrt(parameters.stiffness - decay * decay);
  const amplitude = Math.hypot(parameters.angle, (parameters.velocity + decay * parameters.angle) / frequency);
  const duration = Math.ceil(Math.max(900, Math.log(Math.max(1, amplitude / 0.03)) / decay * 1000));
  return { ...parameters, duration };
}

/** Deterministic per photo + reveal. Metadata renders never re-roll this plan. */
export function arrivalMotion(id: string, generation: number): ClotheslineMotion & { delay: number } {
  let seed = hashClotheslineSeed(`${id}:${generation}`);
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const direction = next() < 0.5 ? -1 : 1;
  const angle = direction * (5 + 11 * next() ** 0.8);
  const velocity = (next() - 0.5) * 10;
  const stiffness = 32 + next() * 26;
  const damping = 2.6 + next() * 1.5;
  const drop = -(32 + next() * 18);
  const delay = Math.round(next() ** 1.35 * 150);
  return { ...settledClotheslineMotion({ angle, velocity, stiffness, damping, drop }), delay };
}
export function sampleClotheslineMotion(motion: ClotheslineMotion, elapsedMs: number) {
  if (elapsedMs >= motion.duration) return { angle: 0, velocity: 0, y: 0 };
  const t = Math.max(0, elapsedMs) / 1000;
  const swing = dampedSpring(t, motion.angle, motion.velocity, motion.stiffness, motion.damping);
  const arrivalFrequency = 2 * Math.PI / 0.42;
  return { angle: swing.position, velocity: swing.velocity, y: dampedSpring(t, motion.drop, motion.dropVelocity ?? 0, arrivalFrequency ** 2, 2 * 0.72 * arrivalFrequency).position };
}

/** A reversed close resumes the same spring, including both angular and drop velocity. */
export function continueClotheslineMotion(motion: ClotheslineMotion, elapsedMs: number): ClotheslineMotion {
  if (elapsedMs >= motion.duration) return settledClotheslineMotion({ ...motion, angle: 0, velocity: 0, drop: 0, dropVelocity: 0 });
  const t = Math.max(0, elapsedMs) / 1000;
  const angular = dampedSpring(t, motion.angle, motion.velocity, motion.stiffness, motion.damping);
  const frequency = 2 * Math.PI / 0.42;
  const vertical = dampedSpring(t, motion.drop, motion.dropVelocity ?? 0, frequency ** 2, 2 * 0.72 * frequency);
  return settledClotheslineMotion({ ...motion, angle: angular.position, velocity: angular.velocity, drop: vertical.position, dropVelocity: vertical.velocity });
}

export function clotheslineKeyframes(motion: ClotheslineMotion, tilt: number): Keyframe[] {
  const count = Math.ceil(motion.duration / (1000 / 60));
  return Array.from({ length: count + 1 }, (_, index) => {
    const value = sampleClotheslineMotion(motion, index * motion.duration / count);
    return { offset: index / count, transform: `translateY(${value.y.toFixed(4)}px) rotate(${(tilt + value.angle).toFixed(4)}deg)` };
  });
}

/** Tendedero's reveal spring: response .42, damping fraction .82. */
export function shelfRevealKeyframes(fromY: number): Keyframe[] {
  const frequency = 2 * Math.PI / 0.42;
  return Array.from({ length: 27 }, (_, index) => {
    const offset = index / 26;
    const y = index === 26 ? 0 : dampedSpring(offset * 0.42, fromY, 0, frequency ** 2, 2 * 0.82 * frequency).position;
    return { offset, transform: `translateY(${y.toFixed(4)}px)` };
  });
}
