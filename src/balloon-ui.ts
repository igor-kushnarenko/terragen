import type {BalloonScenario} from './balloon-scenario';
import type {ControlsSystem} from './controls';
import {BALLOON,type BalloonAction} from './balloon-state';
import {balloonPayload} from './balloon-physics';

export function createBalloonInterface(balloon:BalloonScenario,input:ControlsSystem){
    const card=document.createElement('section');card.className='balloon-card';card.id='balloonScenario';
    card.innerHTML='<h3>Воздушный шар</h3><p>Нагревайте воздух для подъёма, открывайте верхний клапан для снижения. По горизонтали шар несёт ветер.</p>';
    document.getElementById('walkScenarios')!.prepend(card);
    const status=document.createElement('p');status.className='balloon-status';card.append(status);
    const updates:(()=>void)[]=[];
    let cancelRemap:(()=>void)|undefined;
    function button(parent:HTMLElement,text:string,action:()=>unknown){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>action());parent.append(b);return b;}
    const start=button(card,'Подготовить шар',()=>balloon.launch()),choose=button(card,'Выбрать площадку на карте',balloon.chooseSite),approach=button(card,'К площадке',balloon.approach);
    const prompt=document.createElement('button');prompt.type='button';prompt.id='balloonBoard';prompt.className='balloon-board';prompt.hidden=true;prompt.addEventListener('click',balloon.board);document.body.append(prompt);
    const hud=document.createElement('aside');hud.id='balloonHUD';hud.className='balloon-hud';hud.hidden=true;hud.setAttribute('aria-label','Приборы воздушного шара');document.body.append(hud);
    const header=document.createElement('div');header.className='balloon-header';header.innerHTML='<strong>Воздушный шар</strong>';hud.append(header);button(header,'Панель · U',()=>balloon.setPointer(!balloon.pointerUI));
    const instruments=document.createElement('div');instruments.className='balloon-instruments';instruments.setAttribute('aria-live','off');hud.append(instruments);
    const hint=document.createElement('p');hint.className='balloon-hint';hud.append(hint);
    const panel=document.createElement('div');panel.className='balloon-panel';hud.append(panel);
    function controls(parent:HTMLElement){
        const node=document.createElement('div');node.className='balloon-flight-controls';parent.append(node);
        node.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,select,textarea')||['Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&(e.target as HTMLElement).matches('button'))e.stopPropagation();});
        const slider=(title:string,min:number,max:number,step:number,get:()=>number,set:(v:number)=>unknown)=>{
            const label=document.createElement('label');label.className='balloon-range';const text=document.createElement('span');text.textContent=title;const range=document.createElement('input');range.type='range';range.min=String(min);range.max=String(max);range.step=String(step);range.setAttribute('aria-label',title);const out=document.createElement('output');label.append(text,range,out);node.append(label);range.addEventListener('input',()=>set(Number(range.value)));updates.push(()=>{if(document.activeElement!==range)range.value=String(get());out.value=String(Math.round(Number(range.value)));});return range;
        };
        slider('Горелка, %',0,100,1,()=>100*(balloon.state?.burner??0),v=>balloon.power(v/100));
        slider('Верхний клапан, %',0,100,1,()=>100*(balloon.state?.vent??0),v=>balloon.vent(v/100));
        const row=document.createElement('div');row.className='balloon-actions';node.append(row);
        const hold=(text:string,action:(on:boolean)=>void)=>{const b=button(row,text,()=>{});b.addEventListener('pointerdown',e=>{b.setPointerCapture(e.pointerId);action(true);});b.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();action(true);}});b.addEventListener('keyup',e=>{if(e.code==='Space'||e.code==='Enter')action(false);});for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])b.addEventListener(name,()=>action(false));};
        hold('Усилить горелку',balloon.boost);hold('Открыть клапан',balloon.holdVent);
        const moor=button(node,'Отпустить швартовку',balloon.mooring);
        const dropRow=document.createElement('div');dropRow.className='balloon-actions';node.append(dropRow);const portion=document.createElement('select');portion.setAttribute('aria-label','Порция балласта');for(const kg of [1,5,10,20])portion.add(new Option(kg+' кг',String(kg)));portion.value='5';dropRow.append(portion);button(dropRow,'Сбросить балласт',()=>balloon.ballast(Number(portion.value)));
        const anchors=document.createElement('div');anchors.className='balloon-actions';node.append(anchors);button(anchors,'Сбросить якорь',()=>balloon.anchor('drop'));button(anchors,'Поднять якорь',()=>balloon.anchor('raise'));button(anchors,'Стоп лебёдка',()=>balloon.anchor('stop'));
        const options=document.createElement('details');options.innerHTML='<summary>Параметры полёта и клавиши</summary>';node.append(options);
        function check(title:string,get:()=>boolean,set:(v:boolean)=>void){const l=document.createElement('label');l.className='balloon-option';const c=document.createElement('input');c.type='checkbox';c.addEventListener('change',()=>set(c.checked));l.append(c,document.createTextNode(title));options.append(l);updates.push(()=>c.checked=get());return c;}
        const mode=document.createElement('select');mode.setAttribute('aria-label','Режим полёта');mode.add(new Option('Пейзажный режим','scenic'));mode.add(new Option('Ручной режим','manual'));mode.onchange=()=>balloon.setting('mode',mode.value as 'manual'|'scenic');options.append(mode);
        const assist=check(' Помощник удержания высоты',()=>balloon.state?.options.assist??false,v=>balloon.setting('assist',v));
        const target=document.createElement('input');target.type='number';target.min='5';target.max='500';target.step='5';target.setAttribute('aria-label','Целевая высота над землёй, м');target.onchange=()=>{const value=Number(target.value);if(Number.isFinite(value))balloon.setting('targetAGL',Math.max(5,Math.min(500,value)));};const targetLabel=document.createElement('label');targetLabel.textContent='Высота над землёй, м ';targetLabel.append(target);options.append(targetLabel);
        check(' Без ограничений ресурсов',()=>balloon.state?.options.unlimited??false,v=>balloon.setting('unlimited',v));
        check(' Уменьшить покачивание камеры',()=>balloon.state?.options.reduceMotion??true,v=>balloon.setting('reduceMotion',v));
        check(' Внешняя камера',()=>balloon.state?.options.external??false,v=>balloon.setting('external',v));
        button(options,'Пополнить на старте',balloon.refill);
        const wind=document.createElement('p');wind.className='balloon-hint';options.append(wind);
        const titles:Record<BalloonAction,string>={board:'Сесть / выйти',boost:'Горелка',vent:'Выпуск воздуха',ballast:'Балласт',anchor:'Якорь',camera:'Камера',increase:'Мощность +',decrease:'Мощность −'};
        for(const action of Object.keys(titles) as BalloonAction[]){let waiting=false;const b=button(options,titles[action],()=>{
            cancelRemap?.();waiting=true;
            b.textContent='Нажмите клавишу · Esc — отмена';
            const capture=(e:KeyboardEvent)=>{e.preventDefault();e.stopImmediatePropagation();cancelRemap?.();if(e.code!=='Escape')balloon.remap(action,e.code);update();};cancelRemap=()=>{window.removeEventListener('keydown',capture,true);waiting=false;cancelRemap=undefined;};window.addEventListener('keydown',capture,true);
        });updates.push(()=>{if(!waiting)b.textContent=titles[action]+' · '+keyName(balloon.state?.options.bindings[action]??'');});}
        const end=document.createElement('div');end.className='balloon-actions';node.append(end);button(end,'Выйти после посадки',balloon.exit);button(end,'Вернуться к старту',()=>balloon.stop());
        updates.push(()=>{node.hidden=!balloon.active;const s=balloon.state;if(!s)return;moor.textContent=s.moored?'Отпустить швартовку':'Закрепить после посадки';moor.disabled=!s.seated;mode.value=s.options.mode;assist.disabled=s.options.mode==='manual';if(document.activeElement!==target)target.value=String(s.options.targetAGL);wind.textContent='Ветровые слои: '+balloon.atmosphere.map(v=>`${v.height.toFixed(0)} м: ${Math.hypot(v.air.wind[0],v.air.wind[2]).toFixed(1)} м/с`).join(' · ');});
    }
    controls(panel);controls(card);
    let prev='';
    function update(){
        const s=balloon.state,m=balloon.metrics;status.textContent=balloon.status;
        if(!s)cancelRemap?.();
        start.disabled=balloon.active;choose.disabled=balloon.seated;approach.hidden=!s||s.seated||!s.moored;
        hud.hidden=!s?.seated||!input.walk.on||input.walk.paused||input.photoMode.on;
        panel.hidden=!balloon.pointerUI;hud.classList.toggle('compact',!balloon.pointerUI);
        prompt.hidden=!balloon.canBoard||input.photoMode.on;prompt.textContent=keyName(s?.options.bindings.board??'KeyB')+' · Сесть в корзину';
        if(s&&m){
            const speed=Math.hypot(s.basket.velocity[0],s.basket.velocity[2]),wind=Math.hypot(m.air.wind[0],m.air.wind[2]),heading=(Math.atan2(m.air.wind[0],m.air.wind[2])*180/Math.PI+360)%360;
            const anchor=s.broken?'Трос оборван':!s.anchorOut?'Якорь убран':s.hooked?'Якорь держит':s.winch==='raise'?'Якорь поднимается':'Якорь свободен';
            const text=`<span>Над землёй <b>${m.agl.toFixed(1)} м</b></span><span>Высота <b>${s.basket.position[1].toFixed(0)} м</b></span><span>Вертикально <b>${s.basket.velocity[1].toFixed(1)} м/с</b></span><span>По земле <b>${speed.toFixed(1)} м/с</b></span><span>Оболочка <b>${(s.temperature-273.15).toFixed(0)} / 125 °C</b></span><span>Ветер <b>${wind.toFixed(1)} м/с · ${heading.toFixed(0)}°</b></span><span>Топливо <b>${s.fuel.toFixed(1)} кг · ${(s.fuel/45*100).toFixed(0)}%</b></span><span>Балласт <b>${s.ballast.toFixed(0)} кг</b></span><span>${anchor} <b>${s.ropeLength.toFixed(1)} м · ${(m.tension/1000).toFixed(1)} кН</b></span><span>Лебёдка <b>${(s.battery/BALLOON.batteryCapacity*100).toFixed(0)}%${m.winchStalled?' · перегрузка':''}</b></span><span>Полная масса <b>${(balloonPayload(s)+m.air.pressure/(287.05*s.temperature)*BALLOON.volume).toFixed(0)} кг</b></span><span>Запас при расходе <b>${m.power>.01?(s.fuel/(m.power*BALLOON.fuelFlow)/60).toFixed(0)+' мин':'—'}</b></span>`;
            if(text!==prev){instruments.innerHTML=text;prev=text;}
            hint.textContent=(s.options.assist?`Помощник высоты · горелка ${Math.round(m.power*100)}%. `:'')+(s.moored?'Швартовка закреплена. U — панель пилота.':`${keyName(s.options.bindings.boost)} — нагрев · ${keyName(s.options.bindings.vent)} — клапан · ${keyName(s.options.bindings.camera)} — камера · U — панель · Esc — пауза`);
        }
        updates.forEach(fn=>fn());
    }
    balloon.bindStatus(update);update();
}
function keyName(code:string){return code==='Space'?'Пробел':code==='ArrowUp'?'↑':code==='ArrowDown'?'↓':code.replace('Key','');}
