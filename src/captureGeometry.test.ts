import { describe, expect, it } from 'vitest';
import { between, moveRect, resizeRect, toPixels, monitorAt, fitPanel, containedScale, remapViewportRect } from './captureGeometry';
describe('native capture geometry', () => {
  it('normalizes reverse drags and clips to screenshot bounds', () => {
    expect(between({x:140,y:80},{x:-20,y:15},120,100)).toEqual({x:0,y:15,width:120,height:65});
  });
  it('maps viewport to physical pixels independently on each axis', () => {
    expect(toPixels({x:100,y:50,width:200,height:100},1000,500,1500,1000)).toEqual({x:150,y:100,width:300,height:200});
  });
  it('rounds shared edges without creating pixels outside the screen', () => {
    expect(toPixels({x:999.4,y:499.2,width:1,height:1},1000,500,1500,750)).toEqual({x:1499,y:749,width:1,height:1});
  });
  it('moves selection without changing dimensions at desktop edges', () => {
    expect(moveRect({x:30,y:30,width:40,height:20},100,-100,100,80)).toEqual({x:60,y:0,width:40,height:20});
  });
  it('allows handles to cross opposite edge without negative dimensions', () => {
    expect(resizeRect({x:20,y:20,width:40,height:40},'nw',{x:80,y:90},100,100)).toEqual({x:60,y:60,width:20,height:30});
  });
  it('keeps floating controls on a real monitor on a staggered desktop', () => {
    const monitors=[{x:0,y:0,width:1920,height:1080},{x:1920,y:500,width:1920,height:1080}];
    const monitor=monitorAt({x:1800,y:1070},monitors);
    expect(fitPanel({x:1600,y:1090},378,50,monitor)).toEqual({x:1534,y:1022});
    expect(monitorAt({x:1300,y:1400},monitors)).toEqual(monitors[0]);
    expect(fitPanel({x:2000,y:450},220,140,monitors[1])).toEqual({x:2000,y:508});
  });
  it('reports contained image scale after arbitrary native window resizing',()=>{
    expect(containedScale(200,72,200,20)).toBe(1);
    expect(containedScale(600,200,200,100,1.5)).toBe(3);
  });
});

describe('simulated mixed-DPI virtual desktops (not hardware verification)',()=>{
  for(const scale of [1,1.25,1.5,2]) {
    it(`preserves negative-origin crop pixels at ${scale*100}% viewport scale`,()=>{
      const origin={x:-2560,y:-1440};const desktop={width:6400,height:3600};
      const global={x:-2017,y:-921,width:1013,height:577};
      const local={...global,x:global.x-origin.x,y:global.y-origin.y};
      const css={x:local.x/scale,y:local.y/scale,width:local.width/scale,height:local.height/scale};
      expect(toPixels(css,desktop.width/scale,desktop.height/scale,desktop.width,desktop.height)).toEqual(local);
      for(const nextScale of [1,1.25,1.5,2]) {
        const resized=remapViewportRect(css,desktop.width/scale,desktop.height/scale,desktop.width/nextScale,desktop.height/nextScale);
        expect(toPixels(resized,desktop.width/nextScale,desktop.height/nextScale,desktop.width,desktop.height)).toEqual(local);
      }
    });
  }
  it('keeps controls on real negative-coordinate screens at every scale',()=>{
    const physical=[{x:-1920,y:-1080,width:1920,height:1080},{x:0,y:0,width:2560,height:1440}];
    for(const scale of [1,1.25,1.5,2]) {
      const monitors=physical.map(m=>({x:m.x/scale,y:m.y/scale,width:m.width/scale,height:m.height/scale}));
      const point={x:-20/scale,y:-30/scale};const monitor=monitorAt(point,monitors);
      const panel=fitPanel(point,378,50,monitor,8);
      expect(monitor).toEqual(monitors[0]);expect(panel.x).toBeGreaterThanOrEqual(monitor.x+8);
      expect(panel.y).toBeGreaterThanOrEqual(monitor.y+8);expect(panel.x+378).toBeLessThanOrEqual(0);
      expect(panel.y+50).toBeLessThanOrEqual(0);
    }
  });
});
