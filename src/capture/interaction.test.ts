import { describe, expect, it } from 'vitest';
import { captureShortcutInput, constrainPoint, imagePosition, shortcutIntent, textDismissal, toolbarPosition } from './interaction';
describe('capture keyboard routing',()=>{
  it('protects closed custom font comboboxes from capture shortcuts just like native selects',()=>{
    for(const [tag,role] of [['BUTTON','combobox'],['SELECT',null],['INPUT',null]] as const){
      const input=captureShortcutInput(tag,role,false);
      for(const key of ['c','s','t','z','y','a']) expect(shortcutIntent(key,true,false,input,false,true)).toBeNull();
      expect(shortcutIntent('Escape',false,false,input,false,true)).toEqual({kind:'escape'});
    }
    expect(captureShortcutInput('DIV',null,true)).toBe(true);
    expect(shortcutIntent('c',true,false,captureShortcutInput('BUTTON',null,false),false,true)).toEqual({kind:'copy'});
  });
  it('keeps IME, multiline text and clipboard editing away from capture completion',()=>{
    expect(shortcutIntent('Enter',false,false,true,true)).toBeNull();
    expect(shortcutIntent('Enter',false,false,true,false)).toBeNull();
    expect(shortcutIntent('c',true,false,true,false)).toBeNull();
    expect(shortcutIntent('Enter',true,false,true,false)).toEqual({kind:'text-confirm'});
    expect(shortcutIntent('Escape',false,false,true,false)).toEqual({kind:'escape'});
    expect(shortcutIntent('t',true,false,false,false)).toEqual({kind:'pin'});
    expect(shortcutIntent('z',true,true,false,false)).toEqual({kind:'redo'});
    expect(shortcutIntent('v',false,false,false,false)).toEqual({kind:'tool',tool:null});
  });
  it('lets focused toolbar buttons activate without prematurely copying or hiding the capture',()=>{
    expect(shortcutIntent('Enter',false,false,false,false,true)).toBeNull();
    expect(shortcutIntent(' ',false,false,false,false,true)).toBeNull();
    expect(shortcutIntent('Enter',false,false,false,false,false)).toEqual({kind:'copy'});
    expect(shortcutIntent(' ',false,false,false,false,false)).toEqual({kind:'toggle-toolbar'});
    expect(shortcutIntent(' ',false,false,true,false,false)).toBeNull();
    expect(shortcutIntent(']',false,false,false,false)).toEqual({kind:'width',delta:1});
    expect(shortcutIntent('[',false,false,false,false)).toEqual({kind:'width',delta:-1});
  });
  it('keeps right-click text completion distinct from Escape cancellation and active IME composition',()=>{
    expect(textDismissal('中文\n第二行',false,'finish')).toBe('commit');
    expect(textDismissal('中文',false,'cancel')).toBe('discard');
    expect(textDismissal('  \n ',false,'finish')).toBe('discard');
    expect(textDismissal('拼音候选',true,'finish')).toBe('defer');
  });
});
describe('capture annotation geometry',()=>{
  it('maps downscaled canvas pointer to original desktop coordinates inside a crop',()=>{
    expect(imagePosition({x:250,y:125},{width:1000,height:500},{width:2000,height:1000},{x:400,y:200,width:400,height:300})).toEqual({x:500,y:250});
    expect(imagePosition({x:0,y:500},{width:1000,height:500},{width:2000,height:1000},{x:400,y:200,width:400,height:300})).toEqual({x:400,y:500});
  });
  it('constrains reverse shapes to squares and lines to 45 degree angles',()=>{
    expect(constrainPoint({x:100,y:100},{x:50,y:80},'rect',true)).toEqual({x:50,y:50});
    const line=constrainPoint({x:0,y:0},{x:80,y:70},'arrow',true);
    expect(line.x).toBeCloseTo(line.y);
    expect(Math.hypot(line.x,line.y)).toBeCloseTo(Math.hypot(80,70));
  });
  it('preserves square and diagonal constraints when dragging against crop boundaries',()=>{
    const bounds={x:100,y:200,width:300,height:100},origin={x:200,y:250};
    expect(constrainPoint(origin,{x:390,y:270},'rect',true,bounds)).toEqual({x:250,y:300});
    expect(constrainPoint(origin,{x:150,y:210},'ellipse',true,bounds)).toEqual({x:150,y:200});
    const diagonal=constrainPoint(origin,{x:280,y:300},'line',true,bounds);
    expect(diagonal.x-origin.x).toBeCloseTo(diagonal.y-origin.y);
    expect(diagonal.y).toBeCloseTo(300);
  });
  it('positions actual toolbar size above bottom-edge selections and inside the target monitor',()=>{
    const panel={width:600,height:90}, monitor={x:1200,y:0,width:1280,height:720};
    expect(toolbarPosition({x:2200,y:550,width:200,height:150},panel,monitor)).toEqual({x:1800,y:450});
    const tiny=toolbarPosition({x:1200,y:0,width:30,height:25},panel,monitor);
    expect(tiny.x).toBe(1208);expect(tiny.y).toBe(35);
  });
});
