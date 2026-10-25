import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Download, Pencil, X, Minus, Plus, MoreHorizontal, Maximize2 } from './icons';
import type { AppSnapshot, Capture, Settings } from './model';
import { clamp, containedScale, type Point } from './captureGeometry';
import { PinDrag, PinPointerGesture, collapsedPinScale, zoomPinScale, wheelSteps } from './pinInteraction';
import { createPinNativeMenu, PinMenuController, type PinMenuAction, type PinMenuState } from './pinNativeMenu';
import './pin/pin.css';

type DoubleClickAction = Settings['pinDoubleClickAction'];
export default function PinWindow() {
  const id = new URLSearchParams(location.search).get('id') || '';
  const [item,setItem] = useState<Capture | null>(null);
  const [error,setError] = useState('');
  const [scale,setScale] = useState(1);
  const [opacity,setOpacity] = useState(1);
  const [message,setMessage] = useState('');
  const [controlsOpen,setControlsOpen] = useState(false);
  const [dragging,setDragging] = useState(false);
  const [collapsed,setCollapsed] = useState(false);
  const [doubleClickAction,setDoubleClickAction] = useState<DoubleClickAction>('close');
  const menu = useRef<PinMenuController | null>(null);
  const menuState = useRef<PinMenuState>({collapsed,opacity,doubleClickAction});
  menuState.current={collapsed,opacity,doubleClickAction};
  const menuDispatch = useRef<(action:PinMenuAction)=>void>(()=>{});
  const controls = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(1), opacityRef = useRef(1), restoreScale = useRef<number | null>(null);
  const collapseBusy = useRef(false), settingBusy = useRef(false);
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<PinDrag | null>(null), gesture = useRef(new PinPointerGesture());
  const press = useRef<{id:number;client:Point;dpr:number} | null>(null);
  const run = useCallback(async (command:string,args?:Record<string,unknown>) => {
    try { setError(''); await invoke(command,args); return true; }
    catch(e) { setError(String(e)); return false; }
  },[]);
  const announce = useCallback((text:string)=>{
    setMessage(text);clearTimeout(timer.current);timer.current=setTimeout(()=>setMessage(''),1600);
  },[]);
  const resize = useCallback((next:number)=>{
    // A very small source can appear above 500% because of the native minimum size.
    // Sending the capped ratio still recreates that same minimum-sized window.
    const result=resizeQueue.current.then(()=>run('resize_pin',{scale:clamp(next,0.001,5)}));
    resizeQueue.current=result;
    return result;
  },[run]);
  const zoom = useCallback((factor:number,reset=false) => {
    if(collapseBusy.current)return;
    // Manual zoom exits thumbnail mode and starts from the scale saved before collapse.
    const next=zoomPinScale(scaleRef.current,restoreScale.current,factor,reset);
    restoreScale.current=null;setCollapsed(false);
    scaleRef.current=next;setScale(next);void resize(next);
  },[resize]);
  const toggleCollapsed = useCallback(async()=>{
    if(!item||collapseBusy.current)return;
    collapseBusy.current=true;
    const previous=scaleRef.current;
    const restoring=restoreScale.current!==null;
    const next=restoreScale.current??collapsedPinScale(item.width,item.height,devicePixelRatio,previous);
    setControlsOpen(false);
    if(await resize(next)) {
      restoreScale.current=restoring?null:previous;setCollapsed(!restoring);
    }
    collapseBusy.current=false;
  },[item,resize]);
  const changeOpacity = useCallback((value:number) => {
    const next=clamp(value,0.15,1);opacityRef.current=next;setOpacity(next);void run('set_pin_opacity',{opacity:next});
  },[run]);
  const copy = useCallback(async()=>{
    if(await run('copy_item',{id}))announce('已复制');
  },[run,id,announce]);
  const edit = async()=>{
    try {
      setError('');await invoke('show_main');await emitTo('main','preview-item',{id});await invoke('close_pin');
    } catch(e) {setError(String(e));}
  };
  const changeDoubleClick = async(action:DoubleClickAction)=>{
    if(settingBusy.current)return;
    settingBusy.current=true;
    try {
      const state=await invoke<AppSnapshot>('set_pin_double_click_action',{action});
      setDoubleClickAction(state.settings.pinDoubleClickAction);
      announce(action==='close'?'双击关闭':action==='collapse'?'双击收起 / 展开':'已禁用双击');
    }catch(e){setError(String(e));}
    finally{settingBusy.current=false;}
  };
  menuDispatch.current=action=>{
    if(action==='copy')void copy();
    else if(action==='save')void run('export_item',{id});
    else if(action==='edit')void edit();
    else if(action==='actual')zoom(1,true);
    else if(action==='collapse')void toggleCollapsed();
    else if(action==='close')void run('close_pin');
    else if(action.startsWith('opacity:'))changeOpacity(Number(action.slice(8)));
    else if(action.startsWith('double:'))void changeDoubleClick(action.slice(7) as DoubleClickAction);
  };
  const openMenu = useCallback((point:Point)=>{
    setControlsOpen(false);
    void menu.current?.show(point).catch(e=>setError(String(e)));
  },[]);
  useEffect(()=>{
    let stopped=false;
    const controller=new PinMenuController(
      ()=>createPinNativeMenu(action=>{if(!stopped)menuDispatch.current(action);}),
      ()=>menuState.current,
    );
    menu.current=controller;
    return()=>{stopped=true;controller.dispose();if(menu.current===controller)menu.current=null;};
  },[id]);
  const startPress = (event:PointerEvent<HTMLImageElement>) => {
    if(event.button!==0)return;
    setControlsOpen(false);menu.current?.cancelPending();
    image.current?.focus({preventScroll:true});
    drag.current?.dispose();drag.current=null;
    // Do not preventDefault or capture on a click: Chromium must deliver native dblclick.
    gesture.current.begin({x:event.screenX,y:event.screenY});
    press.current={id:event.pointerId,client:{x:event.clientX,y:event.clientY},dpr:devicePixelRatio};
  };
  const movePress = (event:PointerEvent<HTMLImageElement>) => {
    const initial=press.current;
    if(!initial||initial.id!==event.pointerId||!(event.buttons&1))return;
    if(!gesture.current.move({x:event.screenX,y:event.screenY}))return;
    event.preventDefault();
    if(!drag.current) {
      event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
      drag.current=new PinDrag(
        invoke<Point>('get_pin_drag_anchor',{clientX:initial.client.x,clientY:initial.client.y,scale:initial.dpr}),
        (anchor,cursor)=>invoke('move_pin_to_cursor',{anchor,cursor}),e=>setError(String(e)),()=>invoke<Point>('get_cursor_position'));
    }
    drag.current.update();
  };
  const finishPress = (event:PointerEvent<HTMLImageElement>,cancelled=false) => {
    if(press.current?.id!==event.pointerId)return;
    gesture.current.end(cancelled);press.current=null;
    drag.current?.finish();setDragging(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const doubleClick = ()=>{
    if(!gesture.current.allowsDoubleClick()||collapseBusy.current)return;
    if(restoreScale.current!==null||doubleClickAction==='collapse')void toggleCollapsed();
    else if(doubleClickAction==='close')void run('close_pin');
  };
  useEffect(()=>{
    document.documentElement.classList.add('pin-document');
    let stopped=false,unlisten:(()=>void)|undefined;
    void listen<AppSnapshot>('library-changed',event=>{
      if(!stopped)setDoubleClickAction(event.payload.settings.pinDoubleClickAction??'close');
    }).then(stop=>{if(stopped)stop();else unlisten=stop;}).catch(e=>setError(String(e)));
    void invoke<AppSnapshot>('get_state').then(state=>{
      if(stopped)return;
      setDoubleClickAction(state.settings.pinDoubleClickAction??'close');
      const found=state.items.find(i=>i.id===id);
      if(found){setItem(found);const initial=containedScale(innerWidth,innerHeight,found.width,found.height,devicePixelRatio);scaleRef.current=initial;setScale(initial);}
      else setError('图片已从图库移除');
    }).catch(e=>setError(String(e)));
    return()=>{stopped=true;unlisten?.();drag.current?.dispose();clearTimeout(timer.current);document.documentElement.classList.remove('pin-document');};
  },[id]);
  useEffect(()=>{
    let stopped=false,unlisten:(()=>void)|undefined;
    // A repeated capture can deduplicate to this existing window. Rust restores
    // its exact source rectangle; discard any previous thumbnail/dimming state.
    void listen('pin-capture-reset',()=>{
      if(stopped)return;
      drag.current?.dispose();drag.current=null;press.current=null;gesture.current.end(true);
      restoreScale.current=null;scaleRef.current=1;opacityRef.current=1;
      setCollapsed(false);setScale(1);setOpacity(1);setDragging(false);
      setControlsOpen(false);menu.current?.cancelPending();setError('');setMessage('');clearTimeout(timer.current);
    }).then(stop=>{if(stopped)stop();else unlisten=stop;}).catch(e=>setError(String(e)));
    return()=>{stopped=true;unlisten?.();};
  },[]);
  useEffect(()=>{
    if(!item)return;
    let stopped=false,unlisten:(()=>void)|undefined;
    const update=(width:number,height:number,dpr=1)=>{
      if(stopped)return;
      const actual=containedScale(width,height,item.width,item.height,dpr);scaleRef.current=actual;setScale(actual);
    };
    const resized=()=>update(innerWidth,innerHeight,devicePixelRatio);
    window.addEventListener('resize',resized);
    void getCurrentWindow().onResized(event=>update(event.payload.width,event.payload.height)).then(stop=>{if(stopped)stop();else unlisten=stop;}).catch(e=>setError(String(e)));
    return()=>{stopped=true;unlisten?.();window.removeEventListener('resize',resized);};
  },[item]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.shiftKey&&e.key==='F10')||e.key==='ContextMenu'){
        e.preventDefault();openMenu({x:innerWidth/2,y:innerHeight/2});return;
      }
      if(e.key==='Tab'&&!controlsOpen){
        e.preventDefault();setControlsOpen(true);
        requestAnimationFrame(()=>{
          const targets=controls.current?.querySelectorAll<HTMLElement>('button,input');
          if(targets?.length)targets[e.shiftKey?targets.length-1:0].focus();
        });return;
      }
      if(e.key==='Escape'){
        e.preventDefault();
        // Windows consumes the first Esc in its native menu loop. Its held-key
        // repeats must not close the pin after that menu has disappeared.
        if(e.repeat||menu.current?.cancelPending())return;
        void run('close_pin');
      }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'){e.preventDefault();void copy();}
      if(e.key==='+'||e.key==='='){e.preventDefault();if(e.ctrlKey)changeOpacity(opacityRef.current+0.05);else zoom(1.1);}
      if(e.key==='-'){e.preventDefault();if(e.ctrlKey)changeOpacity(opacityRef.current-0.05);else zoom(1/1.1);}
      if(e.key==='0'){e.preventDefault();zoom(1,true);}
    };
    const wheel=(e:WheelEvent)=>{
      if(e.target instanceof Element&&e.target.closest('.pin-controls')){
        if(e.ctrlKey)e.preventDefault();return;
      }
      e.preventDefault();
      const steps=wheelSteps(e.deltaY,e.deltaMode);
      if(!steps)return;
      if(e.ctrlKey)changeOpacity(opacityRef.current+steps*0.05);else zoom(1.1**steps);
    };
    const blur=()=>{setControlsOpen(false);menu.current?.cancelPending();gesture.current.end(true);press.current=null;drag.current?.finish();setDragging(false);};
    window.addEventListener('keydown',key);window.addEventListener('wheel',wheel,{passive:false});window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('wheel',wheel);window.removeEventListener('blur',blur);};
  },[copy,run,zoom,changeOpacity,controlsOpen,openMenu]);
  return <main className={`pin-window pin-polished${dragging?' is-dragging':''}${controlsOpen?' controls-open':''}`} aria-label="屏幕贴图"
    onContextMenu={event=>{event.preventDefault();openMenu({x:event.clientX,y:event.clientY});}}>
    {item&&<img ref={image} className="pinned-image" src={convertFileSrc(item.path)} alt={item.name} draggable={false} tabIndex={-1}
      onPointerDown={startPress} onPointerMove={movePress} onPointerUp={event=>finishPress(event)} onPointerCancel={event=>finishPress(event,true)} onLostPointerCapture={event=>finishPress(event,true)}
      onDoubleClick={doubleClick} onError={()=>setError('无法加载图片，请从图库重新贴图。')}/>}
    <div className="pin-triggers">
      <button title="贴图工具 (Tab) · 右键更多操作" aria-label="贴图工具" aria-expanded={controlsOpen} aria-controls="pin-controls" onClick={()=>{setControlsOpen(open=>!open);}}><MoreHorizontal size={16}/></button>
      <button title="关闭贴图 (Esc)" aria-label="关闭贴图" onClick={()=>void run('close_pin')}><X size={14}/></button>
    </div>
    {collapsed&&<button className="pin-restore" title="展开到收起前大小" aria-label="展开贴图" onClick={()=>void toggleCollapsed()}><Maximize2 size={13}/><span>展开</span></button>}
    <div id="pin-controls" ref={controls} className="pin-controls" role="group" aria-label="贴图工具面板" hidden={!controlsOpen}>
      <div className="pin-control-row">
        <button title="复制 (Ctrl+C)" aria-label="复制贴图" onClick={()=>void copy()}><Copy size={15}/></button>
        <button title="另存为" aria-label="保存贴图" onClick={()=>void run('export_item',{id})}><Download size={15}/></button>
        <button title="再次标注" aria-label="标注贴图" onClick={()=>void edit()}><Pencil size={15}/></button>
      </div>
      <div className="pin-control-row pin-zoom-row">
        <button title="缩小 (-)" aria-label="缩小贴图" onClick={()=>zoom(1/1.1)}><Minus size={15}/></button>
        <button className="pin-scale" title="原始大小 (0)" aria-label="恢复贴图原始大小" onClick={()=>zoom(1,true)}>{Math.round(scale*100)}%</button>
        <button title="放大 (+)" aria-label="放大贴图" onClick={()=>zoom(1.1)}><Plus size={15}/></button>
      </div>
      <label className="pin-opacity-label" htmlFor="pin-opacity">透明度 <output>{Math.round(opacity*100)}%</output></label>
      <input id="pin-opacity" className="pin-opacity" type="range" min="15" max="100" value={Math.round(opacity*100)} aria-label="贴图透明度" title="Ctrl+滚轮 / Ctrl +/-" onChange={e=>changeOpacity(Number(e.target.value)/100)}/>
      <button className="pin-panel-more" aria-label="更多贴图操作" aria-haspopup="menu" title="右键 / Shift+F10" onClick={()=>openMenu({x:Math.max(0,innerWidth-12),y:32})}><MoreHorizontal size={14}/><span>更多操作</span></button>
    </div>
    {message&&<div className="pin-message" role="status">{message}</div>}
    {error&&<div className="pin-error" role="alert">{error}<button onClick={()=>void run('close_pin')}>关闭</button></div>}
  </main>;
}
