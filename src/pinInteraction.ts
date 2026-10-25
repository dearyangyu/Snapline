import { clamp, type Point } from './captureGeometry';
export function wheelSteps(delta: number, mode: number): number {
  if(!delta)return 0;
  return clamp(-delta * (mode === 1 ? 40 : mode === 2 ? 120 : 1) / 120, -4, 4);
}
/** Only real clicks may form a double-click; native window movement changes client coordinates. */
export class PinPointerGesture {
  private origin: Point | null = null;
  private moved = false;
  private recent: boolean[] = [];
  begin(screen: Point) {this.origin=screen;this.moved=false;}
  move(screen: Point): boolean {
    if(!this.origin)return false;
    if(Math.hypot(screen.x-this.origin.x,screen.y-this.origin.y)>=4)this.moved=true;
    return this.moved;
  }
  end(cancelled=false): boolean {
    if(!this.origin)return false;
    const wasDrag=this.moved;
    this.recent=[...this.recent.slice(-1),this.moved||cancelled];
    this.origin=null;this.moved=false;
    return wasDrag;
  }
  allowsDoubleClick(): boolean {return this.recent.length===2&&this.recent.every(moved=>!moved);}
}

/** Thumbnail bounds are CSS pixels, resize_pin receives a natural-image physical-pixel ratio. */
export function collapsedPinScale(width:number,height:number,dpr:number,currentScale:number):number {
  return clamp(Math.min(160*dpr/Math.max(1,width),100*dpr/Math.max(1,height),currentScale),0.001,5);
}
export function zoomPinScale(currentScale:number,savedScale:number|null,factor:number,reset=false):number {
  return reset?1:clamp((savedScale??currentScale)*factor,0.1,4);
}

/** Clip the whole menu to the pin viewport, including tiny 96×72 pins and a scrolled menu. */
export function pinMenuBounds(point:Point,viewWidth:number,viewHeight:number) {
  const width=Math.min(224,Math.max(1,viewWidth-8)),height=Math.min(480,Math.max(1,viewHeight-8));
  return {x:clamp(point.x,4,Math.max(4,viewWidth-width-4)),y:clamp(point.y,4,Math.max(4,viewHeight-height-4)),width,maxHeight:height};
}
/** Coalesces requests; Rust samples physical cursor coordinates, never CSS screenX. */
export class PinDrag {
  private anchor: Point | null = null;
  private pending = false;
  private finished = false;
  private disposed = false;
  private revision = 0;
  private sentRevision = 0;
  private frame: number | null = null;
  private finalCursor: Promise<Point> | null = null;
  constructor(initial:Promise<Point>, private move:(anchor:Point,cursor?:Point)=>Promise<void>, private error:(e:unknown)=>void, private readCursor:()=>Promise<Point>) {
    void initial.then(anchor=>{this.anchor=anchor;void this.flush();}).catch(error);
  }
  update() {
    if(this.finished||this.disposed)return;
    this.revision++;
    if(this.frame===null)this.frame=requestAnimationFrame(()=>{this.frame=null;void this.flush();});
  }
  finish() {
    if(this.finished||this.disposed)return;
    this.finished=true;
    // Snapshot release immediately, independently of any queued/slow move.
    this.finalCursor=this.readCursor();
    void this.finalCursor.catch(e=>{this.disposed=true;this.error(e);});
    this.revision++;
    if(this.frame!==null){cancelAnimationFrame(this.frame);this.frame=null;}
    void this.flush();
  }
  dispose() {this.disposed=true;if(this.frame!==null)cancelAnimationFrame(this.frame);}
  private async flush():Promise<void> {
    if(this.disposed||this.pending||!this.anchor||this.revision===this.sentRevision)return;
    this.sentRevision=this.revision;this.pending=true;
    try {
      const cursor=this.finished&&this.finalCursor?await this.finalCursor:undefined;
      if(!this.disposed)await this.move(this.anchor,cursor);
    }catch(e){this.disposed=true;this.error(e);}
    finally {this.pending=false;}
    if(!this.disposed)void this.flush();
  }
}
