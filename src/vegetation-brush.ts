import * as T from 'three';
import {modelEntries} from './model-library';
import type {EditorModel} from './state';
import type {RenderingSystem} from './rendering';
import type {TerrainSystem} from './terrain';
import type {VegetationSystem} from './vegetation';
import type {ControlsSystem,TerrainTool} from './controls';
import type {HistorySystem} from './history';
import type {Feedback} from './feedback';
import {createVegetationPainter,DEFAULT_VEGETATION_BRUSH,MAX_STROKE_OBJECTS} from './vegetation-paint';

export function createVegetationBrush(model:EditorModel,render:RenderingSystem,terrain:TerrainSystem,vegetation:VegetationSystem,input:ControlsSystem,history:HistorySystem,feedback:Feedback,setCamera:()=>void){
    const parent=document.getElementById('vegetationBrushPanel')!,settings=structuredClone(DEFAULT_VEGETATION_BRUSH);
    const painter=createVegetationPainter(model,terrain,vegetation,history);
    let active=false,last:T.Vector3|undefined,hover:T.Vector3|undefined;
    function el<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text=''){const node=document.createElement(tag);node.textContent=text;host.append(node);return node;}
    el('h3',parent,'Кисть объектов');
    const toggle=el('button',parent,'Включить кисть растительности');toggle.className='btn';toggle.type='button';toggle.setAttribute('aria-pressed','false');
    const assets=el('div',parent);assets.className='vegetation-brush-assets';assets.setAttribute('role','group');assets.setAttribute('aria-label','Объекты кисти');
    function syncAssets(){
        const choices=modelEntries(model.world).filter(a=>['tree','shrub','rock','wood'].includes(a.category));
        const signature=choices.map(a=>a.id).join('/');if(assets.dataset.assets===signature)return;assets.dataset.assets=signature;assets.replaceChildren();
        settings.assets=settings.assets.filter(id=>choices.some(a=>a.id===id));
        for(const asset of choices){const label=el('label',assets);label.className='chk';const check=el('input',label);check.type='checkbox';check.checked=settings.assets.includes(asset.id);el('span',label,asset.name);check.onchange=()=>{painter.end();settings.assets=check.checked?[...settings.assets,asset.id]:settings.assets.filter(id=>id!==asset.id);};}
    }
    syncAssets();
    function slider(key:'radius'|'density'|'spacing'|'minScale'|'maxScale'|'maxSlope',label:string,min:number,max:number,step:number,format:(v:number)=>string=v=>v.toFixed(1)){
        const row=el('div',parent);row.className='row';el('label',row,label);
        const field=el('input',row);field.type='range';field.min=String(min);field.max=String(max);field.step=String(step);field.value=String(settings[key]);field.setAttribute('aria-label',label);
        const value=el('span',row,format(settings[key]));value.className='val';
        field.oninput=()=>{painter.end();settings[key]=Number(field.value);value.textContent=format(settings[key]);drawCursor();};
    }
    slider('radius','Радиус посадки, м',1,80,1,v=>v.toFixed(0));
    slider('density','Плотность кисти',0,1,.05,v=>Math.round(v*100)+'%');
    slider('spacing','Расстояние между объектами, м',.3,20,.1);
    slider('minScale','Минимальный масштаб',.05,5,.05,v=>v.toFixed(2));slider('maxScale','Максимальный масштаб',.05,5,.05,v=>v.toFixed(2));
    slider('maxSlope','Максимальный уклон, °',0,65,1,v=>v.toFixed(0));
    for(const [key,title]of [['preservePaths','Оставлять тропы свободными'],['randomRotation','Случайный поворот'],['erase','Ластик выбранных объектов']] as const){
        const row=el('label',parent);row.className='chk';const field=el('input',row);field.type='checkbox';field.checked=settings[key];el('span',row,title);field.onchange=()=>{painter.end();settings[key]=field.checked;drawCursor();};
    }
    const hint=el('p',parent,'Выберите один или несколько видов. ЛКМ и перетаскивание — посадка, Shift — ластик. Для деревьев увеличьте расстояние до 4–8 м. Трава использует маленький шаг. Вода и слишком крутые склоны пропускаются. Esc — завершить, Ctrl+Z — отменить мазок.');hint.className='hint';
    const progress=el('p',parent);progress.className='hint';progress.setAttribute('aria-live','polite');
    const geometry=new T.BufferGeometry(),line=new T.LineLoop(geometry,new T.LineBasicMaterial({color:0x84e58d,depthTest:false,transparent:true,opacity:.85}));
    line.name='Vegetation brush cursor';line.userData.noWaterReflection=true;line.renderOrder=12;line.visible=false;render.scene.add(line);
    function drawCursor(){
        line.visible=active&&!!hover&&!input.walk.on;if(!line.visible)return;
        const points=Array.from({length:64},(_,i)=>{const a=i/64*Math.PI*2,x=hover!.x+Math.cos(a)*settings.radius,z=hover!.z+Math.sin(a)*settings.radius;return new T.Vector3(x,terrain.getH(x,z)+.15,z);});
        geometry.setFromPoints(points);(line.material as T.LineBasicMaterial).color.set(settings.erase?0xffa277:0x84e58d);
    }
    function showCount(){progress.textContent=`${painter.statistics.erasing?'Удалено':'Размещено'} за мазок: ${painter.statistics.changed}${painter.statistics.limited?` · достигнут лимит плотного мазка (до ${MAX_STROKE_OBJECTS} объектов), отпустите ЛКМ и продолжите`:''}`;}
    function finish(){painter.end();last=undefined;showCount();}
    function cancel(){finish();active=false;hover=undefined;drawCursor();toggle.textContent='Включить кисть растительности';toggle.setAttribute('aria-pressed','false');}
    const tool:TerrainTool={get active(){return active;},cancel,pointerDown(){},pointerUp:finish,
        pointerRayDown(event,_ray,point){
            event.preventDefault();event.stopImmediatePropagation();if(!point||model.busy)return true;
            try{if(painter.begin({...settings,erase:settings.erase||event.shiftKey})){last=point.clone();painter.dab([point]);showCount();render.renderer.domElement.setPointerCapture(event.pointerId);}}
            catch(error){feedback.setStatus(error instanceof Error?error.message:String(error));}return true;
        },
        pointerMove(point){
            hover=point?.clone();drawCursor();if(!painter.painting)return;
            if(!point){last=undefined;return;}
            const points:T.Vector3[]=[],step=Math.max(.5,settings.radius*.3);
            if(!last){points.push(point);last=point.clone();}
            else {const distance=last.distanceTo(point),count=Math.min(8,Math.floor(distance/step));for(let i=0;i<count;i++)points.push(last.clone().lerp(point,Math.min(1,(i+1)*step/distance)));if(points.length)last=points.at(-1)!.clone();}
            if(points.length){painter.dab(points);showCount();}
        },
        keyDown(event){
            if(event.key==='Escape'){event.preventDefault();cancel();return true;}
            if((event.ctrlKey||event.metaKey)&&event.code==='KeyZ'&&painter.painting){event.preventDefault();painter.rollback();last=undefined;showCount();return true;}return false;
        },
    };
    toggle.onclick=()=>{
        if(active){cancel();return;}if(model.busy)return;
        if(!settings.assets.length){feedback.setStatus('Выберите хотя бы один вид для кисти');return;}
        if(input.walk.on)input.setWalk(false);input.cancelPick();input.clearKeys();setCamera();input.bindTerrainTool(tool);active=true;
        toggle.textContent='Завершить посадку · Esc';toggle.setAttribute('aria-pressed','true');feedback.setStatus('Кисть объектов: рисуйте ЛКМ · Shift — ластик · Esc — завершить');
    };
    render.renderer.domElement.addEventListener('pointercancel',finish);
    render.renderer.domElement.addEventListener('pointerleave',()=>{line.visible=false;});
    window.addEventListener('blur',finish);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
    feedback.uiSync.vegetationBrush=()=>{syncAssets();if(active&&!input.terrainToolActive)cancel();};
    return {cancel,get active(){return active;},settings};
}
