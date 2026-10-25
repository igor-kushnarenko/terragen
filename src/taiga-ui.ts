import {createTaigaControls} from './taiga-controls';
import {applyTaigaSettings} from './taiga-editor';
import {taigaDefaults,TAIGA_VARIANTS,type TaigaSettings} from './taiga-settings';
import {isTaigaPlant} from './taiga-models';
import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import type {Feedback} from './feedback';

export function createTaigaInterface(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,feedback:Feedback,create:(settings:TaigaSettings)=>void){
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const root=el('details',document.getElementById('panel')!);root.id='taigaSettings';el('summary',root,'Тайга · северный лес');
    const scope=el('select',root);scope.setAttribute('aria-label','Настраиваемая тайга');
    const empty=el('p',root,'Создайте мир «Тайга» или добавьте локальный биом «Тайга».');empty.className='hint';
    const fields=el('fieldset',root);fields.className='jungle-fields';let pending=false,busy=false,signature='';
    const form=createTaigaControls(fields,taigaDefaults(),()=>{pending=true;},false,false);
    el('p',root,'Растения и покрытия обновляются в выбранном биоме. Рельеф, ручьи и озерца задаются при создании мира. Освещение и дымка меняются для всего мира только при настройке всей тайги.').className='hint';
    const apply=el('button',root,'Применить настройки тайги');apply.type='button';apply.className='btn primary jungle-apply';
    const createButton=el('button',root,'Создать новый мир тайги');createButton.type='button';createButton.className='btn jungle-create';createButton.onclick=()=>create(form.read());
    const status=el('p',root);status.className='hint';status.setAttribute('role','status');
    function sync(force=false){
        const options=[...(model.world.preset==='taiga'?[{id:'world',name:'Весь мир тайги'}]:[]),...model.world.biomes.filter(b=>b.kind==='taiga'&&b.id!=='world-biome').map(b=>({id:b.id,name:b.name}))],chosen=scope.value;
        if(scope.dataset.options!==JSON.stringify(options)){scope.dataset.options=JSON.stringify(options);scope.replaceChildren();for(const o of options){const e=el('option',scope,o.name);e.value=o.id;}if(options.some(o=>o.id===chosen))scope.value=chosen;}
        const settings=scope.value==='world'?model.world.recipe?.taiga:model.world.biomes.find(b=>b.id===scope.value)?.taiga,key=JSON.stringify([scope.value,settings]);
        if(force||key!==signature){signature=key;form.sync(settings??taigaDefaults());pending=false;}
        empty.hidden=options.length>0;scope.hidden=options.length<2;fields.disabled=busy||model.busy;apply.disabled=busy||model.busy||!options.length;createButton.disabled=busy||model.busy;
        if(!pending){const region=model.world.biomes.find(b=>b.id===scope.value),count=model.world.objects.filter(o=>isTaigaPlant(o.asset)&&(!region||Math.hypot(o.position[0]-region.center[0],o.position[2]-region.center[1])<region.radius)).length;
            status.textContent=options.length?`${TAIGA_VARIANTS[(settings??taigaDefaults()).variant].name} · объектов: ${count}`:'';}
    }
    scope.onchange=()=>sync(true);
    apply.onclick=async()=>{if(busy||model.busy)return;busy=true;sync();try{await new Promise<void>(resolve=>setTimeout(resolve,0));const r=applyTaigaSettings(model,terrain,history,vegetation,materials,form.read(),scope.value);pending=false;feedback.syncAllUI();feedback.setStatus(r.plantsChanged?'Тайга обновлена.':'Покрытия и сезон тайги обновлены.');}catch(e){feedback.setStatus(String(e instanceof Error?e.message:e));}finally{busy=false;sync();}};
    feedback.uiSync.taigaSettings=()=>sync();sync();
}
