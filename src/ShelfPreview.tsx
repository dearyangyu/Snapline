import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { LoaderCircle, X } from './icons';
import type { Capture } from './model';
import { presentShelfPreview } from './shelfHoverPreview';
import { trapImageViewerFocus, useImageViewport } from './useImageViewport';
import { viewerKeyAction } from './galleryLayout';
import ImageZoomControls from './ImageZoomControls';
import './shelfPreview.css';

interface PreviewSession { sessionId: number; item: Capture }

const native = isTauri();
/** A browser fixture may supply a sample; native sessions never use this path. */
export default function ShelfPreview({ demo }: { demo?: { item: Capture; onClose: () => void } } = {}) {
  const expectedSession = useRef(Number(new URLSearchParams(location.search).get('session')));
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 }), [loaded, setLoaded] = useState(false);
  const photo = useRef<HTMLImageElement>(null), dialog = useRef<HTMLElement>(null);
  const close = () => !native ? Promise.resolve(demo?.onClose()) : invoke('close_shelf_preview', { sessionId: expectedSession.current }).catch(() => {});
  const view = useImageViewport({ image: imageSize, identity: `${session?.sessionId ?? ''}:${session?.item.id ?? ''}`, enabled: loaded, onBlankClick: () => void close() });
  useEffect(() => {
    if (!native && demo) { setLoaded(false); setImageSize({ width: demo.item.width || 1, height: demo.item.height || 1 }); setSession({ sessionId: 0, item: demo.item }); }
  }, [demo?.item]);
  useEffect(() => {
    document.documentElement.classList.add('shelf-preview-document');
    let stopped = false;
    const fail = (error: unknown) => {
      if (stopped) return;
      void emitTo('shelf', 'app-error', `无法预览图片：${String(error)}`).catch(() => {});
      void close();
    };
    if (native) void invoke<PreviewSession>('get_shelf_preview').then(next => {
      if (!stopped && next.sessionId === expectedSession.current) { setImageSize({ width: next.item.width || 1, height: next.item.height || 1 }); setSession(next); }
    }).catch(fail);
    return () => {
      stopped = true;
      document.documentElement.classList.remove('shelf-preview-document');
    };
  }, []);
  useEffect(() => {
    if (!native || !session || !photo.current) return;
    let stopped = false;
    let frame = 0;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const image = photo.current;
    void presentShelfPreview({
      current: () => !stopped && session.sessionId === expectedSession.current,
      decode: () => image.decode(),
      paint: () => new Promise<void>(resolve => {
        const finish = () => { clearTimeout(fallback); cancelAnimationFrame(frame); resolve(); };
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
        // Hidden WebView2 windows may suspend rAF. Decoded content remains ready
        // for the first native show; never wait indefinitely for a hidden paint.
        fallback = setTimeout(finish, 100);
      }),
      ready: () => invoke('shelf_preview_ready', { sessionId: session.sessionId }),
      failed: error => {
        void emitTo('shelf', 'app-error', `无法预览图片：${String(error)}`).catch(() => {});
        void close();
      },
    });
    return () => { stopped = true; cancelAnimationFrame(frame); clearTimeout(fallback); };
  }, [session]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (trapImageViewerFocus(event, dialog.current)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = viewerKeyAction(event.key, false);
      if (action) { event.preventDefault(); event.stopPropagation(); }
      // A held Esc may outlive the capture overlay and reach this preserved
      // preview. Consume repeats without treating them as a fresh dismissal.
      if (action === 'close') { if (!event.repeat) void close(); return; }
      if (!loaded) return;
      if (action === 'zoom-in') view.zoomBy(1.25);
      if (action === 'zoom-out') view.zoomBy(1 / 1.25);
      if (action === 'fit') view.reset();
      if (action === 'actual-size') view.zoomTo(1 / view.pixelRatio);
      const offset = ({ ArrowLeft: { x: 64, y: 0 }, ArrowRight: { x: -64, y: 0 }, ArrowUp: { x: 0, y: 64 }, ArrowDown: { x: 0, y: -64 } } as Record<string, { x: number; y: number }>)[event.key];
      if (offset) { event.preventDefault(); view.panBy(offset); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [loaded, view.pixelRatio, view.panBy, view.reset, view.zoomBy, view.zoomTo]);
  return <main ref={dialog} className="shelf-preview image-viewer" role="dialog" aria-modal="true" aria-label="图片快速预览">
    <header className="image-viewer-header">
      <div className="image-viewer-title"><h2>{session?.item.name ?? '图片预览'}</h2><p>{session && <><span>{imageSize.width} × {imageSize.height}</span>{session.item.source && <span>{session.item.source}</span>}</>}</p></div>
      <button className="image-tool-button shelf-preview-close" aria-label="关闭快速预览" title="关闭 · Esc" autoFocus onClick={() => void close()}><X size={20}/></button>
    </header>
    <div ref={view.stage} className={`image-viewer-stage${view.canPan && loaded ? ' can-pan' : ''}${view.dragging ? ' is-panning' : ''}`} {...view.stageEvents}>
      {!loaded && <div className="image-viewer-status" role="status"><LoaderCircle size={24}/><span>正在打开图片…</span></div>}
      {session && <img ref={photo} className="image-viewer-photo" src={native ? convertFileSrc(session.item.path) : session.item.thumbnail} alt={session.item.name} draggable={false}
        style={{ width: imageSize.width, height: imageSize.height, visibility: loaded ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})` }}
        onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoaded(true); }}/>}
    </div>
    <footer className="image-viewer-footer"><span className="image-viewer-hint">滚轮缩放 · 拖动查看 · 点击空白关闭</span><ImageZoomControls {...view} disabled={!loaded}/><span className="image-viewer-counter">Esc 关闭</span></footer>
  </main>;
}
