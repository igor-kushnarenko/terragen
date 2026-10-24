import {getModel} from './model-library';
import {defaultObjectAnimation} from './animated-models';
import type {WorldObject,ObjectAnimation} from './world';
import type {VegetationSystem} from './vegetation';
import type {WorldEdits} from './edits';
import type {Feedback} from './feedback';

export function createObjectAnimationControls(parent:HTMLElement,selected:()=>WorldObject|undefined,vegetation:VegetationSystem,edits:WorldEdits,feedback:Feedback){
    function el<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text=''){const node=document.createElement(tag);node.textContent=text;host.append(node);return node;}
    const panel=el('fieldset',parent);panel.className='object-animation';panel.hidden=true;el('legend',panel,'Анимация модели');
    const info=el('p',panel);info.className='hint';
    const label=el('label',panel,'Клип'),clip=el('select',label);clip.setAttribute('aria-label','Анимационный клип');
    const actions=el('div',panel);actions.className='btns';
    const play=el('button',actions,'Пауза'),restart=el('button',actions,'В начало');for(const b of [play,restart]){b.type='button';b.className='btn';}
    const speedLabel=el('label',panel,'Скорость'),speed=el('input',speedLabel);speed.type='number';speed.min='.1';speed.max='4';speed.step='.1';speed.setAttribute('aria-label','Скорость анимации');
    const loopLabel=el('label',panel);loopLabel.className='chk';const loop=el('input',loopLabel);loop.type='checkbox';loop.setAttribute('aria-label','Повторять анимацию');el('span',loopLabel,'Повторять');
    const timelineLabel=el('label',panel,'Позиция в клипе'),timeline=el('input',timelineLabel);timeline.type='range';timeline.min='0';timeline.step='.01';timeline.setAttribute('aria-label','Позиция анимации, секунды');
    const time=el('output',panel);time.className='hint';
    el('p',panel,'Копии воспроизводятся независимо. Положение объекта задаётся инструментами выше; анимация движется внутри него. Пауза и выбранная позиция сохраняются в проекте.').className='hint';
    let key='',duration=0,lastUpdate=0;
    function commit(patch:Partial<ObjectAnimation>,restart=false){const item=selected();if(!item)return;try{const runtime=vegetation.animationState(item.id),base=item.animation??defaultObjectAnimation(getModel(item.asset));edits.updateObject(item.id,{animation:{...base,time:runtime?.time??base.time,...patch,...(restart?{restart:((base.restart??0)+1)>>>0}:{})}});}catch(e){feedback.setStatus(e instanceof Error?e.message:String(e));}sync();}
    clip.onchange=()=>commit({clip:Number(clip.value),time:0,playing:Number(clip.value)>=0});
    play.onclick=()=>{const item=selected(),state=item&&vegetation.animationState(item.id);if(state){const finished=!state.playing&&state.time>=state.duration-.001;commit({playing:!state.playing,time:finished?0:state.time},finished);}};
    function changeSpeed(){const item=selected();if(!item)return;const current=(item.animation??defaultObjectAnimation(getModel(item.asset))).speed,value=speed.valueAsNumber;if(!Number.isFinite(value)||value<.1||value>4){speed.value=String(current);feedback.setStatus('Скорость анимации: от 0,1 до 4.');return;}if(value!==current)commit({speed:value});}
    restart.onclick=()=>commit({time:0,playing:false},true);speed.onchange=speed.onblur=changeSpeed;loop.onchange=()=>commit({loop:loop.checked?'repeat':'once'});
    timeline.oninput=()=>time.textContent=`${Number(timeline.value).toFixed(2)} / ${duration.toFixed(2)} с`;
    timeline.onchange=()=>commit({time:Number(timeline.value),playing:false},true);
    function sync(){
        const item=selected(),template=item?getModel(item.asset):undefined;panel.hidden=!template?.rig;if(!item||!template?.rig)return;
        const settings=item.animation??defaultObjectAnimation(template),signature=item.asset+'/'+template.rig.clips.map(c=>c.uuid).join('/');
        if(signature!==key){key=signature;clip.replaceChildren();const rest=el('option',clip,'Исходная поза');rest.value='-1';template.rig.clips.forEach((c,i)=>{const o=el('option',clip,`${c.name||'Клип '+(i+1)} · ${c.duration.toFixed(2)} с`);o.value=String(i);});}
        clip.value=String(settings.clip);if(document.activeElement!==speed)speed.value=String(settings.speed);loop.checked=settings.loop==='repeat';duration=template.rig.clips[settings.clip]?.duration??0;timeline.max=String(duration);play.disabled=restart.disabled=speed.disabled=loop.disabled=timeline.disabled=duration===0;
        info.textContent=`Костей: ${template.rig.bones} · клипов: ${template.rig.clips.length}`;update(true);
    }
    function update(force=false){if(panel.hidden||!force&&performance.now()-lastUpdate<100)return;lastUpdate=performance.now();const item=selected(),state=item&&vegetation.animationState(item.id);if(!state)return;play.textContent=state.playing?'Пауза':'Воспроизвести';if(document.activeElement!==timeline){timeline.value=String(state.time);time.textContent=`${state.time.toFixed(2)} / ${duration.toFixed(2)} с`;}}
    return {sync,update};
}
