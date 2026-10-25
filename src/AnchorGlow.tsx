import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { lightRenderer } from './islandLightCanvas';
import { newerLightState, type IslandLightState } from './islandRimMotion';
import './islandRim.css';

/** Native WS_EX_TRANSPARENT makes the entire decoration window click-through. */
export default function AnchorGlow() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    document.documentElement.classList.add('anchor-glow-document');
    if (!canvas.current) return;
    const draw = lightRenderer(canvas.current, 'halo');
    const token = Number(new URLSearchParams(location.search).get('token'));
    let current: IslandLightState | null = null, frame = 0, stopped = false, acknowledged = false;
    let off: (() => void) | undefined;
    const paint = () => {
      frame = 0;
      if (stopped || !current) return;
      draw(current, Date.now());
      if (current.playing && !document.hidden) frame = requestAnimationFrame(paint);
    };
    const refresh = () => { if (frame) cancelAnimationFrame(frame); frame = 0; paint(); };
    void listen<IslandLightState>('anchor-light-state', event => {
      if (stopped || !newerLightState(event.payload, current)) return;
      current = event.payload; refresh();
      if (!acknowledged) {
        acknowledged = true;
        // Hidden WebViews may suspend RAF. The canvas has been synchronously
        // drawn; the native ready gate also checks its current creation token.
        setTimeout(() => { if (!stopped) void invoke('anchor_glow_ready', { token }).catch(() => {}); }, 32);
      }
    }).then(stop => {
      if (stopped) { stop(); return; }
      off = stop; void emitTo('anchor', 'anchor-light-request').catch(() => {});
    });
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('resize', refresh);
    return () => {
      stopped = true; off?.(); if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('resize', refresh);
      document.documentElement.classList.remove('anchor-glow-document');
    };
  }, []);
  return <canvas className="anchor-glow-canvas" ref={canvas} aria-hidden="true" />;
}
