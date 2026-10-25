import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinDrag, PinPointerGesture, collapsedPinScale, pinMenuBounds, zoomPinScale, wheelSteps } from './pinInteraction';
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
afterEach(()=>vi.unstubAllGlobals());
describe('pin interactions',()=>{
  it('flushes a release received before native anchor initialization',async()=>{
    let ready!:(value:{x:number;y:number})=>void;
    const initial=new Promise<{x:number;y:number}>(resolve=>{ready=resolve;});
    const move=vi.fn(async()=>{});
    const drag=new PinDrag(initial,move,vi.fn(),async()=>({x:-450,y:100}));
    drag.finish();ready({x:180,y:90});await tick();
    expect(move).toHaveBeenCalledExactlyOnceWith({x:180,y:90},{x:-450,y:100});
  });
  it('serializes native cursor sampling and never loses release behind a slow move',async()=>{
    vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{queueMicrotask(callback);return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
    let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const move=vi.fn().mockImplementationOnce(()=>pending).mockResolvedValue(undefined);
    let cursor={x:-200,y:300};
    const snapshot=vi.fn(async()=>({...cursor}));
    const drag=new PinDrag(Promise.resolve({x:120,y:60}),move,vi.fn(),snapshot);
    await tick();drag.update();await tick();
    drag.update();drag.update();drag.finish();expect(move).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);cursor={x:900,y:800};
    drag.finish();expect(snapshot).toHaveBeenCalledTimes(1);
    release();await tick();expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenLastCalledWith({x:120,y:60},{x:-200,y:300});
  });
  it('disposes pending initialization when a pin closes',async()=>{
    const move=vi.fn(async()=>{});const drag=new PinDrag(Promise.resolve({x:10,y:10}),move,vi.fn(),async()=>({x:20,y:20}));
    drag.finish();drag.dispose();await tick();expect(move).not.toHaveBeenCalled();
  });
  it('normalizes wheel units and preserves tiny touchpad deltas',()=>{
    expect(wheelSteps(-120,0)).toBe(1);expect(wheelSteps(-3,1)).toBe(1);
    expect(wheelSteps(-1,2)).toBe(1);expect(wheelSteps(-1,0)).toBeCloseTo(1/120);
    expect(wheelSteps(-10000,0)).toBe(4);expect(wheelSteps(0,0)).toBe(0);
  });
});

describe('pin click, thumbnail and menu boundaries',()=>{
  it('keeps small pointer jitter as a click without starting a native drag',()=>{
    const gesture=new PinPointerGesture();
    for(let click=0;click<2;click++) {
      gesture.begin({x:-100,y:200});
      expect(gesture.move({x:-98,y:202})).toBe(false);
      expect(gesture.end()).toBe(false);
    }
    expect(gesture.allowsDoubleClick()).toBe(true);
  });
  it('does not close on drag plus click, but allows a later genuine double click',()=>{
    const gesture=new PinPointerGesture();
    gesture.begin({x:100,y:100});expect(gesture.move({x:104,y:100})).toBe(true);
    // Moving back to the origin cannot turn a drag back into a click.
    expect(gesture.move({x:100,y:100})).toBe(true);expect(gesture.end()).toBe(true);
    gesture.begin({x:100,y:100});gesture.end();expect(gesture.allowsDoubleClick()).toBe(false);
    gesture.begin({x:100,y:100});gesture.end();expect(gesture.allowsDoubleClick()).toBe(true);
  });
  it('invalidates cancelled presses and ignores the duplicate lost-capture release',()=>{
    const gesture=new PinPointerGesture();
    gesture.begin({x:1,y:1});gesture.end(true);
    gesture.begin({x:1,y:1});gesture.end();gesture.end();
    expect(gesture.allowsDoubleClick()).toBe(false);
  });
  it('fits large images into thumbnail CSS bounds at multiple DPI scales',()=>{
    for(const dpr of [1,1.25,1.5,2]) {
      const ratio=collapsedPinScale(8000,4500,dpr,0.5);
      expect(8000*ratio/dpr).toBeCloseTo(160);
      expect(4500*ratio/dpr).toBeCloseTo(90);
    }
    expect(collapsedPinScale(100,80,1,1)).toBe(1); // Never enlarge an already small image.
    expect(collapsedPinScale(4000,3000,1,0.02)).toBe(0.02);
  });
  it('uses the saved pre-collapse size for manual zoom and resets to natural pixels',()=>{
    expect(zoomPinScale(0.02,0.75,1.1)).toBeCloseTo(0.825);
    expect(zoomPinScale(0.02,0.75,1,true)).toBe(1);
    expect(zoomPinScale(0.75,null,1/1.1)).toBeCloseTo(0.75/1.1);
    expect(zoomPinScale(0.02,4,1.1)).toBe(4);
  });
  it('keeps an edge-opened menu wholly inside tiny and regular pin viewports',()=>{
    for(const [width,height] of [[96,72],[160,100],[800,600]]) {
      for(const point of [{x:width-1,y:height-1},{x:-30,y:-40}]) {
        const menu=pinMenuBounds(point,width,height);
        expect(menu.x).toBeGreaterThanOrEqual(4);expect(menu.y).toBeGreaterThanOrEqual(4);
        expect(menu.x+menu.width).toBeLessThanOrEqual(width-4);
        expect(menu.y+menu.maxHeight).toBeLessThanOrEqual(height-4);
      }
    }
  });
});
