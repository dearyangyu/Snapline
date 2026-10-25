import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, type LucideIcon } from '../icons';
import type { Point } from '../captureGeometry';
import { pinMenuBounds } from '../pinInteraction';

export interface PinMenuItem {
  label:string;
  icon?:LucideIcon;
  shortcut?:string;
  checked?:boolean;
  disabled?:boolean;
  action:()=>void;
}
export interface PinMenuGroup {label?:string;items:PinMenuItem[]}

export default function PinContextMenu({point,groups,onDismiss}:{point:Point;groups:PinMenuGroup[];onDismiss:()=>void}) {
  const menu=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState({width:innerWidth,height:innerHeight});
  const bounds=pinMenuBounds(point,viewport.width,viewport.height);
  useEffect(()=>{
    const resized=()=>setViewport({width:innerWidth,height:innerHeight});
    window.addEventListener('resize',resized);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return()=>window.removeEventListener('resize',resized);
  },[]);
  const key=(event:KeyboardEvent)=>{
    // Keep the image's shortcuts and Escape-close behavior out of an active menu.
    event.stopPropagation();
    if(event.key==='Escape'||event.key==='Tab') {event.preventDefault();onDismiss();return;}
    const entries=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
    if(!entries.length)return;
    const current=entries.indexOf(document.activeElement as HTMLButtonElement);
    let next:number;
    if(event.key==='ArrowDown')next=(current+1)%entries.length;
    else if(event.key==='ArrowUp')next=(current-1+entries.length)%entries.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=entries.length-1;
    else return; // Enter and Space retain the focused button's native activation.
    event.preventDefault();entries[next].focus();
  };
  return <div ref={menu} className="pin-context-menu" role="menu" aria-label="贴图快捷菜单"
    style={{left:bounds.x,top:bounds.y,width:bounds.width,maxHeight:bounds.maxHeight}} onKeyDown={key}
    onFocusCapture={event=>event.target.scrollIntoView({block:'nearest',inline:'nearest'})}>
    {groups.map((group,index)=><div className="pin-menu-group" role="group" aria-label={group.label} key={group.label??index}>
      {group.label&&<div className="pin-menu-heading">{group.label}</div>}
      {group.items.map(({label,icon:Icon,shortcut,checked,disabled,action})=><button key={label} type="button"
        role={checked===undefined?'menuitem':'menuitemradio'} aria-checked={checked} disabled={disabled} onClick={action}>
        <span className="pin-menu-icon" aria-hidden="true">{checked? <Check size={14}/>:Icon?<Icon size={14}/>:null}</span>
        <span className="pin-menu-label">{label}</span>{shortcut&&<kbd>{shortcut}</kbd>}
      </button>)}
    </div>)}
  </div>;
}
