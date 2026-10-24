import {createJungleControls} from './jungle-controls';
import {applyJungleSettings} from './jungle-editor';
import {jungleDefaults,JUNGLE_VARIANTS,type JungleSettings} from './jungle-settings';
import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import type {Feedback} from './feedback';

export function createJungleInterface(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,feedback:Feedback,create:(settings:JungleSettings)=>void) {
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const root=el('details',document.getElementById('panel')!);root.id='jungleSettings';el('summary',root,'Тропические джунгли');
    const scope=el('select',root);scope.setAttribute('aria-label','Настраиваемые джунгли');
    const empty=el('p',root,'Создайте тропический мир или добавьте локальный биом «Джунгли».');empty.className='hint';
    const fields=el('fieldset',root);fields.className='jungle-fields';let pending=false;
    const form=createJungleControls(fields,jungleDefaults(),()=>{pending=true;},false,false);
    const note=el('p',root,'Настройки обновляют растительность и покрытия. Рельеф и водоёмы задаются при создании мира. Дымка действует на всю сцену.');note.className='hint';
    const apply=el('button',root,'Применить настройки');apply.type='button';apply.className='btn primary jungle-apply';
    const createButton=el('button',root,'Создать новый тропический мир');createButton.type='button';createButton.className='btn jungle-create';createButton.onclick=()=>create(form.read());
    const summary=el('p',root);summary.className='hint';summary.setAttribute('role','status');let signature='',busy=false;
    function sync(force=false){
        const options=[...(model.world.preset==='jungle'?[{id:'world',name:'Весь тропический мир'}]:[]),...model.world.biomes.filter(b=>b.kind==='jungle'&&b.id!=='world-biome').map(b=>({id:b.id,name:b.name}))];
        const chosen=scope.value;if(scope.dataset.options!==JSON.stringify(options)){scope.dataset.options=JSON.stringify(options);scope.replaceChildren();for(const option of options){const o=el('option',scope,option.name);o.value=option.id;}if(options.some(o=>o.id===chosen))scope.value=chosen;}
        const settings=scope.value==='world'?model.world.recipe?.jungle:model.world.biomes.find(b=>b.id===scope.value)?.jungle;
        const key=JSON.stringify([scope.value,settings]);if(force||key!==signature){signature=key;form.sync(settings??jungleDefaults());pending=false;}
        empty.hidden=options.length>0;scope.hidden=options.length<2;fields.disabled=busy||model.busy;apply.disabled=busy||model.busy||options.length===0;createButton.disabled=busy||model.busy;
        if(!pending){const counts=model.world.objects.filter(o=>o.asset.startsWith('jungle-canopy')).length,giants=model.world.objects.filter(o=>o.asset.startsWith('jungle-emergent')).length;summary.textContent=options.length?`${JUNGLE_VARIANTS[(settings??jungleDefaults()).variant].name} · деревьев полога: ${counts} · гигантов: ${giants}`:'';}
    }
    scope.onchange=()=>sync(true);
    apply.onclick=async()=>{if(busy||model.busy)return;busy=true;sync();try{await new Promise<void>(resolve=>setTimeout(resolve,0));const result=applyJungleSettings(model,terrain,history,vegetation,materials,form.read(),scope.value);pending=false;feedback.syncAllUI();feedback.setStatus(result.plantsChanged?'Джунгли обновлены. Рельеф сохранён.':'Атмосфера обновлена без пересоздания растений.');}catch(e){feedback.setStatus(String(e instanceof Error?e.message:e));}finally{busy=false;sync();}};
    feedback.uiSync.jungleSettings=()=>sync();sync();
}
