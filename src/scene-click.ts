/** Distinguish a scene click from OrbitControls dragging the same left button. */
export function bindSceneClick(canvas: HTMLElement, enabled: () => boolean, select: (event: PointerEvent) => void) {
    let press: {id:number;x:number;y:number} | undefined;
    const cancel=()=>{press=undefined;};
    const down=(event:PointerEvent)=>{
        press=event.button===0&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&enabled()
            ? {id:event.pointerId,x:event.clientX,y:event.clientY}:undefined;
    };
    const move=(event:PointerEvent)=>{
        if(press?.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>5)cancel();
    };
    const up=(event:PointerEvent)=>{
        const start=press;cancel();
        if(!start||start.id!==event.pointerId||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||!enabled())return;
        if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;
        const rect=canvas.getBoundingClientRect();
        if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;
        select(event);
    };
    canvas.addEventListener('pointerdown',down,{capture:true});
    canvas.addEventListener('pointermove',move,{capture:true});
    canvas.addEventListener('pointerup',up,{capture:true});
    canvas.addEventListener('pointercancel',cancel);
    canvas.addEventListener('lostpointercapture',cancel);
    return ()=>{
        canvas.removeEventListener('pointerdown',down,{capture:true});canvas.removeEventListener('pointermove',move,{capture:true});
        canvas.removeEventListener('pointerup',up,{capture:true});canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);
    };
}
