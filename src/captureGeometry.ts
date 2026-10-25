export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));
export function between(a: Point, b: Point, width: number, height: number): Rect {
  const x1 = clamp(a.x, 0, width), x2 = clamp(b.x, 0, width);
  const y1 = clamp(a.y, 0, height), y2 = clamp(b.y, 0, height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export function toPixels(rect: Rect, viewWidth: number, viewHeight: number, imageWidth: number, imageHeight: number): Rect {
  const x = clamp(Math.round(rect.x * imageWidth / viewWidth), 0, imageWidth);
  const y = clamp(Math.round(rect.y * imageHeight / viewHeight), 0, imageHeight);
  const right = clamp(Math.round((rect.x + rect.width) * imageWidth / viewWidth), x, imageWidth);
  const bottom = clamp(Math.round((rect.y + rect.height) * imageHeight / viewHeight), y, imageHeight);
  return { x, y, width: right - x, height: bottom - y };
}
export function moveRect(rect: Rect, dx: number, dy: number, width: number, height: number): Rect {
  return { ...rect, x: clamp(rect.x + dx, 0, width - rect.width), y: clamp(rect.y + dy, 0, height - rect.height) };
}
export function resizeRect(rect: Rect, handle: string, point: Point, width: number, height: number): Rect {
  const a = { x: rect.x, y: rect.y }, b = { x: rect.x + rect.width, y: rect.y + rect.height };
  if (handle.includes('w')) a.x = point.x;
  if (handle.includes('e')) b.x = point.x;
  if (handle.includes('n')) a.y = point.y;
  if (handle.includes('s')) b.y = point.y;
  return between(a, b, width, height);
}
/** Pick the nearest real monitor, even if the point is in a virtual-desktop gap. */
export function monitorAt(point: Point, monitors: Rect[]): Rect {
  return monitors.reduce((best, rect) => {
    const distance = (r: Rect) => Math.hypot(point.x-clamp(point.x,r.x,r.x+r.width),point.y-clamp(point.y,r.y,r.y+r.height));
    return distance(rect) < distance(best) ? rect : best;
  }, monitors[0]);
}
export function fitPanel(point: Point, panelWidth: number, panelHeight: number, monitor: Rect, margin = 8): Point {
  return {
    x:clamp(point.x,monitor.x+margin,Math.max(monitor.x+margin,monitor.x+monitor.width-panelWidth-margin)),
    y:clamp(point.y,monitor.y+margin,Math.max(monitor.y+margin,monitor.y+monitor.height-panelHeight-margin)),
  };
}
export function containedScale(viewWidth:number,viewHeight:number,imageWidth:number,imageHeight:number,dpr=1):number {
  return Math.min(viewWidth/imageWidth,viewHeight/imageHeight)*dpr;
}

/** Preserve an existing physical selection if WebView DPI/viewport dimensions change. */
export function remapViewportRect(rect:Rect,oldWidth:number,oldHeight:number,newWidth:number,newHeight:number):Rect {
  if(oldWidth<=0||oldHeight<=0||newWidth<=0||newHeight<=0)return rect;
  return {x:rect.x*newWidth/oldWidth,y:rect.y*newHeight/oldHeight,width:rect.width*newWidth/oldWidth,height:rect.height*newHeight/oldHeight};
}
