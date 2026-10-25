export type Point = { x: number; y: number };
export type Tool = "rect" | "ellipse" | "arrow" | "line" | "pen" | "highlight" | "text" | "step" | "mosaic" | "blur" | "eraser" | "redact" | "crop";
export type Mark = { tool: Exclude<Tool, "crop">; color: string; width: number; points: Point[]; text?: string; number?: number; fontSize?: number; fontFamily?: string };
export type Bounds = { x: number; y: number; width: number; height: number };
export type ImageDocument = { crop: Bounds; marks: Mark[] };
export type History = { past: ImageDocument[]; present: ImageDocument; future: ImageDocument[] };
export function createHistory(width: number, height: number): History {
  return { past: [], present: { crop: { x: 0, y: 0, width, height }, marks: [] }, future: [] };
}
export function commit(history: History, next: ImageDocument): History {
  return { past: [...history.past, history.present].slice(-100), present: next, future: [] };
}
export function undo(history: History): History {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}
export function redo(history: History): History {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}
export function rectBetween(a: Point, b: Point): Bounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
export function cropDocument(doc: ImageDocument, a: Point, b: Point): ImageDocument {
  const box = rectBetween(a, b), old = doc.crop;
  const x = Math.max(old.x, Math.floor(box.x)), y = Math.max(old.y, Math.floor(box.y));
  const right = Math.min(old.x + old.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(old.y + old.height, Math.ceil(box.y + box.height));
  return right - x < 2 || bottom - y < 2 ? doc : { ...doc, crop: { x, y, width: right - x, height: bottom - y } };
}
// Return original image coordinates even after multiple crops or CSS downscaling.
export function imagePoint(client: Point, display: Bounds, crop: Bounds): Point {
  return { x: crop.x + Math.max(0, Math.min(1, (client.x - display.x) / display.width)) * crop.width,
    y: crop.y + Math.max(0, Math.min(1, (client.y - display.y) / display.height)) * crop.height };
}
// Replace every pixel with its block average; no CSS filtering or hidden source layer
// is included in the exported PNG. Redact is available for complete concealment.
export function pixelate(data: Uint8ClampedArray, width: number, height: number, block: number): void {
  const size = Math.max(2, Math.round(block));
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    const right = Math.min(width, x + size), bottom = Math.min(height, y + size);
    const sums = [0, 0, 0, 0];
    for (let yy = y; yy < bottom; yy++) for (let xx = x; xx < right; xx++) {
      const i = (yy * width + xx) * 4;
      for (let c = 0; c < 4; c++) sums[c] += data[i + c];
    }
    const count = (right - x) * (bottom - y);
    for (let yy = y; yy < bottom; yy++) for (let xx = x; xx < right; xx++) {
      const i = (yy * width + xx) * 4;
      for (let c = 0; c < 4; c++) data[i + c] = Math.round(sums[c] / count);
    }
  }
}
// Three separable box passes approximate a Gaussian with linear cost per pixel.
// Tiles bound scratch memory; their halo includes the full kernel support so no
// tile boundary can affect output. Premultiplied channels prevent transparent
// pixels' hidden RGB from bleeding into visible edges.
function blurRadii(sigma: number): number[] {
  const ideal = Math.sqrt(4 * sigma * sigma + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return Array.from({ length: 3 }, (_, i) => ((i < count ? lower : upper) - 1) / 2);
}
function boxPass(input: Float32Array, output: Float32Array, width: number, height: number, radius: number, vertical: boolean): void {
  const length = vertical ? height : width, lines = vertical ? width : height;
  const stride = vertical ? width : 1, diameter = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const start = vertical ? line : line * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += input[start + Math.max(0, Math.min(length - 1, k)) * stride];
    for (let p = 0; p < length; p++) {
      output[start + p * stride] = sum / diameter;
      sum += input[start + Math.min(length - 1, p + radius + 1) * stride]
        - input[start + Math.max(0, p - radius) * stride];
    }
  }
}
export function gaussianBlur(data: Uint8ClampedArray, width: number, height: number, strength: number): void {
  if (width < 1 || height < 1 || data.length !== width * height * 4) return;
  const sigma = Number.isFinite(strength) ? Math.max(0.5, Math.min(20, strength)) : 1;
  const radii = blurRadii(sigma), halo = radii.reduce((a, b) => a + b, 0);
  const original = data.slice(), tileSize = 256;
  for (let top = 0; top < height; top += tileSize) for (let left = 0; left < width; left += tileSize) {
    const right = Math.min(width, left + tileSize), bottom = Math.min(height, top + tileSize);
    const x = Math.max(0, left - halo), y = Math.max(0, top - halo);
    const w = Math.min(width, right + halo) - x, h = Math.min(height, bottom + halo) - y;
    const a = new Float32Array(w * h), b = new Float32Array(w * h), alpha = new Float32Array(w * h);
    for (const channel of [3, 0, 1, 2]) {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const source = ((y + yy) * width + x + xx) * 4;
        a[yy * w + xx] = channel === 3 ? original[source + 3] : original[source + channel] * original[source + 3] / 255;
      }
      for (const radius of radii) {
        boxPass(a, b, w, h, radius, false);
        boxPass(b, a, w, h, radius, true);
      }
      if (channel === 3) alpha.set(a);
      for (let yy = top; yy < bottom; yy++) for (let xx = left; xx < right; xx++) {
        const local = (yy - y) * w + xx - x, target = (yy * width + xx) * 4;
        data[target + channel] = channel === 3 ? alpha[local] : alpha[local] > 0.0001 ? a[local] * 255 / alpha[local] : 0;
      }
    }
  }
}
export function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, crop: Bounds, source?: CanvasImageSource) {
  const first = mark.points[0], last = mark.points.at(-1);
  if (!first || !last) return;
  const box = rectBetween(first, last);
  if (mark.tool === "mosaic" || mark.tool === "blur") {
    const x = Math.max(0, Math.floor(box.x - crop.x)), y = Math.max(0, Math.floor(box.y - crop.y));
    const w = Math.min(crop.width, Math.ceil(box.x + box.width - crop.x)) - x;
    const h = Math.min(crop.height, Math.ceil(box.y + box.height - crop.y)) - y;
    if (w > 0 && h > 0) {
      if (mark.tool === "blur") {
        const strength = Number.isFinite(mark.width) ? Math.max(1, Math.min(20, mark.width)) : 1;
        const halo = blurRadii(strength).reduce((a, b) => a + b, 0);
        const readX = Math.max(0, x - halo), readY = Math.max(0, y - halo);
        const readW = Math.min(crop.width, x + w + halo) - readX, readH = Math.min(crop.height, y + h + halo) - readY;
        const pixels = ctx.getImageData(readX, readY, readW, readH);
        gaussianBlur(pixels.data, readW, readH, strength);
        // Only overwrite the selected rectangle, not its sampling halo.
        ctx.putImageData(pixels, readX, readY, x - readX, y - readY, w, h);
      } else {
        const pixels = ctx.getImageData(x, y, w, h);
        pixelate(pixels.data, w, h, Math.max(6, mark.width * 3));
        ctx.putImageData(pixels, x, y);
      }
    }
    return;
  }
  ctx.save();
  ctx.translate(-crop.x, -crop.y);
  if (mark.tool === "eraser") {
    if (source) {
      const radius = Math.max(1, mark.width * 3);
      ctx.beginPath();
      mark.points.forEach((point, index) => {
        ctx.moveTo(point.x + radius, point.y);
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        const previous = mark.points[index - 1];
        if (!previous) return;
        const dx = point.x - previous.x, dy = point.y - previous.y, length = Math.hypot(dx, dy);
        if (!length) return;
        const nx = -dy / length * radius, ny = dx / length * radius;
        ctx.moveTo(previous.x + nx, previous.y + ny);
        ctx.lineTo(previous.x - nx, previous.y - ny);
        ctx.lineTo(point.x - nx, point.y - ny);
        ctx.lineTo(point.x + nx, point.y + ny);
        ctx.closePath();
      });
      ctx.clip();
      // Copy also restores the original alpha. Source-over would leave prior
      // annotations behind wherever the original image is transparent.
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, crop.x, crop.y, crop.width, crop.height);
    }
    ctx.restore();
    return;
  }
  ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color;
  ctx.lineWidth = mark.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  if (mark.tool === "redact") ctx.fillRect(Math.floor(box.x), Math.floor(box.y), Math.ceil(box.width) + 1, Math.ceil(box.height) + 1);
  else if (mark.tool === "rect") { ctx.rect(box.x, box.y, box.width, box.height); ctx.stroke(); }
  else if (mark.tool === "ellipse") { ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
  else if (mark.tool === "text") {
    const fontSize = Number.isFinite(mark.fontSize) ? Math.max(8, Math.min(256, mark.fontSize!)) : Math.max(16, mark.width * 6);
    const fontFamily = ["Segoe UI", "Microsoft YaHei", "Consolas"].includes(mark.fontFamily || "") ? `"${mark.fontFamily}", sans-serif` : '"Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.font = `600 ${fontSize}px ${fontFamily}`; ctx.textBaseline = "top";
    (mark.text || "").split("\n").forEach((line, index) => ctx.fillText(line, first.x, first.y + index * fontSize * 1.3));
  } else if (mark.tool === "step") {
    const radius = Math.max(13, mark.width * 4);
    ctx.arc(first.x, first.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1.5, mark.width / 2); ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.font = `700 ${radius * 1.15}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(mark.number || 1), first.x, first.y);
  } else {
    if (mark.tool === "highlight") { ctx.globalAlpha = 0.32; ctx.lineWidth = mark.width * 6; ctx.lineCap = "butt"; }
    ctx.moveTo(first.x, first.y);
    if (mark.tool === "pen" || mark.tool === "highlight") {
      mark.points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
      if (mark.points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
    } else ctx.lineTo(last.x, last.y);
    if (mark.tool === "arrow") {
      const angle = Math.atan2(last.y - first.y, last.x - first.x), length = Math.max(12, mark.width * 4);
      ctx.moveTo(last.x - length * Math.cos(angle - Math.PI / 6), last.y - length * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(last.x, last.y); ctx.lineTo(last.x - length * Math.cos(angle + Math.PI / 6), last.y - length * Math.sin(angle + Math.PI / 6));
    }
    ctx.stroke();
  }
  ctx.restore();
}
const renderSurfaces = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function renderDocument(canvas: HTMLCanvasElement, image: HTMLImageElement, doc: ImageDocument, extra?: Mark) {
  const { crop } = doc;
  if (canvas.width !== crop.width) canvas.width = crop.width;
  if (canvas.height !== crop.height) canvas.height = crop.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建图片画布");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const marks = extra ? [...doc.marks, extra] : doc.marks;
  // Earlier blur operations must retain their surrounding pixels after a crop.
  // A halo for every blur also covers chained filters; cap naturally at the image.
  const halo = marks.reduce((sum, mark) => sum + (mark.tool === "blur"
    ? blurRadii(Number.isFinite(mark.width) ? Math.max(1, Math.min(20, mark.width)) : 1).reduce((a, b) => a + b, 0) : 0), 0);
  const sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
  const left = Math.max(0, crop.x - halo), top = Math.max(0, crop.y - halo);
  const bounds = { x: left, y: top, width: Math.min(sourceWidth, crop.x + crop.width + halo) - left,
    height: Math.min(sourceHeight, crop.y + crop.height + halo) - top };
  const padded = halo > 0 && (bounds.x !== crop.x || bounds.y !== crop.y || bounds.width !== crop.width || bounds.height !== crop.height);
  let target = ctx;
  if (padded) {
    let surface = renderSurfaces.get(canvas);
    if (!surface) { surface = canvas.ownerDocument.createElement("canvas"); renderSurfaces.set(canvas, surface); }
    if (surface.width !== bounds.width) surface.width = bounds.width;
    if (surface.height !== bounds.height) surface.height = bounds.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建模糊处理画布");
    target = context;
    target.clearRect(0, 0, bounds.width, bounds.height);
  }
  const region = padded ? bounds : crop;
  target.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  marks.forEach(mark => drawMark(target, mark, region, image));
  if (padded) ctx.drawImage(target.canvas, crop.x - region.x, crop.y - region.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
}
