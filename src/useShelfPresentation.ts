import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { acceptsShelfPresentation, afterShelfPaint, type ShelfPresentationEvent, type ShelfPresentationPhase } from './shelfPresentation';
import { shelfRevealKeyframes } from './clothesline';
import { resumePausedAnimation, ShelfPointerHold } from './shelfMotionControl';

/** Native visibility handshake with a vertical reveal; the desktop never scales. */
export function useShelfPresentation(enabled: boolean, reportError: (message: string, error: boolean) => void) {
  const root = useRef<HTMLElement>(null);
  const [presentation, setPresentation] = useState({ generation: 0, visible: !enabled, reversing: false });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let token = -1;
    let phase: ShelfPresentationPhase = 'hidden';
    let traceEnabled = false;
    let unlisten: (() => void) | undefined;
    let motion: Animation | undefined;
    let cancelPaint: (() => void) | undefined;
    const revealPointer = new ShelfPointerHold();
    let heldPointerId: number | null = null;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const report = (error: unknown) => {
      if (stopped) return;
      const message = `晾图显示失败：${String(error)}`;
      reportError(message, true);
      // Initialization failures must also be visible while the shelf is hidden.
      void emitTo('main', 'app-error', message).catch(() => {});
    };
    const trace = (stage: string, eventToken = token) => {
      if (traceEnabled) void invoke('shelf_frontend_trace', { stage, token: Math.max(0, eventToken) }).catch(() => {});
    };
    const send = (command: string, args?: Record<string, unknown>) => { void invoke(command, args).catch(report); };
    const cancelPending = () => {
      cancelPaint?.(); cancelPaint = undefined;
      if (motion) { motion.onfinish = null; motion.cancel(); motion = undefined; }
      heldPointerId = null;
      revealPointer.release();
    };
    const animate = (element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions, finished: () => void) => {
      if (reducedMotion.matches) { finished(); return; }
      const animation = element.animate(frames, options);
      motion = animation;
      animation.onfinish = () => { if (motion === animation) { motion = undefined; finished(); } };
    };
    const onReducedMotion = () => { if (reducedMotion.matches) motion?.finish(); };
    reducedMotion.addEventListener('change', onReducedMotion);
    // A real pointer gesture takes priority over the entrance animation. The
    // target must not slide away while the user holds it to annotate or drag.
    const holdReveal = (event: PointerEvent) => {
      if (phase !== 'open' || event.button !== 0 || motion?.playState !== 'running') return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      // Photos own capture for their drag gesture. Toolbar controls also need
      // capture so a release outside the WebView cannot leave entry paused.
      if (!button.classList.contains('hanging-photo')) revealPointer.begin(event.pointerId, event.clientX, event.clientY, button);
      heldPointerId = event.pointerId;
      motion.pause();
    };
    const resumeReveal = (event: Event) => {
      if (event instanceof PointerEvent) {
        if (event.pointerId !== heldPointerId) return;
        if (event.type === 'lostpointercapture' && event.target instanceof Element && event.target.hasPointerCapture(event.pointerId)) return;
      }
      heldPointerId = null;
      revealPointer.release();
      if (phase === 'open') resumePausedAnimation(motion);
    };
    const mountedRoot = root.current;
    mountedRoot?.addEventListener('pointerdown', holdReveal, true);
    // Windows OLE may consume pointerup without blurring the WebView. Releasing
    // the photo's DOM capture for that handoff must also release the reveal.
    mountedRoot?.addEventListener('lostpointercapture', resumeReveal);
    window.addEventListener('pointerup', resumeReveal);
    window.addEventListener('pointercancel', resumeReveal);
    window.addEventListener('blur', resumeReveal);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (phase === 'open' || phase === 'prepare')) {
        event.preventDefault();
        send('hide_shelf');
      }
    };
    window.addEventListener('keydown', key);
    const onPresentation = (next: ShelfPresentationEvent) => {
      if (stopped) return;
      trace(`event-${next.phase}`, next.token);
      const element = root.current;
      if (!element) { trace('missing-root', next.token); return; }
      if (!acceptsShelfPresentation(token, phase, next)) { trace('rejected', next.token); return; }
      // Sample the actual interrupted position before cancelling its animation.
      const transform = getComputedStyle(element).transform;
      const fromY = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
      const wasClosing = phase === 'close';
      cancelPending();
      token = next.token;
      phase = next.phase;
      element.dataset.shelfPhase = next.phase;
      element.inert = next.phase !== 'open';
      const isCurrent = () => !stopped && token === next.token && phase === next.phase;
      const hiddenY = -(element.clientHeight + 12);
      if (next.phase === 'prepare') {
        element.style.transform = `translateY(${hiddenY}px)`;
        setPresentation(old => ({ ...old, visible: false }));
        // Hidden WebViews can suspend animation frames; acknowledge committed
        // DOM synchronously instead of waiting for an invisible paint cycle.
        void element.getBoundingClientRect();
        send('shelf_transition_ready', { token });
        trace('ready-sent');
      } else if (next.phase === 'open') {
        element.style.transform = 'translateY(0px)';
        setPresentation(old => ({ generation: old.generation + 1, visible: true, reversing: wasClosing }));
        // Native focus is granted only after explicit activation, never hover.
        if (document.hasFocus()) element.querySelector<HTMLElement>('.hanging-items')?.focus({ preventScroll: true });
        cancelPaint = afterShelfPaint(() => { if (isCurrent()) send('shelf_transition_painted', { token: next.token }); }, requestAnimationFrame, cancelAnimationFrame, () => {
          if (!isCurrent()) return false;
          // Early reveal frames are still wholly above the native window. A
          // completed frame only counts once an actual control is on-screen.
          const toolbar = element.querySelector<HTMLElement>('.shelf-toolbar')?.getBoundingClientRect();
          return !!toolbar && toolbar.top >= 0 && toolbar.bottom <= element.clientHeight + 0.5 && toolbar.width > 0;
        });
        animate(element, shelfRevealKeyframes(wasClosing ? fromY : hiddenY), { duration: 420, easing: 'linear' }, () => {
          if (isCurrent()) send('shelf_transition_opened', { token: next.token });
        });
      } else {
        setPresentation(old => ({ ...old, visible: false }));
        element.style.transform = `translateY(${hiddenY}px)`;
        animate(element, [{ transform: `translateY(${fromY}px)` }, { transform: `translateY(${hiddenY}px)` }], { duration: 220, easing: 'ease-in' }, () => {
          // Keep the closing generation until native hides it or a newer open
          // arrives. An old close completion cannot hide a reopened shelf.
          if (isCurrent()) send('shelf_transition_finished', { token: next.token });
        });
      }
    };
    void listen<ShelfPresentationEvent>('shelf-transition', event => {
      try { onPresentation(event.payload); }
      catch (error) { trace('handler-error'); report(error); }
    }).then(off => {
      if (stopped) { off(); return; }
      unlisten = off;
      void invoke<boolean>('shelf_frontend_ready').then(enabled => { traceEnabled = enabled; }).catch(report);
    }).catch(report);
    return () => {
      stopped = true; cancelPending(); unlisten?.(); window.removeEventListener('keydown', key); reducedMotion.removeEventListener('change', onReducedMotion);
      mountedRoot?.removeEventListener('pointerdown', holdReveal, true);
      mountedRoot?.removeEventListener('lostpointercapture', resumeReveal);
      window.removeEventListener('pointerup', resumeReveal);
      window.removeEventListener('pointercancel', resumeReveal);
      window.removeEventListener('blur', resumeReveal);
    };
  }, [enabled, reportError]);
  return { root, ...presentation };
}
