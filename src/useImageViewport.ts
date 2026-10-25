import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { clampImagePan, imageFitScale, ImagePointerGesture, pointInImage, wheelZoomFactor, zoomImageAt, type GallerySize, type ImagePoint } from './galleryLayout';

interface Options { image: GallerySize; identity: string; enabled: boolean; onBlankClick?: () => void }
const origin = { x: 0, y: 0 };

/** Shared by the native quick preview and library viewer. Pointer capture is
 * owned by this stage; blur, decode/item changes and resize cancel its lease. */
export function useImageViewport(options: Options) {
  const stage = useRef<HTMLDivElement>(null), gesture = useRef<ImagePointerGesture | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: Math.max(1, window.innerHeight - 132) });
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [view, setView] = useState<{ zoom: number | null; pan: ImagePoint }>({ zoom: null, pan: origin });
  const [dragging, setDragging] = useState(false);
  const fit = imageFitScale(options.image, viewport, pixelRatio), scale = view.zoom ?? fit;
  const minimumScale = Math.min(.1 / pixelRatio, fit), maximumScale = 8 / pixelRatio;
  const canPan = options.image.width * scale > viewport.width - 48 || options.image.height * scale > viewport.height - 48;
  const latest = useRef({ ...options, viewport, pixelRatio, fit, scale, minimumScale, maximumScale, view, canPan });
  latest.current = { ...options, viewport, pixelRatio, fit, scale, minimumScale, maximumScale, view, canPan };
  const endGesture = useCallback(() => {
    const current = gesture.current; gesture.current = null; setDragging(false);
    if (current && stage.current?.hasPointerCapture(current.id)) stage.current.releasePointerCapture(current.id);
  }, []);
  const reset = useCallback(() => { endGesture(); setView({ zoom: null, pan: origin }); }, [endGesture]);
  const changeZoom = useCallback((amount: number, relative: boolean, anchor: ImagePoint = origin) => {
    if (!latest.current.enabled) return;
    endGesture();
    setView(previous => {
      const current = latest.current, from = previous.zoom ?? current.fit;
      const to = Math.max(current.minimumScale, Math.min(current.maximumScale, relative ? from * amount : amount));
      return { zoom: to, pan: zoomImageAt(previous.pan, from, to, anchor, current.image, current.viewport) };
    });
  }, [endGesture]);
  const zoomTo = useCallback((next: number, anchor?: ImagePoint) => changeZoom(next, false, anchor), [changeZoom]);
  const zoomBy = useCallback((factor: number, anchor?: ImagePoint) => changeZoom(factor, true, anchor), [changeZoom]);
  const panBy = useCallback((offset: ImagePoint) => setView(previous => ({ ...previous,
    pan: clampImagePan({ x: previous.pan.x + offset.x, y: previous.pan.y + offset.y }, latest.current.image, latest.current.viewport, previous.zoom ?? latest.current.fit) })), []);
  const localPoint = (clientX: number, clientY: number) => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };
  useLayoutEffect(() => {
    const element = stage.current; if (!element) return;
    let previousRatio = window.devicePixelRatio || 1;
    const resize = () => {
      endGesture();
      const next = { width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) }, ratio = window.devicePixelRatio || 1;
      setViewport(next); setPixelRatio(ratio);
      const oldRatio = previousRatio; previousRatio = ratio;
      setView(previous => {
        const zoom = previous.zoom === null ? null : previous.zoom * oldRatio / ratio;
        return { zoom, pan: clampImagePan(previous.pan, latest.current.image, next, zoom ?? imageFitScale(latest.current.image, next, ratio)) };
      });
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    window.addEventListener('resize', resize); window.addEventListener('blur', endGesture);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('blur', endGesture); endGesture(); };
  }, [endGesture]);
  useLayoutEffect(() => { reset(); }, [options.identity, reset]);
  useLayoutEffect(() => {
    endGesture();
    setView(previous => ({ ...previous, pan: clampImagePan(previous.pan, options.image, viewport, previous.zoom ?? fit) }));
  }, [options.image.width, options.image.height, viewport.width, viewport.height, fit, endGesture]);
  useEffect(() => { if (!options.enabled) endGesture(); }, [options.enabled, endGesture]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (latest.current.enabled) zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode, element.clientHeight), localPoint(event.clientX, event.clientY));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomBy]);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const current = latest.current;
    if (event.button !== 0 || !event.isPrimary || !current.enabled || gesture.current || event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    const point = localPoint(event.clientX, event.clientY);
    gesture.current = new ImagePointerGesture(event.pointerId, point, current.view.pan, !pointInImage(point, current.view.pan, current.image, current.scale));
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current, current = latest.current; if (active?.id !== event.pointerId) return;
    const next = active.move(localPoint(event.clientX, event.clientY));
    if (active.moved && current.canPan) { setDragging(true); setView(previous => ({ ...previous, pan: clampImagePan(next, current.image, current.viewport, previous.zoom ?? current.fit) })); }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current, current = latest.current; if (active?.id !== event.pointerId) return;
    const point = localPoint(event.clientX, event.clientY);
    const dismiss = active.dismiss(point, !pointInImage(point, current.view.pan, current.image, current.scale));
    endGesture(); if (dismiss) current.onBlankClick?.();
  };
  const pointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    // A late capture-loss after a newer press with the same pointer ID cannot
    // end the active capture owned by this stage.
    if (event.type === 'lostpointercapture' && event.currentTarget.hasPointerCapture(event.pointerId)) return;
    endGesture();
  };
  const doubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const current = latest.current;
    if (!current.enabled || event.target instanceof Element && event.target.closest('button')) return;
    const point = localPoint(event.clientX, event.clientY);
    if (!pointInImage(point, current.view.pan, current.image, current.scale)) return;
    if (current.view.zoom === null) zoomTo((current.fit < .98 / current.pixelRatio ? 1 : 2) / current.pixelRatio, point); else reset();
  };
  return { stage, scale, pan: view.pan, pixelRatio, minimumScale, maximumScale, fitted: view.zoom === null, dragging, canPan,
    reset, zoomTo, zoomBy, panBy,
    stageEvents: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerCancel, onLostPointerCapture: pointerCancel, onDoubleClick: doubleClick } };
}

export function trapImageViewerFocus(event: KeyboardEvent, dialog: HTMLElement | null) {
  if (event.key !== 'Tab' || !dialog) return false;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  return true;
}
