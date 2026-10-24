import * as T from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {expandSelection,transformedObjects} from './object-transforms';
import {getModel} from './model-library';
import type {EditorModel} from './state';
import type {ControlsSystem,TerrainTool} from './controls';
import type {RenderingSystem} from './rendering';
import type {TerrainSystem} from './terrain';
import type {VegetationSystem} from './vegetation';
import type {WorldEdits} from './edits';
import type {HistorySystem,HistoryTransaction} from './history';
import type {Feedback} from './feedback';
import type {WorldObject} from './world';
import {bindSceneClick} from './scene-click';
import {createObjectAnimationControls} from './object-animation-ui';

export function createObjectEditor(model:EditorModel,render:RenderingSystem,terrain:TerrainSystem,vegetation:VegetationSystem,input:ControlsSystem,edits:WorldEdits,history:HistorySystem,feedback:Feedback,setCamera:()=>void){
    const panel=document.getElementById('panel')!,section=document.createElement('details');section.id='objectSettings';panel.prepend(section);
    function el<K extends keyof HTMLElementTagNameMap>(tag:K,parent:HTMLElement,text=''){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
    function action(fn:()=>unknown){try{return fn();}catch(e){feedback.setStatus(e instanceof Error?e.message:String(e));}}
    function button(parent:HTMLElement,text:string,fn:()=>unknown){const b=el('button',parent,text);b.type='button';b.className='btn';b.onclick=()=>action(fn);return b;}
    el('summary',section,'Редактирование объектов');
    const selector=el('select',section);selector.setAttribute('aria-label','Выбранная модель или группа');
    button(section,'Выбирать модели в сцене',begin);
    const modes=el('div',section);modes.className='btns';
    for(const [mode,title]of [['translate','Перемещение · T'],['rotate','Вращение · R'],['scale','Масштаб · V']] as const)button(modes,title,()=>{if(!active)begin();gizmo.setMode(mode);});
    const info=el('p',section);info.className='hint';
    const animationControls=createObjectAnimationControls(section,()=>selected.length===1?model.world.objects.find(o=>o.id===selected[0]):undefined,vegetation,edits,feedback);
    const fields=new Map<string,HTMLInputElement>();
    for(const [prefix,label]of [['position','Положение'],['rotation','Поворот'],['scale','Масштаб']] as const){
        const row=el('div',section);row.className='transform-row';el('span',row,label);
        for(const axis of ['x','y','z'] as const){const f=el('input',row);f.type='number';f.step=prefix==='rotation'?'5':'.1';f.setAttribute('aria-label',`${label} ${axis.toUpperCase()}`);fields.set(prefix+'.'+axis,f);f.onchange=()=>action(applyFields);}
    }
    const followRow=el('label',section),follow=el('input',followRow);follow.type='checkbox';el('span',followRow,' Привязать к рельефу');follow.onchange=()=>{if(selected.length!==1)return;const item=model.world.objects.find(o=>o.id===selected[0])!;action(()=>edits.updateObject(item.id,{followTerrain:follow.checked,...(follow.checked?{floating:false}:{}),groundOffset:item.position[1]-terrain.getH(item.position[0],item.position[2])}));};
    const floatRow=el('label',section),float=el('input',floatRow);float.type='checkbox';float.setAttribute('aria-label','Плавучий предмет');el('span',floatRow,' Плавучий предмет (в прогулке)');
    const densityRow=el('label',section,'Плотность относительно воды'),density=el('input',densityRow);density.type='number';density.min='.1';density.max='2';density.step='.05';density.value='.45';density.setAttribute('aria-label','Плотность относительно воды');
    float.onchange=()=>{if(selected.length!==1)return;const item=model.world.objects.find(o=>o.id===selected[0])!;action(()=>edits.updateObject(item.id,{floating:float.checked,followTerrain:float.checked?false:item.followTerrain,density:Number(density.value)}));};
    density.onchange=()=>{if(selected.length===1)action(()=>edits.updateObject(selected[0],{density:Number(density.value)}));};
    el('p',section,'Плавучие предметы реагируют на волны, течение и столкновения во время прогулки. Плотность меньше 1 — плавание, больше 1 — погружение. Сохранённое положение задаёт точку запуска; до 64 предметов. В редакторе можно свободно менять исходное положение.').className='hint';
    const groupName=el('input',section);groupName.type='text';groupName.value='Группа моделей';groupName.maxLength=128;groupName.setAttribute('aria-label','Название группы');
    const buttons=el('div',section);buttons.className='btns';
    button(buttons,'Копировать · Ctrl+D',copy);button(buttons,'Удалить · Delete',remove);button(buttons,'Группировать · Ctrl+G',()=>{edits.groupObjects(selected,groupName.value);sync();});button(buttons,'Разгруппировать',()=>{edits.ungroupObjects(selected);sync();});
    button(buttons,'Показать выбранное',focus);button(buttons,'Поставить на землю',()=>edits.replaceWorld({objects:model.world.objects.map(o=>selected.includes(o.id)?{...o,source:'manual',followTerrain:true,floating:false,groundOffset:0}:o)},'Поставить модели на землю'));
    el('p',section,'В режиме «Камера» клик ЛКМ по модели сразу включает редактирование; перетаскивание вращает камеру. Shift+ЛКМ — добавить / убрать модель. Группы выбираются целиком. Тяните цветные оси или используйте числовые поля. У группы масштаб равномерный. Редактирование расставленного объекта превращает его в ручной; генерация растительности его сохраняет. Esc — завершить выбор.').className='hint';

    const proxy=new T.Object3D();render.scene.add(proxy);
    const gizmo=new TransformControls(render.camera,render.renderer.domElement),helper=gizmo.getHelper();helper.userData.noWaterReflection=true;render.scene.add(helper);gizmo.setSize(.8);gizmo.enabled=false;
    const box=new T.Box3(),outline=new T.Box3Helper(box,0xffc56a);outline.visible=false;outline.userData.noWaterReflection=true;render.scene.add(outline);
    let active=false,selected:string[]=[],transaction:HistoryTransaction|undefined,bases:WorldObject[]=[],initial=new T.Matrix4(),invalid=false,lastObjects=model.world.objects;
    function bounds(){box.makeEmpty();for(const id of selected){const o=model.world.objects.find(o=>o.id===id);if(!o)continue;const m=new T.Matrix4().compose(new T.Vector3(...o.position),new T.Quaternion().setFromEuler(new T.Euler(...o.rotation)),new T.Vector3(...o.scale));box.union(getModel(o.asset).bounds.clone().applyMatrix4(m));}}
    function placeProxy(){
        selected=expandSelection(model.world,selected);bounds();if(!selected.length){gizmo.detach();outline.visible=false;return;}
        const one=selected.length===1?model.world.objects.find(o=>o.id===selected[0])!:null;
        if(one){proxy.position.fromArray(one.position);proxy.rotation.set(...one.rotation);proxy.scale.fromArray(one.scale);}else{box.getCenter(proxy.position);proxy.rotation.set(0,0,0);proxy.scale.setScalar(1);}
        proxy.updateMatrixWorld(true);if(active){gizmo.attach(proxy);gizmo.enabled=true;}outline.visible=active;lastObjects=model.world.objects;
    }
    function syncFields(){for(const [key,f]of fields){const [property,axis]=key.split('.') as ['position'|'rotation'|'scale','x'|'y'|'z'];f.disabled=!selected.length||model.busy;if(document.activeElement!==f)f.value=selected.length?(proxy[property][axis]*(property==='rotation'?180/Math.PI:1)).toFixed(3):'';}follow.disabled=selected.length!==1;follow.checked=selected.length===1&&!!model.world.objects.find(o=>o.id===selected[0])?.followTerrain;const item=selected.length===1?model.world.objects.find(o=>o.id===selected[0]):undefined;float.disabled=density.disabled=!item;float.checked=!!item?.floating;if(document.activeElement!==density)density.value=String(item?.density??.45);}
    function sync(){
        if(!transaction?.active)placeProxy();
        selector.replaceChildren();const placeholder=el('option',selector,'Выберите модель или группу');placeholder.value='';
        for(const group of model.world.groups){const option=el('option',selector,group.name+` (${group.objectIds.length})`);option.value='g:'+group.id;}
        const items=model.world.objects.filter(o=>o.source==='manual'||selected.includes(o.id));
        for(const o of items.slice(0,500)){const option=el('option',selector,`${getModel(o.asset).name} · ${o.id}`);option.value=o.id;}
        const group=model.world.groups.find(g=>g.objectIds.length===selected.length&&g.objectIds.every(id=>selected.includes(id)));selector.value=group?'g:'+group.id:selected[0]??'';
        info.textContent=`Выбрано: ${selected.length} · групп в мире: ${model.world.groups.length}`;syncFields();animationControls.sync();
    }
    function begin(){if(model.busy)return;if(input.walk.on)input.setWalk(false);input.cancelPick();input.clearKeys();setCamera();input.bindTerrainTool(tool);active=true;section.open=true;section.dispatchEvent(new Event('workspace-reveal',{bubbles:true}));gizmo.enabled=true;placeProxy();}
    function cancel(){active=false;gizmo.enabled=false;gizmo.detach();outline.visible=false;const edit=transaction;transaction=undefined;if(edit?.active)edit.rollback();render.controls.enabled=!input.walk.on;}
    function choose(ids:string[]){if(!active)begin();selected=expandSelection(model.world,ids);sync();}
    function pick(ray:T.Ray,ground:T.Vector3|null){const hit=vegetation.pick(ray);return hit&&(!ground||hit.distance<ray.origin.distanceTo(ground)+.2)?hit.id:undefined;}
    function selectHit(id:string|undefined,additive:boolean){
        if(id){const group=expandSelection(model.world,[id]);if(additive){const remove=group.some(id=>selected.includes(id));selected=remove?selected.filter(id=>!group.includes(id)):[...selected,...group];}else selected=group;}
        else if(!additive)selected=[];
        sync();
    }
    bindSceneClick(render.renderer.domElement,()=>!active&&!input.terrainToolActive&&!input.walk.on&&!input.photoMode.on&&!input.picking.on&&!model.busy&&model.state.tool==='camera',event=>{
        const rect=render.renderer.domElement.getBoundingClientRect(),caster=new T.Raycaster();
        caster.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),render.camera);
        const id=pick(caster.ray,terrain.raycastTerrain(caster.ray));
        if(id){begin();selectHit(id,event.shiftKey);}
    });
    function start(){if(model.busy||!selected.length)return;transaction=history.begin('Трансформация моделей');bases=selected.map(id=>structuredClone(model.world.objects.find(o=>o.id===id)!));initial.copy(proxy.matrixWorld).invert();invalid=false;}
    function preview(){
        if(!transaction?.active)return;
        try{
            if(selected.length>1&&gizmo.getMode()==='scale'){const values=proxy.scale.toArray(),factor=values.reduce((a,b)=>Math.abs(b-1)>Math.abs(a-1)?b:a,1);proxy.scale.setScalar(factor);}
            proxy.updateMatrixWorld(true);const transformed=transformedObjects(bases,new T.Matrix4().multiplyMatrices(proxy.matrixWorld,initial));
            for(const item of transformed)Object.assign(model.world.objects.find(o=>o.id===item.id)!,item);
            vegetation.snapScatter(new Set(selected));bounds();syncFields();invalid=false;
        }catch(e){invalid=true;feedback.setStatus(e instanceof Error?e.message:String(e));}
    }
    function finish(){const edit=transaction;transaction=undefined;if(!edit?.active)return;if(invalid)edit.rollback();else{model.world={...model.world,objects:[...model.world.objects]};vegetation.rebuild();history.refreshCurrent();edit.commit();}sync();}
    function applyFields(){if(!active)begin();start();for(const [key,f]of fields){const [property,axis]=key.split('.') as ['position'|'rotation'|'scale','x'|'y'|'z'];proxy[property][axis]=Number(f.value)*(property==='rotation'?Math.PI/180:1);}preview();finish();}
    function copy(){if(!selected.length||model.busy)return;choose(edits.duplicateObjects(selected));}
    function remove(){if(!selected.length||model.busy)return;edits.removeObjects(selected);selected=[];sync();}
    function focus(){bounds();if(box.isEmpty())return;const center=box.getCenter(new T.Vector3()),distance=Math.max(12,box.getSize(new T.Vector3()).length()*1.4);render.controls.target.copy(center);render.camera.position.copy(center).add(new T.Vector3(distance*.7,distance*.55,distance*.8));render.controls.update();}
    gizmo.addEventListener('dragging-changed',e=>{render.controls.enabled=!e.value;if(e.value)start();else finish();});gizmo.addEventListener('objectChange',preview);
    const tool:TerrainTool={get active(){return active;},cancel,pointerDown(){},pointerMove(){},pointerUp(){},pointerRayDown(event,ray,ground){
        if(gizmo.axis!==null)return true;
        event.preventDefault();event.stopImmediatePropagation();selectHit(pick(ray,ground),event.shiftKey);return true;
    },keyDown(e){
        if(transaction?.active&&(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.code==='KeyZ')){e.preventDefault();cancel();return true;}
        if(e.key==='Escape'){cancel();return true;}if(model.busy)return false;
        if(e.code==='Delete'){e.preventDefault();remove();return true;}
        if((e.ctrlKey||e.metaKey)&&e.code==='KeyD'){e.preventDefault();action(copy);return true;}
        if((e.ctrlKey||e.metaKey)&&e.code==='KeyG'){e.preventDefault();action(()=>e.shiftKey?edits.ungroupObjects(selected):edits.groupObjects(selected,groupName.value));sync();return true;}
        if(!e.ctrlKey&&!e.metaKey&&['KeyT','KeyR','KeyV'].includes(e.code)){gizmo.setMode(e.code==='KeyT'?'translate':e.code==='KeyR'?'rotate':'scale');return true;}return false;
    }};
    selector.onchange=()=>{const group=model.world.groups.find(g=>'g:'+g.id===selector.value);choose(group?group.objectIds:selector.value?[selector.value]:[]);};
    feedback.uiSync.objectEditor=sync;input.bindObjectSelector(id=>choose([id]));sync();
    return {choose,begin,cancel,update(){helper.visible=outline.visible=active&&!input.walk.on&&selected.length>0;gizmo.enabled=active&&!input.walk.on&&!model.busy;if(lastObjects!==model.world.objects&&!transaction?.active)sync();animationControls.update();}};
}
