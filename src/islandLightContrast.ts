const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Visibility comes from a narrow crest over the island's known black surface,
 * not from guessing the wallpaper. Every layer still fades with its local lobe. */
export function lightContrast(opacity: number, brightness: number, haloWidth: number, color: readonly number[]) {
  const alpha = clamp(opacity, 0, 1), gain = clamp(brightness, 0, 1.4);
  const swell = clamp((haloWidth - 2.7) / 4.1, 0, 1);
  return {
    inset: .65,
    crestWidth: 1.25 + .55 * swell,
    crestAlpha: Math.min(.64, alpha ** .82 * gain * .53),
    coreWidth: .62,
    coreAlpha: Math.min(.97, alpha ** .82 * gain * .94),
    coreColor: color.map(channel => Math.round(channel + (255 - channel) * .18)),
    // Low-alpha colored shade gives white wallpaper a little local contrast;
    // it is not a dark ring and disappears together with the end of each trail.
    nearAlpha: Math.min(.3, alpha ** .9 * gain * .22),
    nearWidth: 2.5 + .8 * swell,
    nearColor: color.map(channel => Math.round(channel * .48)),
  };
}
