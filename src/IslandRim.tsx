import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { IslandRimMotion } from './islandRimMotion';
import { lightRenderer } from './islandLightCanvas';
import './islandRim.css';

/** The 168×42 interactive window paints only the approved fine edge. */
export default function IslandRim({ active = false, paused = false }: { active?: boolean; paused?: boolean }) {
  const field = useRef<HTMLCanvasElement>(null);
  const sync = useRef<(() => void) | null>(null);
  const state = useRef({ active, paused });
  state.current = { active, paused };

  useEffect(() => {
    if (!field.current) return;
    const draw = lightRenderer(field.current, 'edge'), motion = new IslandRimMotion(Date.now());
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, stopped = false, visible = false, visibilityRevision = 0;
    const off: (() => void)[] = [];
    const publish = () => { void emitTo('anchor-glow', 'anchor-light-state', motion.state).catch(() => {}); };
    const tick = () => {
      frame = 0;
      if (stopped || !motion.state.playing) return;
      draw(motion.state, Date.now()); frame = requestAnimationFrame(tick);
    };
    const update = () => {
      if (stopped) return;
      motion.update(state.current.active, visible && !state.current.paused && !preference.matches && !document.hidden, Date.now());
      if (frame) cancelAnimationFrame(frame); frame = 0;
      draw(motion.state, Date.now()); publish();
      if (motion.state.playing) frame = requestAnimationFrame(tick);
    };
    const register = (promise: Promise<() => void>) => { void promise.then(stop => { if (stopped) stop(); else off.push(stop); }); };
    register(listen<boolean>('anchor-visibility', event => { visibilityRevision++; visible = event.payload; update(); }));
    register(listen('anchor-light-request', publish).then(stop => { publish(); return stop; }));
    void invoke<boolean>('anchor_visual_visible').then(value => { if (!visibilityRevision) { visible = value; update(); } }).catch(() => {});
    sync.current = update;
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('resize', update);
    return () => {
      stopped = true; sync.current = null;
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('resize', update);
      if (frame) cancelAnimationFrame(frame);
      off.forEach(stop => stop());
    };
  }, []);
  useEffect(() => { sync.current?.(); }, [active, paused]);

  return <canvas ref={field} className="island-rim" aria-hidden="true" />;
}
