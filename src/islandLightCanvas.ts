import { lightAt, type IslandLightState } from './islandRimMotion';
import { FLOW_GEOMETRY, flowLobe, flowPoint, flowSample } from './islandFlowField';
import { lightContrast } from './islandLightContrast';

export { FLOW_GEOMETRY };
export interface FlowOptions { glow?: number; flow?: number; pixelRatio?: number }
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

/** Shared renderer. Combined is the exact edge+halo composition for
 * preview; the other modes render synchronized native decoration windows. */
export function lightRenderer(canvas: HTMLCanvasElement, part: 'edge' | 'halo' | 'combined' = 'combined') {
  const context = canvas.getContext('2d');
  const edge = document.createElement('canvas'), halo = document.createElement('canvas'), near = document.createElement('canvas');
  const edgeContext = edge.getContext('2d'), haloContext = halo.getContext('2d'), nearContext = near.getContext('2d');
  if (!context || !edgeContext || !haloContext || !nearContext) throw Error('无法准备入口光效');
  const width = part === 'edge' ? 168 : 256, height = part === 'edge' ? 42 : 130;

  return (state: IslandLightState, now: number, options: FlowOptions = {}) => {
    const dpr = bounded(options.pixelRatio, Math.min(3, Math.max(1, devicePixelRatio || 1)), 1, 4);
    const flow = bounded(options.flow, 1, 0, 1.8), glow = bounded(options.glow, 1, 0, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    for (const surface of [edge, halo, near]) if (surface.width !== Math.round(256 * dpr) || surface.height !== Math.round(130 * dpr)) {
      surface.width = Math.round(256 * dpr); surface.height = Math.round(130 * dpr);
    }
    for (const target of [edgeContext, haloContext, nearContext]) {
      target.setTransform(dpr, 0, 0, dpr, 0, 0); target.clearRect(0, 0, 256, 130); target.lineCap = 'round';
    }
    const pose = lightAt(state, now);
    for (const lobe of [0, 1] as const) {
      const { head, length } = flowLobe(pose.travel, lobe, flow);
      const samples = 220;
      for (let i = 0; i < samples; i++) {
        const t = (i + .5) / samples;
        const field = flowSample(pose.travel, lobe, t, flow);
        if (field.opacity < .002) continue;
        const color = field.color.join(',');
        const contrast = lightContrast(field.opacity, pose.brightness, field.haloWidth, field.color);
        const from = head - i / samples * length, to = head - (i + 1) / samples * length;
        if (part !== 'halo') {
          // Keep the colorful crest inside the known black capsule: the deepest
          // pixel is <2 CSS px from its edge, regardless of the wallpaper.
          const a = flowPoint(from, -contrast.inset), b = flowPoint(to, -contrast.inset);
          edgeContext.lineWidth = contrast.crestWidth;
          edgeContext.strokeStyle = `rgba(${color},${contrast.crestAlpha})`;
          edgeContext.beginPath(); edgeContext.moveTo(a[0], a[1]); edgeContext.lineTo(b[0], b[1]); edgeContext.stroke();
          edgeContext.lineWidth = contrast.coreWidth;
          edgeContext.strokeStyle = `rgba(${contrast.coreColor.join(',')},${contrast.coreAlpha})`;
          edgeContext.beginPath(); edgeContext.moveTo(a[0], a[1]); edgeContext.lineTo(b[0], b[1]); edgeContext.stroke();
        }
        if (part !== 'edge') {
          const a = flowPoint(from, field.outward), b = flowPoint(to, field.outward);
          haloContext.lineWidth = field.haloWidth;
          haloContext.strokeStyle = `rgba(${color},${Math.min(1, field.opacity * pose.brightness)})`;
          haloContext.beginPath(); haloContext.moveTo(a[0], a[1]); haloContext.lineTo(b[0], b[1]); haloContext.stroke();
          const nearA = flowPoint(from, .7), nearB = flowPoint(to, .7);
          nearContext.lineWidth = contrast.nearWidth;
          nearContext.strokeStyle = `rgba(${contrast.nearColor.join(',')},${contrast.nearAlpha})`;
          nearContext.beginPath(); nearContext.moveTo(nearA[0], nearA[1]); nearContext.lineTo(nearB[0], nearB[1]); nearContext.stroke();
        }
      }
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1; context.filter = 'none';
    if (part === 'edge') { context.drawImage(edge, -44, -44, 256, 130); return; }
    // A broad colored mist plus a closer soft crest. Both swell locally along
    // the trail; the black center removes all inward spill, not just a border.
    // Canvas filter radii use backing pixels, independently of its transform.
    // Scale them too, so high-DPI and 2x detail retain the same logical bloom.
    context.filter = `blur(${12 * dpr}px)`; context.globalAlpha = .16 * glow; context.drawImage(halo, 0, 0, 256, 130);
    context.filter = `blur(${8.5 * dpr}px)`; context.globalAlpha = Math.min(1, .52 * glow); context.drawImage(halo, 0, 0, 256, 130);
    context.filter = `blur(${4.2 * dpr}px)`; context.globalAlpha = .5 * glow; context.drawImage(halo, 0, 0, 256, 130);
    context.filter = `blur(${1.6 * dpr}px)`; context.globalAlpha = Math.min(1, glow); context.drawImage(near, 0, 0, 256, 130);
    context.filter = 'none'; context.globalAlpha = 1;
    context.globalCompositeOperation = part === 'halo' ? 'destination-out' : 'source-over';
    context.fillStyle = '#000'; context.beginPath(); context.roundRect(44, 44, 168, 42, 21); context.fill();
    context.globalCompositeOperation = 'source-over';
    if (part === 'combined') context.drawImage(edge, 0, 0, 256, 130);
  };
}
