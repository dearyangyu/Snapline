import { describe, expect, it, vi } from "vitest";
import { commit, createHistory, cropDocument, drawMark, gaussianBlur, imagePoint, pixelate, redo, renderDocument, undo, type Mark } from "./document";

describe("original-resolution annotation coordinates", () => {
  it("maps downscaled pointer coordinates into a cropped source, clamping captured pointer outside", () => {
    const display = { x: 40, y: 80, width: 500, height: 250 }, crop = { x: 200, y: 100, width: 2000, height: 1000 };
    expect(imagePoint({ x: 290, y: 205 }, display, crop)).toEqual({ x: 1200, y: 600 });
    expect(imagePoint({ x: -20, y: 900 }, display, crop)).toEqual({ x: 200, y: 1100 });
  });
  it("crops backwards drags at integer pixel edges while retaining original mark positions", () => {
    const start = createHistory(1200, 800).present;
    const mark: Mark = { tool: "arrow", color: "red", width: 4, points: [{ x: 250, y: 200 }, { x: 450, y: 300 }] };
    const annotated = { ...start, marks: [mark] };
    const cropped = cropDocument(annotated, { x: 900.4, y: 600.7 }, { x: 100.2, y: 80.1 });
    expect(cropped.crop).toEqual({ x: 100, y: 80, width: 801, height: 521 });
    expect(cropped.marks[0].points).toEqual(mark.points);
    const again = cropDocument(cropped, { x: -20, y: -20 }, { x: 500, y: 400 });
    expect(again.crop).toEqual({ x: 100, y: 80, width: 400, height: 320 });
    expect(cropDocument(again, { x: 150, y: 150 }, { x: 150, y: 150 })).toBe(again);
  });
});
describe("undo and redo document snapshots", () => {
  it("restores crop and marks together and discards obsolete redo after a new edit", () => {
    const start = createHistory(1000, 600);
    const marked = commit(start, { ...start.present, marks: [{ tool: "text", color: "blue", width: 3, points: [{ x: 200, y: 100 }], text: "keep" }] });
    const cropped = commit(marked, cropDocument(marked.present, { x: 100, y: 50 }, { x: 600, y: 450 }));
    expect(undo(cropped).present).toEqual(marked.present);
    expect(redo(undo(cropped)).present).toEqual(cropped.present);
    expect(undo(undo(cropped)).present).toEqual(start.present);
    const alternate = commit(undo(cropped), { ...marked.present, marks: [] });
    expect(alternate.future).toEqual([]);
    expect(redo(alternate)).toBe(alternate);
  });
});
describe("pixel mosaic", () => {
  it("replaces source pixels with block averages including partial edge blocks", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 20, 40, 255, 240, 100, 80, 255,
      100, 40, 80, 255, 200, 60, 120, 255, 160, 200, 160, 255,
    ]);
    pixelate(pixels, 3, 2, 2);
    expect(Array.from(pixels)).toEqual([
      100, 30, 60, 255, 100, 30, 60, 255, 200, 150, 120, 255,
      100, 30, 60, 255, 100, 30, 60, 255, 200, 150, 120, 255,
    ]);
  });
});

describe("pixel Gaussian approximation", () => {
  it("spreads an impulse symmetrically without changing opaque alpha", () => {
    const pixels = new Uint8ClampedArray(31 * 4);
    for (let x = 0; x < 31; x++) pixels[x * 4 + 3] = 255;
    pixels[15 * 4] = 255;
    gaussianBlur(pixels, 31, 1, 2);
    expect(pixels[15 * 4]).toBeGreaterThan(pixels[14 * 4]);
    expect(pixels[14 * 4]).toBeGreaterThan(0);
    expect(pixels[10 * 4]).toBe(0);
    for (let dx = 0; dx <= 5; dx++) expect(pixels[(15 - dx) * 4]).toBe(pixels[(15 + dx) * 4]);
    expect(Array.from(pixels).filter((_, index) => index % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    const energy = Array.from(pixels).filter((_, index) => index % 4 === 0).reduce((a, b) => a + b, 0);
    expect(Math.abs(energy - 255)).toBeLessThanOrEqual(5);
  });
  it("blurs premultiplied alpha without leaking invisible red into visible blue", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
    gaussianBlur(pixels, 3, 1, 1);
    expect(Array.from(pixels)).toEqual([0, 0, 255, 85, 0, 0, 255, 85, 0, 0, 255, 85]);
    const solid = new Uint8ClampedArray([10, 50, 90, 128]);
    gaussianBlur(solid, 1, 1, 20);
    expect(Array.from(solid)).toEqual([10, 50, 90, 128]);
  });
  it("has no seams when a kernel crosses the bounded scratch tile edge", () => {
    const pixels = new Uint8ClampedArray(550 * 4);
    for (let x = 0; x < 550; x++) pixels[x * 4 + 3] = 255;
    pixels[255 * 4] = 255; pixels[355 * 4] = 255;
    gaussianBlur(pixels, 550, 1, 4);
    for (let dx = -15; dx <= 15; dx++) expect(pixels[(255 + dx) * 4]).toBe(pixels[(355 + dx) * 4]);
  });
});

// A recording canvas checks renderer boundaries and composition order without
// depending on browser font rasterization; the filter itself is tested on pixels.
function recordingCanvas() {
  const stack: GlobalCompositeOperation[] = [];
  const draws: { source: CanvasImageSource; coordinates: number[]; operation: GlobalCompositeOperation }[] = [];
  const strokes: GlobalCompositeOperation[] = [];
  const ctx = {
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    font: "",
    save: vi.fn(() => stack.push(ctx.globalCompositeOperation)),
    restore: vi.fn(() => { ctx.globalCompositeOperation = stack.pop() || "source-over"; }),
    clearRect: vi.fn(), translate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    arc: vi.fn(), closePath: vi.fn(), clip: vi.fn(), rect: vi.fn(),
    stroke: vi.fn(() => strokes.push(ctx.globalCompositeOperation)),
    fillText: vi.fn(),
    drawImage: vi.fn((source: CanvasImageSource, ...coordinates: number[]) => draws.push({ source, coordinates, operation: ctx.globalCompositeOperation })),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })),
    putImageData: vi.fn(),
    canvas: null as unknown as HTMLCanvasElement,
  };
  const children: { canvas: HTMLCanvasElement; draws: typeof draws }[] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    ownerDocument: { createElement: () => { const child = recordingCanvas(); children.push(child); return child.canvas; } },
  } as unknown as HTMLCanvasElement;
  ctx.canvas = canvas;
  return { canvas, ctx, draws, strokes, children };
}

