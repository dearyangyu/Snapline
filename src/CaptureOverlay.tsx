import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, X } from './icons';
import { presentPreparedCapture } from './capture/startup';
import { between, clamp, moveRect, resizeRect, toPixels, monitorAt, fitPanel, remapViewportRect, type Point, type Rect } from './captureGeometry';
import { commit, createHistory, redo, renderDocument, undo, type History, type Mark } from './editor/document';
import { CaptureTools, type TextStyle } from './capture/CaptureTools';
import { captureShortcutInput, constrainPoint, imagePosition, shortcutIntent, textDismissal, toolbarPosition, type CaptureTool } from './capture/interaction';
import { LOUPE_IMAGE_HEIGHT, LOUPE_WIDTH, LOUPE_ZOOM, loupeBackground, loupePosition, loupeSample } from './capture/loupe';
import './capture/capture.css';
interface Session { sessionId:string; dataUrl:string; width:number; height:number; originX:number; originY:number; monitors:Rect[];cursor:Point|null }
type Action='copy'|'pin'|'save';
type Draft=Omit<Mark,'tool'> & {tool:CaptureTool};
export default function CaptureOverlay() {
  const sessionId=useRef(new URLSearchParams(location.search).get('session')||'').current;
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [selection,setSelection]=useState<Rect|null>(null),[cursor,setCursor]=useState<Point>({x:0,y:0}),[cursorMoved,setCursorMoved]=useState(false);
  const [pixel,setPixel]=useState<{source:Point;hex:string;rgb:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false);
  const [tool,setTool]=useState<CaptureTool|null>(null),[color,setColor]=useState('#ee4e43'),[strokeWidth,setStrokeWidth]=useState(4);
  const [textStyle,setTextStyle]=useState<TextStyle>({fontSize:24,fontFamily:'Microsoft YaHei'});
  const [textEntry,setTextEntry]=useState<{point:Point;text:string}|null>(null);
  const [history,setHistory]=useState<History>(()=>createHistory(1,1));
  const [toolbarVisible,setToolbarVisible]=useState(true),[textPanelSize,setTextPanelSize]=useState({width:300,height:130});
  const [viewport,setViewport]=useState({width:innerWidth,height:innerHeight}),[panelSize,setPanelSize]=useState({width:536,height:42});
  const viewportRef=useRef(viewport),selectionRef=useRef<Rect|null>(null),pixels=useRef<CanvasRenderingContext2D|null>(null);
  const photo=useRef<HTMLImageElement|null>(null),frozen=useRef<HTMLImageElement|null>(null),canvas=useRef<HTMLCanvasElement>(null),panel=useRef<HTMLDivElement>(null),textPanel=useRef<HTMLFormElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
  const gesture=useRef<{origin:Point;rect:Rect|null;mode:string}|null>(null),draft=useRef<Draft|null>(null),inFlight=useRef(false),composing=useRef(false);
  const {width,height}=viewport;
  const physical=useMemo(()=>session&&selection?toPixels(selection,width,height,session.width,session.height):null,[session,selection,width,height]);
  const showTools=!!physical&&physical.width>=2&&physical.height>=2&&!dragging&&toolbarVisible;
  const document=useMemo(()=>({...history.present,crop:physical||history.present.crop}),[history.present,physical]);
  const render=useCallback((extra?:Draft)=>{
    if(canvas.current&&photo.current&&physical&&physical.width>0&&physical.height>0) renderDocument(canvas.current,photo.current,document,extra as Mark|undefined);
  },[document,physical]);
  const select=(rect:Rect|null)=>{selectionRef.current=rect;setSelection(rect);};
  const saveSelection=(rect:Rect,initial=false)=>{
    select(rect);
    if(!session)return;
    const crop=toPixels(rect,width,height,session.width,session.height);
    if(crop.width<2||crop.height<2)return;
    setHistory(previous=>{
      const next={...previous.present,crop};
      if(initial)return {...previous,present:next};
      if(JSON.stringify(previous.present.crop)===JSON.stringify(crop))return previous;
      return commit(previous,next);
    });
  };
  const restoreHistory=(direction:'undo'|'redo')=>{
    if(!session||busy||textEntry)return;
    const next=direction==='undo'?undo(history):redo(history);
    draft.current=null;setHistory(next);
    select({x:next.present.crop.x*width/session.width,y:next.present.crop.y*height/session.height,width:next.present.crop.width*width/session.width,height:next.present.crop.height*height/session.height});
  };
  useEffect(()=>{
    const resize=()=>{
      const previous=viewportRef.current,next={width:innerWidth,height:innerHeight};
      if(next.width<=0||next.height<=0)return;
      viewportRef.current=next;setViewport(next);
      setSelection(rect=>{const mapped=rect?remapViewportRect(rect,previous.width,previous.height,next.width,next.height):null;selectionRef.current=mapped;return mapped;});
      setCursor(point=>({x:point.x*next.width/previous.width,y:point.y*next.height/previous.height}));
      gesture.current=null;draft.current=null;setDragging(false);
    };
    window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  useEffect(()=>{
    window.document.documentElement.classList.add('capture-document');
    let cancelled=false;
    const fail=()=>invoke('capture_load_failed',{sessionId}).catch(()=>undefined);
    void invoke<Session>('get_capture_session',{sessionId}).then(async data=>{
      if(cancelled)return;
      if(data.sessionId!==sessionId)throw new Error('截图会话已过期');
      setSession(data);setHistory(createHistory(data.width,data.height));
      const image=new Image();
      image.src=data.dataUrl;await image.decode();
      if(cancelled)return;
      photo.current=image;
      const sourceCanvas=window.document.createElement('canvas');sourceCanvas.width=data.width;sourceCanvas.height=data.height;
      const context=sourceCanvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw new Error('无法准备截图像素');
      context.drawImage(image,0,0);pixels.current=context;
      const actual=data.cursor||{x:data.originX+data.width/2,y:data.originY+data.height/2};
      setCursor({x:clamp((actual.x-data.originX)*innerWidth/data.width,0,innerWidth),y:clamp((actual.y-data.originY)*innerHeight/data.height,0,innerHeight)});
      setReady(true);
    }).catch(()=>{if(!cancelled)void fail();});
    return()=>{cancelled=true;window.document.documentElement.classList.remove('capture-document');};
  },[sessionId]);
  useEffect(()=>{
    if(!ready||!session)return;
    let cancelled=false;
    void presentPreparedCapture({
      cancelled:()=>cancelled,
      prepare:async()=>{
        if(!frozen.current)throw new Error('截图画面尚未挂载');
        await frozen.current.decode();
        const bounds=frozen.current.getBoundingClientRect();
        if(bounds.width<=0||bounds.height<=0)throw new Error('截图布局无效');
        // Hidden WebView2 pages can throttle RAF; commit layout then use a timer.
        await new Promise<void>(resolve=>setTimeout(resolve,32));
      },
      present:()=>{
        // The hidden native window may still be crossing its initial DPI/layout
        // transition. Never reveal a default-sized webview stretched over a frame.
        if(Math.abs(innerWidth*devicePixelRatio-session.width)>2||Math.abs(innerHeight*devicePixelRatio-session.height)>2)return Promise.resolve(false);
        return invoke<boolean>('capture_ready',{sessionId});
      },
      pause:()=>new Promise<void>(resolve=>setTimeout(resolve,25)),
      failed:()=>invoke('capture_load_failed',{sessionId}),
    });
    return()=>{cancelled=true;};
  },[ready,session,sessionId]);
  useEffect(()=>{if(ready)render();},[render,ready]);
  useEffect(()=>{
    if(!ready)return;
    render(textEntry?.text?{tool:'text',color,width:textStyle.fontSize/6,points:[textEntry.point],text:textEntry.text,...textStyle}:undefined);
  },[textEntry,textStyle,color,render,ready]);
  useEffect(()=>{if(textEntry)textInput.current?.focus();},[!!textEntry]);
  useEffect(()=>{
    if(!panel.current||!showTools)return;
    const measure=()=>{const rect=panel.current?.getBoundingClientRect();if(rect)setPanelSize(previous=>previous.width===rect.width&&previous.height===rect.height?previous:{width:rect.width,height:rect.height});};
    const observer=new ResizeObserver(measure);observer.observe(panel.current);measure();return()=>observer.disconnect();
  },[showTools]);
  useEffect(()=>{
    if(!textPanel.current)return;
    const measure=()=>{const rect=textPanel.current?.getBoundingClientRect();if(rect)setTextPanelSize(previous=>previous.width===rect.width&&previous.height===rect.height?previous:{width:rect.width,height:rect.height});};
    const observer=new ResizeObserver(measure);observer.observe(textPanel.current);measure();return()=>observer.disconnect();
  },[!!textEntry]);
  const cancel=useCallback(()=>{if(!inFlight.current)void invoke('cancel_capture',{sessionId}).catch(e=>setError(String(e)));},[sessionId]);
  const leaveTool=(reason:'cancel'|'finish'='cancel')=>{
    if(busy)return;
    if(textEntry){
      const action=textDismissal(textEntry.text,composing.current,reason);
      if(action==='commit')addText();
      else if(action==='discard'){setTextEntry(null);canvas.current?.focus();}
      return;
    }
    if(draft.current){draft.current=null;render();return;}
    if(tool){setTool(null);return;}
    cancel();
  };
  const addText=()=>{
    if(!textEntry?.text.trim()||composing.current)return;
    const mark={tool:'text',color,width:textStyle.fontSize/6,points:[textEntry.point],text:textEntry.text,...textStyle} as Mark;
    setHistory(previous=>commit(previous,{...document,marks:[...previous.present.marks,mark]}));setTextEntry(null);canvas.current?.focus();
  };
  const finish=useCallback(async(action:Action)=>{
    if(!session||!physical||!ready||inFlight.current||textEntry||composing.current||draft.current||gesture.current)return;
    if(physical.width<2||physical.height<2){setError('选区至少需要 2 × 2 像素');return;}
    inFlight.current=true;setBusy(true);setError('');
    try {
      let dataUrl:string|undefined;
      if(document.marks.length){const output=window.document.createElement('canvas');renderDocument(output,photo.current!,document);dataUrl=output.toDataURL('image/png');}
      await invoke('finish_capture',{sessionId,selection:physical,action,...(dataUrl?{dataUrl}:{})});
    } catch(e){setError(String(e));} finally{inFlight.current=false;setBusy(false);}
  },[session,physical,document,ready,textEntry]);
  useEffect(()=>{
    let stopped=false;let unlisten:(()=>void)|undefined;
    void listen('capture-pin',()=>void finish('pin')).then(stop=>{if(stopped)stop();else unlisten=stop;}).catch(e=>setError(String(e)));
    return()=>{stopped=true;unlisten?.();};
  },[finish]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      const input=event.target instanceof HTMLElement&&captureShortcutInput(event.target.tagName,event.target.getAttribute('role'),event.target.isContentEditable);
      const button=event.target instanceof HTMLElement&&!!event.target.closest('button, [role="button"]');
      if(input&&(event.ctrlKey||event.metaKey)&&['s','t'].includes(event.key.toLowerCase())){event.preventDefault();return;}
      const intent=shortcutIntent(event.key,event.ctrlKey||event.metaKey,event.shiftKey,input,event.isComposing||composing.current,button);
      if(intent){
        event.preventDefault();
        if(intent.kind==='escape'){leaveTool();return;}
        if(busy)return;
        if(intent.kind==='text-confirm'){addText();return;}
        if(intent.kind==='toggle-toolbar'){if(selection)setToolbarVisible(value=>!value);return;}
        if(intent.kind==='width'){if(tool&&!draft.current)setStrokeWidth(value=>clamp(value+intent.delta,1,20));return;}
        if(intent.kind==='copy'||intent.kind==='save'||intent.kind==='pin'){void finish(intent.kind);return;}
        if(intent.kind==='undo'||intent.kind==='redo'){restoreHistory(intent.kind);return;}
        if(intent.kind==='tool'){if(selection){setTool(intent.tool);setToolbarVisible(true);}return;}
        if(intent.kind==='all'&&!tool){saveSelection({x:0,y:0,width,height},!selection);return;}
      }
      if(input||event.isComposing||composing.current||busy||tool||!session||!selection||!event.key.startsWith('Arrow'))return;
      event.preventDefault();
      const step=event.shiftKey?10:1,dx=(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)*width/session.width,dy=(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)*height/session.height;
      saveSelection(event.ctrlKey?{...selection,width:clamp(selection.width+dx,2*width/session.width,width-selection.x),height:clamp(selection.height+dy,2*height/session.height,height-selection.y)}:moveRect(selection,dx,dy,width,height));
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  const down=(e:PointerEvent<HTMLDivElement>,mode='new')=>{
    if(e.button!==0||busy||!ready||!session||tool||textEntry)return;
    setToolbarVisible(true);
    e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    const origin={x:e.clientX,y:e.clientY};gesture.current={origin,rect:selection,mode};setDragging(true);setError('');
    if(mode==='new')select({...origin,width:0,height:0});
  };
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const point={x:clamp(e.clientX,0,width),y:clamp(e.clientY,0,height)};setCursor(point);setCursorMoved(true);
    if(session&&pixels.current&&(!selection||dragging)){
      const source=loupeSample(point,{width,height},session);
      const [r,g,b]=pixels.current.getImageData(source.x,source.y,1,1).data;
      setPixel({source,hex:`#${[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`,rgb:`RGB ${r},${g},${b}`});
    }
    const g=gesture.current;if(!g)return;
    if(g.mode==='new')select(between(g.origin,point,width,height));
    else if(g.rect&&g.mode==='move')select(moveRect(g.rect,point.x-g.origin.x,point.y-g.origin.y,width,height));
    else if(g.rect)select(resizeRect(g.rect,g.mode,point,width,height));
  };
  const end=(e:PointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;
    // Include the release position even when Windows coalesces the final move.
    if(g){
      const point={x:clamp(e.clientX,0,width),y:clamp(e.clientY,0,height)};
      const rect=g.mode==='new'?between(g.origin,point,width,height):g.rect?(g.mode==='move'?moveRect(g.rect,point.x-g.origin.x,point.y-g.origin.y,width,height):resizeRect(g.rect,g.mode,point,width,height)):selectionRef.current;
      if(rect)saveSelection(rect,!g.rect);
    }
    gesture.current=null;setDragging(false);
  };
  const annotationPoint=(e:PointerEvent<HTMLCanvasElement>)=>imagePosition({x:e.clientX,y:e.clientY},viewport,session!,physical!);
  const updateDraft=(e:PointerEvent<HTMLCanvasElement>)=>{
    const current=draft.current;if(!current||!physical)return;
    let next=constrainPoint(current.points[0],annotationPoint(e),current.tool,e.shiftKey,physical);
    next={x:clamp(next.x,physical.x,physical.x+physical.width),y:clamp(next.y,physical.y,physical.y+physical.height)};
    if(['pen','highlight','eraser'].includes(current.tool))current.points.push(next);else current.points=[current.points[0],next];
    render(current);
  };
  const monitors=session?.monitors?.length?session.monitors.map(m=>({x:m.x*width/session.width,y:m.y*height/session.height,width:m.width*width/session.width,height:m.height*height/session.height})):[{x:0,y:0,width,height}];
  const monitor=monitorAt(selection?{x:selection.x+selection.width-1,y:selection.y+selection.height-1}:cursor,monitors);
  const cursorMonitor=monitorAt(cursor,monitors);
  const toolbar=selection?toolbarPosition(selection,panelSize,monitor):{x:0,y:0};
  const loupe=loupePosition(cursor,cursorMonitor);
  const preview=session&&pixel?loupeBackground(pixel.source,session):null;
  const notice={left:cursorMonitor.x+cursorMonitor.width/2,top:cursorMonitor.y+24,maxWidth:cursorMonitor.width-24};
  const hint=fitPanel({x:cursor.x+18,y:cursor.y+18},240,36,cursorMonitor);
  const selectionMonitor=monitorAt(selection?{x:selection.x,y:selection.y}:cursor,monitors);
  const textAnchor=textEntry&&session?{x:textEntry.point.x*width/session.width,y:textEntry.point.y*height/session.height}:null;
  const textMonitor=monitorAt(textAnchor||cursor,monitors);
  const textPosition=textAnchor?fitPanel(textAnchor,Math.min(textPanelSize.width,textMonitor.width-16),textPanelSize.height,textMonitor):null;
  return <main className="capture-overlay capture-annotator" aria-label="屏幕截图与现场标注" onContextMenu={e=>{e.preventDefault();leaveTool('finish');}}>
    {session&&<img ref={frozen} className="frozen-desktop" src={session.dataUrl} alt="冻结的桌面画面" draggable={false}/>}
    <div className="capture-input" onPointerDown={e=>down(e)} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{const g=gesture.current;gesture.current=null;setDragging(false);if(g)select(g.rect);}}>
      {!selection&&<div className="capture-dim"/>}
      {selection&&<div className={`capture-selection ${tool?'annotating':''}`} style={{left:selection.x,top:selection.y,width:selection.width,height:selection.height}} onPointerDown={e=>down(e,'move')} onDoubleClick={()=>{if(!tool)void finish('copy');}}>
        <span className="capture-dimensions" style={{top:selection.y<selectionMonitor.y+32?8:-29}}>{physical?.width} × {physical?.height}</span>
        <canvas ref={canvas} className="capture-annotation-canvas" tabIndex={tool?0:-1} aria-label="现场标注画布" style={{pointerEvents:tool?'auto':'none'}}
          onPointerDown={e=>{
            if(!tool||!ready||!physical||busy||textEntry||e.button!==0)return;
            e.preventDefault();e.stopPropagation();e.currentTarget.focus();setError('');const point=annotationPoint(e);
            if(tool==='text'){setTextEntry({point,text:''});return;}
            if(tool==='step'){setHistory(previous=>commit(previous,{...document,marks:[...previous.present.marks,{tool:'step',color,width:strokeWidth,points:[point],number:previous.present.marks.filter(mark=>mark.tool==='step').length+1}]}));return;}
            e.currentTarget.setPointerCapture(e.pointerId);draft.current={tool,color,width:strokeWidth,points:[point]};render(draft.current);
          }}
          onPointerMove={e=>{e.stopPropagation();updateDraft(e);}}
          onPointerUp={e=>{
            if(!draft.current)return;e.stopPropagation();updateDraft(e);const mark=draft.current;draft.current=null;
            if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
            if(!['pen','highlight','eraser'].includes(mark.tool)&&Math.hypot(mark.points.at(-1)!.x-mark.points[0].x,mark.points.at(-1)!.y-mark.points[0].y)<2){render();return;}
            setHistory(previous=>commit(previous,{...document,marks:[...previous.present.marks,mark as Mark]}));
          }} onPointerCancel={()=>{draft.current=null;render();}} onLostPointerCapture={()=>{if(draft.current){draft.current=null;render();}}}/>
        {!tool&&['nw','n','ne','e','se','s','sw','w'].map(handle=><div key={handle} className={`selection-handle handle-${handle}`} onPointerDown={e=>down(e,handle)}/>)}
      </div>}
    </div>
    {ready&&!selection&&!cursorMoved&&<div className="capture-instructions capture-cursor-hint" style={{left:hint.x,top:hint.y,transform:'none',maxWidth:cursorMonitor.width-16}}>拖动框选 · Esc 取消</div>}
    {selection&&physical&&<CaptureTools panelRef={panel} hidden={!showTools} position={toolbar} maxWidth={Math.max(120,monitor.width-16)} maxHeight={Math.max(80,monitor.height-16)} tool={tool} setTool={setTool} color={color} setColor={setColor} width={strokeWidth} setWidth={setStrokeWidth} textStyle={textStyle} setTextStyle={setTextStyle} canUndo={history.past.length>0} canRedo={history.future.length>0} undo={()=>restoreHistory('undo')} redo={()=>restoreHistory('redo')} busy={busy||!ready} textActive={!!textEntry} finish={action=>void finish(action)} cancel={cancel}/>}
    {textEntry&&textPosition&&<form ref={textPanel} className="capture-inline-text" style={{left:textPosition.x,top:textPosition.y,width:Math.min(300,textMonitor.width-16),maxHeight:textMonitor.height-16}} onSubmit={e=>{e.preventDefault();addText();}} onPointerDown={e=>e.stopPropagation()}>
      <textarea ref={textInput} aria-label="现场标注文字" rows={3} maxLength={2000} placeholder="输入文字…" value={textEntry.text} style={{color,fontFamily:textStyle.fontFamily,fontSize:Math.max(12,textStyle.fontSize*width/(session?.width||width))}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onChange={e=>setTextEntry({...textEntry,text:e.target.value})}/>
      <div><span>Ctrl+Enter / 右键确认 · Esc 取消</span><button type="button" aria-label="取消输入文字" title="取消输入文字" onClick={()=>{composing.current=false;setTextEntry(null);canvas.current?.focus();}}><X size={16}/></button><button type="submit" aria-label="添加文字" title="添加文字" disabled={!textEntry.text.trim()}><Check size={18}/></button></div>
    </form>}
    {session&&pixel&&preview&&ready&&cursorMoved&&(!selection||dragging)&&<div className="pixel-loupe" style={{left:loupe.x,top:loupe.y,width:LOUPE_WIDTH}}>
      <div className="loupe-heading"><span>像素预览</span><small>{LOUPE_ZOOM}×</small></div>
      <div className="loupe-image" style={{height:LOUPE_IMAGE_HEIGHT,backgroundImage:`url(${session.dataUrl})`,backgroundSize:`${preview.width}px ${preview.height}px`,backgroundPosition:`${preview.x}px ${preview.y}px`}}>
        <div className="loupe-grid" style={{backgroundSize:`${LOUPE_ZOOM}px ${LOUPE_ZOOM}px`,backgroundPosition:`${LOUPE_WIDTH/2-LOUPE_ZOOM/2}px ${LOUPE_IMAGE_HEIGHT/2-LOUPE_ZOOM/2}px`}}/>
        <span className="loupe-reticle"/><i className="loupe-sample-cell"/>
      </div>
      <div className="loupe-readout"><i style={{background:pixel.hex}}/><code>{pixel.hex}</code><small>{pixel.rgb}</small></div>
      <div className="loupe-caption">{physical?`${physical.width} × ${physical.height} px`:'拖动框选 · 右键取消'}</div>
    </div>}
    {selection&&!dragging&&!textEntry&&<div className="capture-key-hint" style={{left:monitor.x+monitor.width/2,top:monitor.y+monitor.height-34,bottom:'auto',maxWidth:monitor.width-24}}>{!toolbarVisible?'Space 显示工具栏 · Enter 完成':tool?'Esc / 右键返回移动 · [ ] 粗细 · Space 隐藏工具栏':'方向键 1 px · Shift 10 px · Ctrl+方向键改大小 · Enter 完成'}</div>}
    {error&&<div className="capture-error" style={notice} role="alert">{error}<button onClick={cancel}>取消截图</button></div>}
  </main>;
}
