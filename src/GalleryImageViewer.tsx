import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ImageOff, LoaderCircle, Pin, RotateCcw, Star, X } from './icons';
import type { Capture } from './model';
import { viewerKeyAction } from './galleryLayout';
import { trapImageViewerFocus, useImageViewport } from './useImageViewport';
import ImageZoomControls from './ImageZoomControls';

export type GalleryImageAction = 'copy_item' | 'pin_item' | 'export_item' | 'toggle_pin';
interface Props {
  item: Capture; source: string; index: number; count: number;
  onClose: () => void; onNavigate: (direction: -1 | 1) => void;
  onAction: (command: GalleryImageAction, item: Capture) => Promise<void>;
}

export default function GalleryImageViewer({ item, source, index, count, onClose, onNavigate, onAction }: Props) {
  const dialog = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [imageSize, setImageSize] = useState({ width: item.width || 1, height: item.height || 1 });
  const [loadedId, setLoadedId] = useState<string | null>(null), [failedId, setFailedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false);
  const loaded = loadedId === item.id && failedId !== item.id, failed = failedId === item.id;
  const view = useImageViewport({ image: imageSize, identity: `${item.id}:${item.path}:${attempt}`, enabled: loaded && !busy, onBlankClick: onClose });
  useEffect(() => { closeButton.current?.focus(); }, []);
  useLayoutEffect(() => {
    setImageSize({ width: item.width || 1, height: item.height || 1 }); setLoadedId(null); setFailedId(null); setAttempt(0);
  }, [item.id, item.path, item.width, item.height]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (trapImageViewerFocus(event, dialog.current)) return;
      const typing = event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable || !!event.target.closest('[role="combobox"]'));
      const action = viewerKeyAction(event.key, typing);
      if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      if (action === 'close') onClose();
      if (action === 'previous') onNavigate(-1);
      if (action === 'next') onNavigate(1);
      if (!loaded) return;
      if (action === 'zoom-in') view.zoomBy(1.25);
      if (action === 'zoom-out') view.zoomBy(1 / 1.25);
      if (action === 'fit') view.reset();
      if (action === 'actual-size') view.zoomTo(1 / view.pixelRatio);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [busy, loaded, onClose, onNavigate, view.pixelRatio, view.zoomBy, view.zoomTo, view.reset]);
  const act = async (command: GalleryImageAction) => {
    if (busy) return;
    setBusy(true); try { await onAction(command, item); } finally { setBusy(false); }
  };
  return <section ref={dialog} className="gallery-viewer image-viewer" role="dialog" aria-modal="true" aria-labelledby="gallery-viewer-title">
    <header className="image-viewer-header">
      <div className="image-viewer-title"><h2 id="gallery-viewer-title">{item.name}</h2><p><span>{imageSize.width} × {imageSize.height}</span>{item.source && <span title={item.source}>{item.source}</span>}<span>{new Date(item.createdAt).toLocaleDateString()}</span></p></div>
      <div className="image-viewer-actions">
        <button className={`image-tool-button${item.pinned ? ' is-active' : ''}`} aria-label={item.pinned ? '取消收藏' : '收藏图片'} aria-pressed={item.pinned} title={item.pinned ? '取消收藏' : '收藏'} disabled={busy} onClick={() => void act('toggle_pin')}><Star size={18} fill={item.pinned ? 'currentColor' : 'none'}/></button>
        <button className="image-tool-button" aria-label="复制图片" title="复制图片" disabled={busy || !loaded} onClick={() => void act('copy_item')}><Copy size={18}/></button>
        <button className="image-tool-button" aria-label="另存为" title="另存为" disabled={busy} onClick={() => void act('export_item')}><Download size={18}/></button>
        <button className="image-tool-button" aria-label="贴到桌面" title="贴到桌面" disabled={busy || !loaded} onClick={() => void act('pin_item')}><Pin size={18}/><span>贴图</span></button>
        <span className="image-tool-divider"/>
        <button ref={closeButton} className="image-tool-button" aria-label="关闭图片查看器" title="关闭图片 · Esc" onClick={onClose} disabled={busy}><X size={21}/></button>
      </div>
    </header>
    <div ref={view.stage} className={`image-viewer-stage${view.canPan && loaded ? ' can-pan' : ''}${view.dragging ? ' is-panning' : ''}`} {...view.stageEvents}>
      {!loaded && !failed && <div className="image-viewer-status" role="status"><LoaderCircle className="gallery-spinner" size={26}/><span>正在打开原图…</span></div>}
      {failed && <div className="image-viewer-status" role="alert"><ImageOff size={30}/><strong>无法打开这张图片</strong><span>文件可能已移动或暂时无法读取。</span><button className="image-tool-button" onClick={() => { setFailedId(null); setLoadedId(null); setAttempt(value => value + 1); }}><RotateCcw size={16}/>重新加载</button></div>}
      <img key={`${item.id}:${attempt}`} className="image-viewer-photo" src={source} alt={item.name} draggable={false}
        style={{ width: imageSize.width, height: imageSize.height, visibility: loaded ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})` }}
        onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoadedId(item.id); setFailedId(null); }}
        onError={() => setFailedId(item.id)}/>
      <button className="gallery-viewer-nav previous" disabled={index <= 0 || busy} aria-label="上一张图片" title="上一张 · ←" onClick={() => onNavigate(-1)}><ChevronLeft size={23}/></button>
      <button className="gallery-viewer-nav next" disabled={index >= count - 1 || busy} aria-label="下一张图片" title="下一张 · →" onClick={() => onNavigate(1)}><ChevronRight size={23}/></button>
    </div>
    <footer className="image-viewer-footer"><span className="image-viewer-hint">滚轮缩放 · 拖动查看 · 双击放大</span><ImageZoomControls {...view} disabled={!loaded || busy}/><span className="image-viewer-counter">{index + 1} / {count}</span></footer>
  </section>;
}