describe("crop-aware eraser and blur rendering", () => {
  const image = { naturalWidth: 40, naturalHeight: 40 } as HTMLImageElement;
  const eraser: Mark = { tool: "eraser", color: "red", width: 2, points: [{ x: 13, y: 14 }, { x: 20, y: 22 }, { x: 24, y: 17 }] };
  it("restores the original image under a continuous clipped stroke, including original alpha", () => {
    const { canvas, ctx, draws, strokes } = recordingCanvas();
    const pen: Mark = { tool: "pen", color: "blue", width: 3, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] };
    const marked = commit(createHistory(40, 40), { crop: { x: 10, y: 10, width: 20, height: 20 }, marks: [pen] });
    const history = commit(marked, { ...marked.present, marks: [pen, eraser] });
    renderDocument(canvas, image, history.present, pen);
    expect(draws.map(draw => draw.operation)).toEqual(["source-over", "copy"]);
    expect(draws[1]).toEqual({ source: image, coordinates: [10, 10, 20, 20, 10, 10, 20, 20], operation: "copy" });
    expect(ctx.translate).toHaveBeenCalledWith(-10, -10);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.closePath).toHaveBeenCalledTimes(2);
    expect(strokes).toEqual(["source-over", "source-over"]);
    // Only the initial document clear runs; erasing never clears a white/alpha hole.
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(undo(history).present.marks).toEqual([pen]);
    expect(redo(undo(history)).present.marks[1]).toEqual(eraser);
  });
  it("single-point erasing restores a round dab and safely no-ops without source pixels", () => {
    const { ctx, draws } = recordingCanvas();
    const mark = { ...eraser, points: [{ x: 10, y: 12 }] };
    drawMark(ctx as unknown as CanvasRenderingContext2D, mark, { x: 0, y: 0, width: 40, height: 40 }, image);
    expect(ctx.arc).toHaveBeenCalledWith(10, 12, 6, 0, Math.PI * 2);
    expect(draws).toHaveLength(1);
    drawMark(ctx as unknown as CanvasRenderingContext2D, mark, { x: 0, y: 0, width: 40, height: 40 });
    expect(draws).toHaveLength(1);
  });
  it("samples a halo but only writes selected blur pixels, including reversed cropped coordinates", () => {
    const { ctx } = recordingCanvas();
    drawMark(ctx as unknown as CanvasRenderingContext2D, { tool: "blur", color: "red", width: 2, points: [{ x: 25, y: 26 }, { x: 15, y: 16 }] }, { x: 10, y: 10, width: 20, height: 20 });
    expect(ctx.getImageData).toHaveBeenCalledWith(1, 2, 18, 18);
    const call = ctx.putImageData.mock.calls[0] as unknown[];
    expect(call.slice(1)).toEqual([1, 2, 4, 4, 10, 10]);
  });
  it("retains original neighboring pixels when a previously blurred image is cropped", () => {
    const { canvas, draws, children } = recordingCanvas();
    const mark: Mark = { tool: "blur", color: "red", width: 2, points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] };
    renderDocument(canvas, image, { crop: { x: 10, y: 10, width: 20, height: 20 }, marks: [mark] });
    expect(children).toHaveLength(1);
    expect(children[0].draws[0].coordinates).toEqual([6, 6, 28, 28, 0, 0, 28, 28]);
    expect(draws[0].coordinates).toEqual([4, 4, 20, 20, 0, 0, 20, 20]);
  });
  it("supports bounded explicit text fonts while preserving legacy defaults", () => {
    const { ctx } = recordingCanvas();
    const text: Mark = { tool: "text", color: "red", width: 4, points: [{ x: 2, y: 2 }], text: "中文" };
    const context = ctx as unknown as CanvasRenderingContext2D;
    drawMark(context, text, { x: 0, y: 0, width: 40, height: 40 });
    expect(ctx.font).toBe('600 24px "Segoe UI", "Microsoft YaHei", sans-serif');
    drawMark(context, { ...text, fontSize: 32, fontFamily: "Consolas" }, { x: 0, y: 0, width: 40, height: 40 });
    expect(ctx.font).toBe('600 32px "Consolas", sans-serif');
    drawMark(context, { ...text, fontSize: 900, fontFamily: "untrusted font" }, { x: 0, y: 0, width: 40, height: 40 });
    expect(ctx.font).toBe('600 256px "Segoe UI", "Microsoft YaHei", sans-serif');
  });
});
