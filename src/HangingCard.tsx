import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Check, Eye, Play, Star, Video, X } from './icons';
import type { Capture } from './model';
import { arrivalMotion, clotheslineKeyframes, clotheslineTilt, continueClotheslineMotion, fitClotheslinePhoto, settledClotheslineMotion, type ClotheslineMotion } from './clothesline';
import { pauseRunningAnimation, resumePausedAnimation, ShelfPointerHold } from './shelfMotionControl';
import { IMAGE_DRAG_THRESHOLD } from './imageDrag';
import { SHELF_EXIT_MS } from './shelfCards';

interface Props {
  item: Capture;
  source: string;
  generation: number;
  visible: boolean;
  reversing: boolean;
  copied: boolean;
  exitToken: number | null;
  nativeDragging: boolean;
  onExitFinished: (id: string, token: number) => void;
  dragged: RefObject<boolean>;
  onHover: (id: string, element: HTMLElement) => void;
  onHoverEnd: (id: string, left?: boolean) => void;
  onStart: (event: PointerEvent<HTMLElement>, id: string) => void;
  onMove: (event: PointerEvent<HTMLElement>, beforeNativeDrag?: () => void) => void;
  onEnd: () => void;
  onAction: (command: string, id: string) => void;
}

export default function HangingCard({ item, source, generation, visible, reversing, copied, exitToken, nativeDragging, onExitFinished, dragged, onHover, onHoverEnd, onStart, onMove, onEnd, onAction }: Props) {
  const slot = useRef<HTMLElement>(null), swing = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const hasPresented = useRef(false);
  const heldPointer = useRef(new ShelfPointerHold());
  const running = useRef<{ animation: Animation; motion: ClotheslineMotion; delay: number } | null>(null);
  const interrupted = useRef<ClotheslineMotion | null>(null);
  const [pressed, setPressed] = useState(false);
  const tilt = clotheslineTilt(item.id);
  const photo = fitClotheslinePhoto(item.width, item.height);
  const stop = () => { running.current?.animation.cancel(); running.current = null; };
  const animate = (motion: ClotheslineMotion, delay = 0) => {
    const element = swing.current;
    stop();
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate(clotheslineKeyframes(motion, tilt), { duration: motion.duration, delay, easing: 'linear', fill: 'backwards' });
    running.current = { animation, motion, delay };
    animation.onfinish = () => { if (running.current?.animation === animation) running.current = null; };
  };
  const nudge = (strength: number) => {
    if (!visible || heldPointer.current.active || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const current = running.current;
    const elapsed = Math.max(0, Number(current?.animation.currentTime ?? 0) - (current?.delay ?? 0));
    // Let the original arrival finish its strongest swing before a hover gust.
    if (strength < 20 && current?.motion.drop && elapsed < 700) return;
    const profile = arrivalMotion(item.id, generation);
    const value = current ? continueClotheslineMotion(current.motion, elapsed) : { ...profile, angle: 0, velocity: 0, drop: 0, dropVelocity: 0, stiffness: profile.stiffness * 0.88, damping: profile.damping * 0.95 };
    const impulse = strength * Math.sign(profile.angle) * (0.7 + Math.abs(profile.angle) / 40);
    animate(settledClotheslineMotion({ ...value, velocity: Math.max(-45, Math.min(45, value.velocity + impulse)) }));
  };
  useLayoutEffect(() => {
    const element = swing.current;
    const transform = element ? getComputedStyle(element).transform : 'none';
    const frozen = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    const current = running.current;
    const continuation = current ? continueClotheslineMotion(current.motion, Math.max(0, Number(current.animation.currentTime ?? 0) - current.delay)) : interrupted.current;
    stop();
    setPressed(false);
    // Closing or preparation also ends the semantic long press, not just its
    // visual state. Clear local capture ownership before lostcapture can fire.
    if (heldPointer.current.release()) onEnd();
    interrupted.current = visible ? null : continuation;
    if (element) element.style.transform = visible ? `rotate(${tilt}deg)` : transform;
    if (visible && slot.current) {
      const rect = slot.current.getBoundingClientRect();
      if (rect.right > 0 && rect.left < window.innerWidth) {
        const profile = arrivalMotion(item.id, generation);
        if (reversing && hasPresented.current) animate(settledClotheslineMotion({ ...(continuation ?? { ...profile, velocity: 0, dropVelocity: 0 }), angle: Math.atan2(frozen.b, frozen.a) * 180 / Math.PI - tilt, drop: frozen.m42 }));
        else animate(profile, profile.delay);
        hasPresented.current = true;
      }
    }
    // Animation identity depends on the item and actual reveal, not metadata edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, visible, item.id, reversing]);
  useLayoutEffect(() => () => { stop(); onHoverEnd(item.id, true); if (heldPointer.current.release()) onEnd(); }, []);
  useLayoutEffect(() => {
    if (copied) nudge(32);
    // A successful native copy is the only trigger for the copied nudge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copied]);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (!media.matches) return;
      stop();
      interrupted.current = null;
      // A cancelled/frozen WAAPI pose must not survive a preference change.
      if (swing.current) swing.current.style.transform = `rotate(${tilt}deg)`;
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    const photoFrame = frame.current, pendulum = swing.current;
    if (exitToken === null) {
      if (pendulum) pendulum.style.transform = `rotate(${tilt}deg)`;
      return;
    }
    onHoverEnd(item.id);
    // Dismissal owns no image-drag source: end the semantic hold immediately,
    // while retaining only an inert visual copy for the short exit.
    heldPointer.current.release(); setPressed(false); onEnd();
    const pose = pendulum ? getComputedStyle(pendulum).transform : 'none';
    stop();
    if (pendulum) pendulum.style.transform = pose;
    if (!photoFrame || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onExitFinished(item.id, exitToken); return;
    }
    const direction = Math.sign(tilt) || 1;
    const animation = photoFrame.animate([
      { transform: getComputedStyle(photoFrame).transform, opacity: 1, offset: 0 },
      { transform: `translate(${direction * 3}px, 24px) rotate(${direction * 3}deg)`, opacity: .7, offset: .52 },
      { transform: `translate(${direction * 9}px, 72px) rotate(${direction * 8}deg)`, opacity: 0, offset: 1 },
    ], { duration: SHELF_EXIT_MS, easing: 'cubic-bezier(.3,0,.65,1)', fill: 'forwards' });
    animation.onfinish = () => onExitFinished(item.id, exitToken);
    return () => { animation.onfinish = null; animation.cancel(); };
    // Only a new hide token starts an exit; metadata updates never replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitToken]);
  const release = (pointerId?: number) => {
    if (!heldPointer.current.release(pointerId)) return;
    setPressed(false);
    resumePausedAnimation(running.current?.animation);
    slot.current?.getAnimations().forEach(resumePausedAnimation);
    onEnd();
  };
  useLayoutEffect(() => {
    if (!pressed) return;
    const releasePointer = (event: globalThis.PointerEvent) => release(event.pointerId);
    const releaseOnBlur = () => release();
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', releaseOnBlur);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releaseOnBlur);
    };
    // The release belongs to the currently held gesture, including OLE handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed]);
  return <article ref={slot} data-shelf-id={item.id} className={`hanging-card${exitToken !== null ? ' is-exiting' : ''}${nativeDragging ? ' is-native-drag' : ''}`} aria-label={item.name} aria-busy={nativeDragging || undefined} aria-hidden={exitToken !== null || undefined} inert={exitToken !== null}>
    <span className="peg" aria-hidden="true" />
    <div ref={swing} className={`hanging-swing${pressed ? ' is-pressed' : ''}`} style={{ transform: `rotate(${tilt}deg)` }} onPointerEnter={() => nudge(15)} draggable={false}>
      <div ref={frame} className={`hanging-frame${photo.width < (item.kind === 'image' ? 70 : 54) ? ' is-narrow' : ''}${photo.height < 36 ? ' is-shallow' : ''}`} style={{ width: photo.width + 8, height: photo.height + 8 }}>
        <button className="hanging-photo" draggable={false} title={`${item.name} · 单击复制，长按标注，拖动分享`}
          onPointerEnter={event => { if (!event.buttons && event.pointerType !== "touch") onHover(item.id, event.currentTarget); }}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return;
            onHoverEnd(item.id);
            if (event.button === 0) {
              heldPointer.current.begin(event.pointerId, event.clientX, event.clientY, event.currentTarget);
              setPressed(true); pauseRunningAnimation(running.current?.animation);
              slot.current?.getAnimations().forEach(pauseRunningAnimation);
            }
            onStart(event, item.id);
          }}
          onPointerMove={event => {
            if (heldPointer.current.movedBeyond(event.pointerId, event.clientX, event.clientY, IMAGE_DRAG_THRESHOLD)) {
              // App commits the source and cancels long press before this
              // callback, then enters OLE only after DOM capture is released.
              onMove(event, () => {
                heldPointer.current.release(event.pointerId);
                setPressed(false);
                resumePausedAnimation(running.current?.animation);
                slot.current?.getAnimations().forEach(resumePausedAnimation);
              });
              // A wheel/cancel may already have invalidated App's source.
              release(event.pointerId);
            } else onMove(event);
          }} onPointerUp={event => release(event.pointerId)} onPointerCancel={event => release(event.pointerId)}
          onPointerLeave={event => { onHoverEnd(item.id, true); if (!event.currentTarget.hasPointerCapture(event.pointerId)) release(event.pointerId); }}
          onLostPointerCapture={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) release(event.pointerId); }}
          onClick={event => { if (event.detail === 0 || !dragged.current) onAction('copy_item', item.id); }}
          onDoubleClick={() => { if (!dragged.current) onAction('open_item', item.id); }}>
          {item.kind === 'image' || item.thumbnail.startsWith('data:image/') ? <img src={source} alt={item.name} draggable={false} loading="lazy" style={{ width: photo.width, height: photo.height }} /> : <span className="hanging-video" style={{ width: photo.width, height: photo.height }}><Video size={26} /></span>}
          {item.kind === 'video' && <span className="hanging-play"><Play size={11} fill="currentColor" /></span>}
        </button>
        <div className="hanging-actions">
          <button className={`icon-button${item.pinned ? ' selected' : ''}`} aria-label={item.pinned ? '取消收藏' : '收藏'} title={item.pinned ? '取消收藏' : '收藏'} onClick={() => onAction('toggle_pin', item.id)}><Star size={11} weight={item.pinned ? 'fill' : 'regular'} /></button>
          {item.kind === 'image' && <button className="icon-button" aria-label="预览大图" title="预览大图 · Esc 关闭" onClick={() => onAction('preview_shelf_item', item.id)}><Eye size={11} /></button>}
          <button className="icon-button" aria-label="从晾衣架收起，图库保留" title="从晾衣架收起，图库保留" onClick={() => onAction('hide_shelf_item', item.id)}><X size={11} /></button>
        </div>
        <span className="hanging-caption" aria-hidden="true">{item.name}</span>
        {copied && <span className="hanging-copied" role="status"><Check size={12} /> 已复制</span>}
      </div>
    </div>
  </article>;
}
