export interface SelectOption { value: string; label: string; disabled?: boolean }

export function nextSelectOption(options: readonly SelectOption[], current: number, direction: -1 | 1, edge = false) {
  let index = edge ? direction === 1 ? 0 : options.length - 1 : current + direction;
  for (; index >= 0 && index < options.length; index += direction) if (!options[index].disabled) return index;
  return current >= 0 && current < options.length && !options[current].disabled ? current : -1;
}

export function matchSelectOption(options: readonly SelectOption[], text: string, after: number) {
  const query = text.trim().toLocaleLowerCase();
  if (!query) return -1;
  for (let offset = 1; offset <= options.length; offset++) {
    const index = (Math.max(-1, after) + offset) % options.length;
    if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query)) return index;
  }
  return -1;
}

export function selectPopoverPlacement(anchor: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, count: number) {
  const margin = 8, gap = 6;
  const top = Math.max(margin, Math.min(anchor.top, viewport.height - margin));
  const bottom = Math.max(margin, Math.min(anchor.bottom, viewport.height - margin));
  const width = Math.max(0, Math.min(Math.max(anchor.width, 168), viewport.width - margin * 2));
  const desired = Math.min(272, Math.max(44, count * 36 + 8));
  const below = Math.max(0, viewport.height - bottom - gap - margin), above = Math.max(0, top - gap - margin);
  const side = below < desired && above > below ? 'above' : 'below';
  const height = Math.min(desired, side === 'above' ? above : below);
  return { left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)), top: side === 'above' ? top - gap - height : bottom + gap, width, maxHeight: height, side };
}
