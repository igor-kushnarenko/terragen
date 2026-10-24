import * as T from 'three';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {TerrainSystem} from './terrain';
import type {ControlsSystem,TerrainTool} from './controls';
import type {Feedback} from './feedback';
import type {WaterEdits} from './water-edits';
import type {Vec2,WaterBody} from './world';
import {worldId} from './composition';
import {trailCurve,controlPointHit} from './trail-math';

export function createWaterEditor(model:EditorModel,render:RenderingSystem,terrain:TerrainSystem,input:ControlsSystem,feedback:Feedback,edits:WaterEdits,setCamera:()=>void){
    const panel=document.getElementById('panel')!,section=document.createElement('details');section.id='waterBodySettings';panel.prepend(section);
    function el<K extends keyof HTMLElementTagNameMap>(tag:K,parent:HTMLElement,text=''){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
    el('summary',section,'Озёра и реки');
    function button(parent:HTMLElement,text:string,action:()=>unknown){const b=el('button',parent,text);b.className='btn';b.type='button';b.onclick=()=>{try{Promise.resolve(action()).catch(e=>feedback.setStatus(e instanceof Error?e.message:String(e)));}catch(e){feedback.setStatus(String(e));}};return b;}
    const selector=el('select',section);selector.setAttribute('aria-label','Водоём');
    function field(label:string,type='number',value='0'){const row=el('label',section,label),e=el('input',row);e.type=type;e.value=value;e.step='.1';e.setAttribute('aria-label',label);return e;}
    const name=field('Название водоёма','text','Новое озеро'),level=field('Уровень / исток, м'),end=field('Уровень устья, м'),width=field('Ширина реки, м','number','12'),depth=field('Глубина русла, м','number','4'),bank=field('Ширина берега, м','number','8'),speed=field('Скорость течения, м/с','number','.6'),opacity=field('Непрозрачность водоёма','number','.72'),wave=field('Волны водоёма','number','.7'),clarity=field('Прозрачность воды, м','number','8');
    clarity.min='.2';clarity.max='40';
    const direction=el('select',section);direction.setAttribute('aria-label','Направление течения');for(const [value,text]of [['1','От первой точки к последней'],['-1','От последней точки к первой']]){const o=el('option',direction,text);o.value=value;}
    const surface=el('select',section);surface.setAttribute('aria-label','Материал берега');for(const [value,text]of [['sand','Песчаный берег'],['gravel','Гравийный берег']]){const o=el('option',surface,text);o.value=value;}
    const autoRow=el('label',section),auto=el('input',autoRow);auto.type='checkbox';auto.checked=true;el('span',autoRow,' Уровень по высоте первой точки');
    const buttons=el('div',section);buttons.className='btns';button(buttons,'Нарисовать озеро',()=>begin('lake'));button(buttons,'Нарисовать реку',()=>begin('river'));
    const changes=el('div',section);changes.className='btns';button(changes,'Применить водоём',()=>commit());button(changes,'Изменить контур',()=>{const body=model.world.waterBodies.find(b=>b.id===selector.value);if(body)begin(body.kind as 'lake'|'river',body);});button(changes,'Удалить водоём',()=>edits.remove(selector.value));
    button(section,'Показать водоём',()=>{const b=model.world.waterBodies.find(b=>b.id===selector.value);if(!b||!b.points.length)return;const x=b.points.reduce((s,p)=>s+p[0],0)/b.points.length,z=b.points.reduce((s,p)=>s+p[1],0)/b.points.length;if(input.walk.on)input.setWalk(false);render.controls.target.set(x,b.level,z);render.camera.position.set(x+70,b.level+100,z+90);render.controls.update();});
    el('p',section,'Озеро: замкнутый контур от 3 точек. Река: ось от 2 точек, от истока к устью. Enter — построить, Backspace — убрать точку, Esc — отменить. Устье не выше истока. Глубина и берега изменяют рельеф; удаление поверхности сохраняет русло. Для узких рек выбирайте сетку 256/512.').className='hint';
    const bar=el('div',document.body);bar.id='waterDrawHint';bar.className='draw-hint';bar.hidden=true;const hint=el('span',bar);button(bar,'Построить · Enter',()=>commit());button(bar,'Убрать точку',()=>{points.pop();refresh();});button(bar,'Отменить · Esc',cancel);
    const guide=new T.Group();guide.userData.noWaterReflection=true;render.scene.add(guide);const material=new T.LineBasicMaterial({color:0x73d8ff,depthTest:false}),markerMat=new T.MeshBasicMaterial({color:0x73d8ff,depthTest:false}),sphere=new T.SphereGeometry(1,8,6);
    let active=false,kind:'lake'|'river'='lake',points:Vec2[]=[],editingId:string|undefined,drag=-1,offset:Vec2=[0,0];
    function refresh(){for(const c of guide.children)if(c instanceof T.Line)c.geometry.dispose();guide.clear();bar.hidden=!active;
        if(!active)return;hint.textContent=`${kind==='lake'?'Озеро':'Река'} · точек: ${points.length}`;
        const linePoints=kind==='river'&&points.length>1?trailCurve(points,Math.max(1,model.cell/2)):points;
        if(linePoints.length>1){const p=kind==='lake'?[...linePoints,linePoints[0]]:linePoints;const line=new T.Line(new T.BufferGeometry().setFromPoints(p.map(p=>new T.Vector3(p[0],terrain.getH(...p)+.8,p[1]))),material);line.renderOrder=11;guide.add(line);}
        for(const p of points){const m=new T.Mesh(sphere,markerMat);m.position.set(p[0],terrain.getH(...p)+3,p[1]);m.scale.setScalar(3);m.renderOrder=12;guide.add(m);}
    }
    function cancel(){active=false;points=[];editingId=undefined;drag=-1;refresh();}
    function load(body:WaterBody){name.value=body.name??body.id;level.value=String(body.level);end.value=String(body.endLevel??body.level);width.value=String(body.width);depth.value=String(body.depth??4);bank.value=String(body.bankWidth??8);speed.value=String(body.flowSpeed??.6);opacity.value=String(body.opacity);wave.value=String(body.wave);clarity.value=String(body.clarity??(body.kind==='river'?3.5:8));direction.value=String(body.flowDirection??1);surface.value=body.bankSurface??'sand';kind=body.kind as 'lake'|'river';}
    function begin(type:'lake'|'river',body?:WaterBody){if(model.busy)return;if(input.walk.on)input.setWalk(false);input.cancelPick();input.clearKeys();setCamera();input.bindTerrainTool(tool);active=true;kind=type;editingId=body?.id;points=body?structuredClone(body.controlPoints??body.points).slice(0,64):[];if(body)load(body);else{name.value=type==='lake'?'Новое озеро':'Новая река';if(type==='river'){if(Number(width.value)<2)width.value='12';if(Number(speed.value)===0)speed.value='.6';}}section.open=true;refresh();render.renderer.domElement.focus();}
    async function commit(){
        if(model.busy)return;const existing=active?model.world.waterBodies.find(b=>b.id===editingId):model.world.waterBodies.find(b=>b.id===selector.value);
        const controls=active?points:existing?.controlPoints??existing?.points;if(!controls||controls.length<(kind==='lake'?3:2)){feedback.setStatus('Добавьте точки контура водоёма');return;}
        const body:WaterBody={id:existing?.id??worldId(model.world)('water'),name:name.value,kind,points:kind==='river'?trailCurve(controls,Math.max(1,model.cell/2)):structuredClone(controls),controlPoints:structuredClone(controls),level:Number(level.value),endLevel:kind==='river'?Number(end.value):Number(level.value),width:Number(width.value),depth:Number(depth.value),bankWidth:Number(bank.value),flowSpeed:kind==='river'?Number(speed.value):0,flowDirection:Number(direction.value) as 1|-1,opacity:Number(opacity.value),wave:Number(wave.value),clarity:Number(clarity.value),bankSurface:surface.value as 'sand'|'gravel'};
        try{if(await edits.upsert(body)){cancel();feedback.syncUI('waterBodies');selector.value=body.id;load(body);}}catch(e){feedback.setStatus(e instanceof Error?e.message:String(e));}
    }
    const tool:TerrainTool={get active(){return active;},cancel,pointerDown(p,ray){const selected=controlPointHit(ray,points,terrain.getH,3);offset=[0,0];if(selected>=0){drag=selected;offset=[points[drag][0]-p.x,points[drag][1]-p.z];}else if(points.length<64){points.push([p.x,p.z]);drag=points.length-1;}if(auto.checked&&points.length===1){level.value=String(Math.round((p.y-.5)*2)/2);end.value=level.value;}if(auto.checked&&kind==='river'&&points.length>1)end.value=String(Math.min(Number(level.value),Math.round((p.y-.5)*2)/2));refresh();},pointerMove(p){if(p&&drag>=0){points[drag]=[p.x+offset[0],p.z+offset[1]];refresh();}},pointerUp(){drag=-1;},keyDown(e){if(e.key==='Escape'){e.preventDefault();cancel();return true;}if(e.key==='Backspace'){e.preventDefault();points.pop();refresh();return true;}if(e.key==='Enter'){e.preventDefault();void commit();return true;}return false;}};
    selector.onchange=()=>{const body=model.world.waterBodies.find(b=>b.id===selector.value);if(body)load(body);};
    feedback.uiSync.waterBodies=()=>{const selected=selector.value;selector.replaceChildren();for(const body of model.world.waterBodies)if(body.kind!=='ocean'){const option=el('option',selector,body.name??body.id);option.value=body.id;}if(model.world.waterBodies.some(b=>b.id===selected))selector.value=selected;const body=model.world.waterBodies.find(b=>b.id===selector.value);if(!active&&body&&!section.contains(document.activeElement))load(body);};feedback.syncUI('waterBodies');
    return {begin,cancel};
}
