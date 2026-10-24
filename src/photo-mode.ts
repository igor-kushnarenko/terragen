import * as T from 'three';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {ControlsSystem} from './controls';
import type {WorldEdits} from './edits';
import type {HistorySystem} from './history';
import type {Feedback} from './feedback';
import type {ProjectView} from './project';
import type {SavedViewpoint} from './world';
import {worldId} from './composition';
import {capturePhotoPNG,applyPhotoView} from './photo-camera';

export function createPhotoMode(model:EditorModel,render:RenderingSystem,input:ControlsSystem,edits:WorldEdits,history:HistorySystem,feedback:Feedback,draw?:()=>void){
    function el<K extends keyof HTMLElementTagNameMap>(tag:K,parent:HTMLElement,text=''){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
    const entry=el('button',document.body,'Фоторежим · F8');entry.id='photoBtn';entry.className='btn';entry.onclick=()=>enter();
    const panel=el('section',document.body);panel.id='photoControls';panel.hidden=true;panel.setAttribute('aria-label','Фоторежим');el('h2',panel,'Фоторежим');
    const hint=el('p',panel,'ЛКМ / ПКМ — обзор · колесо — масштаб · WASD — камера · Q/E — ниже/выше · Tab — скрыть панель · Esc / F8 — вернуться');hint.className='hint';
    function button(text:string,fn:()=>unknown){const b=el('button',panel,text);b.className='btn';b.onclick=()=>{try{Promise.resolve(fn()).catch(e=>message.textContent=String(e instanceof Error?e.message:e));}catch(e){message.textContent=String(e);}};return b;}
    function range(label:string,min:number,max:number,step:number,value:number){const row=el('label',panel,label),e=el('input',row);e.type='range';e.min=String(min);e.max=String(max);e.step=String(step);e.value=String(value);e.setAttribute('aria-label',label);const out=el('output',row,String(value));e.oninput=()=>{out.textContent=e.value;};return {input:e,out};}
    const fov=range('Угол обзора фото',15,110,1,55),roll=range('Наклон кадра',-180,180,1,0),exposure=range('Экспозиция фото',.2,2,.05,model.state.exposure);
    const freezeRow=el('label',panel),freeze=el('input',freezeRow);freeze.type='checkbox';freeze.checked=true;el('span',freezeRow,' Приостановить время и погоду');
    const gridRow=el('label',panel),grid=el('input',gridRow);grid.type='checkbox';el('span',gridRow,' Сетка третей');
    const thirds=el('div',document.body);thirds.id='photoThirds';thirds.hidden=true;thirds.setAttribute('aria-hidden','true');
    for(let i=0;i<4;i++)el('i',thirds);
    grid.onchange=()=>thirds.hidden=!active||!grid.checked;
    const size=el('select',panel);size.setAttribute('aria-label','Размер снимка');for(const [value,text]of [['0','Размер окна'],['1920','Ширина 1920 px'],['3840','Ширина 3840 px']]){const o=el('option',size,text);o.value=value;}
    const shoot=button('Сохранить PNG',takePhoto);
    const name=el('input',panel);name.type='text';name.maxLength=128;name.value='Любимый ракурс';name.setAttribute('aria-label','Название ракурса');
    button('Сохранить ракурс',saveViewpoint);
    const views=el('select',panel);views.setAttribute('aria-label','Сохранённый ракурс');
    button('Вернуться к ракурсу',()=>{const view=model.world.viewpoints.find(v=>v.id===views.value);if(view)recall(view);});
    button('Удалить ракурс',()=>edits.replaceWorld({viewpoints:model.world.viewpoints.filter(v=>v.id!==views.value)},'Удалить ракурс'));
    button('Скрыть интерфейс · Tab',toggleUI);button('Выйти из фоторежима · Esc',exit);
    const message=el('p',panel);message.setAttribute('aria-live','polite');
    const returnButton=el('button',document.body,'Панель фото · Tab');returnButton.id='photoReturn';returnButton.className='btn';returnButton.hidden=true;returnButton.onclick=toggleUI;
    let active=false,original:ProjectView|undefined,paused=false,walkPanel=false,inventory=false,originalMinDistance=5,originalMaxPolar=0,originalButtons=render.controls.mouseButtons,exposureValue=model.state.exposure;
    let transition:{position:T.Vector3;target:T.Vector3;to:SavedViewpoint;t:number}|undefined;
    function stopOrbit(){
        const position=render.camera.position.clone(),target=render.controls.target.clone(),rotation=render.camera.quaternion.clone(),damping=render.controls.enableDamping;
        render.controls.enableDamping=false;render.controls.update();render.controls.enableDamping=damping;
        render.camera.position.copy(position);render.controls.target.copy(target);render.camera.quaternion.copy(rotation);
    }
    function sync(){const selected=views.value;views.replaceChildren();for(const v of model.world.viewpoints){const o=el('option',views,v.name);o.value=v.id;}if(model.world.viewpoints.some(v=>v.id===selected))views.value=selected;}
    feedback.uiSync.photoViews=sync;sync();
    function enter(){
        if(active||model.busy)return;history.flush();original=input.captureView();paused=input.walk.paused;walkPanel=input.walkPanel.open;inventory=input.inventory.open;
        originalMinDistance=render.controls.minDistance;originalMaxPolar=render.controls.maxPolarAngle;originalButtons={...render.controls.mouseButtons};
        active=true;input.setPhotoMode(true);stopOrbit();panel.hidden=false;document.body.classList.add('photo-mode');
        if(original.walk?.on){const forward=render.camera.getWorldDirection(new T.Vector3());render.controls.target.copy(render.camera.position).addScaledVector(forward,30);}
        render.controls.minDistance=.2;render.controls.maxPolarAngle=Math.PI-.01;render.controls.mouseButtons.LEFT=T.MOUSE.ROTATE;render.controls.update();
        fov.input.value=String(render.camera.fov);fov.out.textContent=fov.input.value;roll.input.value='0';roll.out.textContent='0';exposureValue=model.state.exposure;exposure.input.value=String(exposureValue);exposure.out.textContent=exposure.input.value;transition=undefined;message.textContent='Снимок содержит только изображение мира';sync();grid.onchange?.(new Event('change'));render.renderer.domElement.focus();
    }
    function exit(){
        if(!active)return;active=false;transition=undefined;document.body.classList.remove('photo-mode','photo-ui-hidden');panel.hidden=returnButton.hidden=thirds.hidden=true;
        render.controls.minDistance=originalMinDistance;render.controls.maxPolarAngle=originalMaxPolar;render.controls.mouseButtons=originalButtons;render.camera.up.set(0,1,0);
        stopOrbit();input.setPhotoMode(false);if(original)input.restoreView(original);if(input.walk.on){if(walkPanel)input.setWalkPanel(true);else if(inventory)input.setInventory(true);else input.setPaused(paused);}render.setLeftButton();feedback.setStatus('Фоторежим завершён');
    }
    function toggleUI(){const hidden=document.body.classList.toggle('photo-ui-hidden');returnButton.hidden=!hidden;}
    function currentView():SavedViewpoint{return {id:worldId(model.world)('view'),name:name.value.trim()||'Любимый ракурс',position:render.camera.position.toArray() as SavedViewpoint['position'],target:render.controls.target.toArray() as SavedViewpoint['target'],fov:Number(fov.input.value),roll:Number(roll.input.value),exposure:exposureValue};}
    function saveViewpoint(){if(!active||model.busy)return;const view=currentView();edits.replaceWorld({viewpoints:[...model.world.viewpoints,view]},'Сохранить ракурс');sync();views.value=view.id;message.textContent='Ракурс сохранён в проекте';}
    function recall(view:SavedViewpoint){
        if(!active)enter();if(!active)return;stopOrbit();input.clearKeys();transition={position:render.camera.position.clone(),target:render.controls.target.clone(),to:structuredClone(view),t:0};
        for(const [field,value]of [[fov,view.fov],[roll,view.roll],[exposure,view.exposure]] as const){field.input.value=String(value);field.out.textContent=field.input.value;}exposureValue=view.exposure;name.value=view.name;
    }
    fov.input.addEventListener('input',()=>transition=undefined);roll.input.addEventListener('input',()=>transition=undefined);exposure.input.addEventListener('input',()=>exposureValue=Number(exposure.input.value));
    render.renderer.domElement.addEventListener('pointerdown',()=>transition=undefined,{capture:true});
    async function takePhoto(){if(!active||model.busy||shoot.disabled)return;shoot.disabled=true;try{update(0);const blob=await capturePhotoPNG(render.renderer,render.camera,render.scene,Number(size.value),draw);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`landscape_${model.state.seed}_${Date.now()}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);message.textContent='PNG сохранён без интерфейса';}finally{shoot.disabled=false;}}
    window.addEventListener('keydown',e=>{
        const target=e.target as HTMLElement|null,typing=!!target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName);
        if(e.code==='F8'&&!e.repeat){e.preventDefault();e.stopImmediatePropagation();if(active)exit();else enter();return;}
        if(!active)return;
        if(/^(Key[WASDQE])$/.test(e.code))transition=undefined;
        if((e.ctrlKey||e.metaKey)&&!typing&&(e.code==='KeyZ'||e.code==='KeyY')){e.preventDefault();e.stopImmediatePropagation();if(e.code==='KeyY'||e.shiftKey)history.redo();else history.undo();return;}
        if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();exit();}
        else if(e.code==='Tab'&&!typing){e.preventDefault();e.stopImmediatePropagation();toggleUI();}
    },{capture:true});
    function update(dt:number){
        if(!active)return;
        if(transition){transition.t=Math.min(1,transition.t+dt/1.2);const t=transition.t*transition.t*(3-2*transition.t);render.camera.position.lerpVectors(transition.position,new T.Vector3(...transition.to.position),t);render.controls.target.lerpVectors(transition.target,new T.Vector3(...transition.to.target),t);if(transition.t===1)transition=undefined;}
        applyPhotoView(render.camera,render.controls.target,{position:render.camera.position.toArray() as SavedViewpoint['position'],target:render.controls.target.toArray() as SavedViewpoint['target'],fov:Number(fov.input.value),roll:Number(roll.input.value)});render.renderer.toneMappingExposure=exposureValue;
    }
    return {enter,exit,update,recall,get active(){return active;},get frozen(){return active&&freeze.checked;},persistentView(){return active&&original?structuredClone(original):input.captureView();}};
}
