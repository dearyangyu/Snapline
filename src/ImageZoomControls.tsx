import { Expand, Minus, Plus } from './icons';
import './imageViewer.css';

interface Props { scale: number; pixelRatio: number; minimumScale: number; maximumScale: number; fitted: boolean; disabled?: boolean; zoomBy: (factor: number) => void; zoomTo: (scale: number) => void; reset: () => void }
export default function ImageZoomControls({ scale, pixelRatio, minimumScale, maximumScale, fitted, disabled, zoomBy, zoomTo, reset }: Props) {
  return <div className="image-zoom-controls" role="group" aria-label="图片缩放">
    <button className="image-tool-button" aria-label="缩小" title="缩小 · −" disabled={disabled || scale <= minimumScale} onClick={() => zoomBy(1 / 1.25)}><Minus size={18}/></button>
    <button className="image-zoom-value" aria-label={`当前缩放 ${Math.round(scale * pixelRatio * 100)}%，点击显示100%`} title="100% · 1" disabled={disabled} onClick={() => zoomTo(1 / pixelRatio)}>{Math.round(scale * pixelRatio * 100)}<span>%</span></button>
    <button className="image-tool-button" aria-label="放大" title="放大 · +" disabled={disabled || scale >= maximumScale} onClick={() => zoomBy(1.25)}><Plus size={18}/></button>
    <span className="image-tool-divider"/>
    <button className={`image-tool-button image-fit-button${fitted ? ' is-active' : ''}`} aria-label="适应窗口" aria-pressed={fitted} title="适应窗口 · 0" disabled={disabled} onClick={reset}><Expand size={17}/><span>适应</span></button>
  </div>;
}
