import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from './icons';
import { matchSelectOption, nextSelectOption, selectPopoverPlacement, type SelectOption } from './selectBehavior';
import './select.css';

interface Props { id?: string; label: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void; disabled?: boolean; appearance?: 'light' }

/** Select-only combobox: DOM focus stays on the trigger while options are browsed. */
export default function Select({ id, label, value, options, onChange, disabled = false, appearance }: Props) {
  const generated = useId();
  const listId = `${id || generated}-options`;
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [position, setPosition] = useState<ReturnType<typeof selectPopoverPlacement> | null>(null);
  const selected = options.findIndex(option => option.value === value);
  const enabled = () => !disabled && !trigger.current?.matches(':disabled');
  const show = (index = selected >= 0 && !options[selected].disabled ? selected : nextSelectOption(options, -1, 1)) => {
    if (!enabled() || index < 0) return;
    search.current = { text: '', time: 0 }; setActive(index); setOpen(true);
  };
  const close = () => { setOpen(false); search.current = { text: '', time: 0 }; };
  const commit = (index: number) => {
    if (!enabled() || !options[index] || options[index].disabled) return;
    close(); if (options[index].value !== value) onChange(options[index].value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (bounds && (bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth)) { setOpen(false); return; }
      if (bounds) setPosition(selectPopoverPlacement(bounds, { width: innerWidth, height: innerHeight }, options.length));
    };
    place();
    const observer = new ResizeObserver(place); if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, options.length]);
  useLayoutEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, position?.side]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target))) close();
    };
    const blur = () => close();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside, true); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); window.removeEventListener('blur', blur); };
  }, [open]);

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || !enabled()) return;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      // These belong to the dropdown, including inside the screenshot overlay.
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ') { if (open) commit(active); else show(); return; }
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      if (event.key === 'Home' || event.key === 'End') { const index = nextSelectOption(options, -1, direction, true); if (open) setActive(index); else show(index); }
      else if (!open) show();
      else if (event.altKey && event.key === 'ArrowUp') commit(active);
      else setActive(nextSelectOption(options, active, direction));
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      const now = performance.now(), text = now - search.current.time > 700 ? event.key : search.current.text + event.key;
      const repeated = [...text].every(character => character.toLocaleLowerCase() === text[0].toLocaleLowerCase());
      const index = matchSelectOption(options, repeated ? event.key : text, repeated ? open ? active : selected : -1);
      if (!open) show(index >= 0 ? index : undefined); else if (index >= 0) setActive(index);
      search.current = { text, time: now };
    } else if (open) event.stopPropagation();
  };

  return <>
    <button ref={trigger} id={id} type="button" className="select-control" data-tone={appearance} role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      disabled={disabled} onKeyDown={key} onClick={() => open ? close() : show()}>
      <span>{options[selected]?.label || value}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} id={listId} role="listbox" aria-label={label} className="select-popover" data-tone={appearance} data-side={position?.side}
      style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onWheel={event => event.stopPropagation()}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} data-option-index={index} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        className={`select-option${index === active ? ' is-active' : ''}`} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={event => { event.stopPropagation(); commit(index); }}>
        <span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </>;
}
