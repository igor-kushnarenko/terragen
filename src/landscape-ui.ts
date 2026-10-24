import { LANDSCAPE_PRESETS } from './presets';
import { routeLength } from './trail-math';
import type { LandscapeSystem } from './landscape';
import type { TrailTool } from './trail-tool';
import type { ControlsSystem } from './controls';
import type { EditorModel } from './state';
import type { Feedback } from './feedback';
import type { RenderingSystem } from './rendering';
import type { TerrainSystem } from './terrain';
import type { LegacyPresetId, WorldRoute } from './world';
import type { WorldEdits } from './edits';
export function createLandscapeInterface(model:EditorModel,landscape:LandscapeSystem,tool:TrailTool,input:ControlsSystem,render:RenderingSystem,terrain:TerrainSystem,feedback:Feedback,edits:WorldEdits){
    const panel=document.getElementById('panel')!;
    function element<K extends keyof HTMLElementTagNameMap>(tag:K,parent:HTMLElement,text=''){const item=document.createElement(tag);item.textContent=text;parent.append(item);return item;}
    function section(title:string){const item=document.createElement('details');element('summary',item,title);panel.insertBefore(item,panel.querySelector('details'));return item;}
    function button(parent:HTMLElement,text:string,action:()=>unknown){const item=element('button',parent,text);item.className='btn';item.type='button';item.onclick=()=>{try{Promise.resolve(action()).catch(e=>feedback.setStatus(e instanceof Error?e.message:String(e)));}catch(e){feedback.setStatus(e instanceof Error?e.message:String(e));}};return item;}
    const trails=section('Тропы по кривой'),presets=section('Композиция и прежние пресеты');trails.id='trailSettings';presets.id='compositionSettings';
    const select=element('select',presets);select.setAttribute('aria-label','Пресет ландшафта');
    for(const [id,preset]of Object.entries(LANDSCAPE_PRESETS)){const option=element('option',select,preset.name);option.value=id;}
    const description=element('p',presets);description.className='hint';select.onchange=()=>description.textContent=LANDSCAPE_PRESETS[select.value as LegacyPresetId].description;select.onchange(new Event('change'));
    const presetButtons=element('div',presets);presetButtons.className='btns';
    button(presetButtons,'Применить прежний пресет',()=>landscape.generatePreset(select.value as LegacyPresetId)).id='btnPreset';
    button(presetButtons,'Создать композицию',landscape.compose).id='btnCompose';
    const seedLabel=element('label',presets,'Сид композиции'),seed=element('input',seedLabel);seed.type='number';seed.min='0';seed.max=String(0xffffffff);seed.step='1';seed.setAttribute('aria-label','Сид композиции');
    const presetHint=element('p',presets,'Пресет заменяет рельеф, биомы и маршруты, сохраняя ручные модели. Композиция добавляет поляны, долину, видовую площадку и ориентир. Все изменения можно отменить одним действием.');presetHint.className='hint';
    const places=element('div',presets);places.className='landscape-places';
    seed.onchange=()=>{const value=Number(seed.value);if(!model.busy&&Number.isInteger(value)&&value>=0&&value<=0xffffffff)edits.setSeeds({composition:value});feedback.syncUI('landscape');};
    function focusAt(x:number,z:number){if(model.busy)return;if(input.walk.on)input.setWalk(false);render.camera.position.set(x+65,terrain.getH(x,z)+90,z+85);render.controls.target.set(x,terrain.getH(x,z),z);render.controls.update();}
    function walkAt(x:number,z:number){
        if(model.busy)return;const start=input.starts.nearest(x,z);if(!start){feedback.setStatus('Свободный старт рядом с этим местом не найден');return;}
        if(input.walk.on)input.setWalk(false);if(!input.setWalk(true,[start.point[0],start.point[2]]))return;
        const point=model.world.landmarks.find(p=>p.position[0]===x&&p.position[1]===z);
        const target=model.world.landmarks.find(p=>p.kind==='valley'&&Math.hypot(p.position[0]-x,p.position[1]-z)>20)??model.world.landmarks.find(p=>Math.hypot(p.position[0]-x,p.position[1]-z)>20);
        if(target)input.walk.yaw=Math.atan2(x-target.position[0],z-target.position[1])+(point?.kind==='viewpoint'&&model.world.preset==='coast'?Math.PI:0);
        if(point?.kind==='viewpoint'&&model.world.preset==='coast'){
            let height=Infinity;for(let i=0;i<16;i++){const angle=i/16*Math.PI*2,h=terrain.getH(x+Math.cos(angle)*120,z+Math.sin(angle)*120);if(h<height){height=h;input.walk.yaw=Math.atan2(-Math.cos(angle),-Math.sin(angle));}}
        }
    }
    const nameLabel=element('label',trails,'Название тропы'),name=element('input',nameLabel);name.type='text';name.value='Новая тропа';name.maxLength=128;name.setAttribute('aria-label','Название тропы');
    const widthLabel=element('label',trails,'Ширина, м'),width=element('input',widthLabel);width.type='number';width.min='2';width.max='32';width.step='0.5';width.value='8';width.setAttribute('aria-label','Ширина тропы, м');
    const gradeLabel=element('label',trails,'Максимальный уклон, °'),grade=element('input',gradeLabel);grade.type='number';grade.min='5';grade.max='30';grade.step='1';grade.value='18';grade.setAttribute('aria-label','Максимальный уклон тропы, °');
    const surfaceLabel=element('label',trails,'Покрытие'),surface=element('select',surfaceLabel);surface.setAttribute('aria-label','Покрытие тропы');
    for(const [id,text]of [['soil','Почва'],['gravel','Гравий'],['sand','Песок']]){const option=element('option',surface,text);option.value=id;}
    tool.bindDraft(()=>({name:name.value,width:Number(width.value),maxGrade:Math.tan(Number(grade.value)*Math.PI/180),surface:surface.value as NonNullable<WorldRoute['surface']>}));
    const buttons=element('div',trails);buttons.className='btns';button(buttons,'Нарисовать тропу',tool.begin).id='btnDrawTrail';const finish=button(buttons,'Построить тропу',tool.commit);
    const trailHint=element('p',trails,'Клик — контрольная точка. Точки можно перетаскивать. Enter — построить, Backspace — убрать последнюю, Esc — отменить черновик. ПКМ или Alt+ЛКМ — обзор. У воды и ручных препятствий проводите кривую в обход.');trailHint.className='hint';
    const routeList=element('div',trails);routeList.className='landscape-places';
    const draftBar=element('div',document.body);draftBar.id='trailDrawHint';draftBar.hidden=true;
    const draftText=element('span',draftBar);draftText.setAttribute('aria-live','polite');button(draftBar,'Убрать точку',tool.removeLast);const draftFinish=button(draftBar,'Построить · Enter',tool.commit);button(draftBar,'Отменить · Esc',tool.cancel);
    feedback.uiSync.trailDraft=()=>{const active=tool.state.active;draftBar.hidden=!active;draftText.textContent=`Тропа · точек: ${tool.state.points.length} · клик — добавить · перетащить точку — изменить`;finish.disabled=draftFinish.disabled=!active||tool.state.points.length<2||model.busy;};
    let lastPreset=model.world.preset;
    feedback.uiSync.landscape=()=>{
        if(lastPreset!==model.world.preset){lastPreset=model.world.preset;if(lastPreset&&lastPreset in LANDSCAPE_PRESETS){select.value=lastPreset;description.textContent=LANDSCAPE_PRESETS[lastPreset as LegacyPresetId].description;}}
        if(document.activeElement!==seed)seed.value=String(model.seeds.composition);
        places.replaceChildren();for(const point of model.world.landmarks){
            const row=element('div',places);row.className='landscape-place';button(row,point.name+' · показать в редакторе',()=>focusAt(...point.position));
            const walk=button(row,'Гулять',()=>walkAt(...point.position));walk.setAttribute('aria-label','Начать прогулку: '+point.name);
        }
        routeList.replaceChildren();for(const route of model.world.routes)button(routeList,route.name+' · '+Math.round(routeLength(route.points))+' м',()=>focusAt(...route.points[Math.floor(route.points.length/2)]));
        if(!model.world.routes.length)element('p',routeList,'Маршрутов пока нет.').className='hint';
    };feedback.syncUI('landscape');feedback.syncUI('trailDraft');
}
