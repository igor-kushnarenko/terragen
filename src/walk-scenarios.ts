import type { ControlsSystem } from './controls';
import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import type { MaterialsSystem } from './materials';
import type { NatureAudio } from './nature-audio';
import type { RenderingSystem } from './rendering';
import type { EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
import { applyMeteorImpact, createMeteorPlan, meteorContact, type FireSite, type MeteorPlan } from './meteor-impact';
import { createMeteorEffects } from './meteor-effects';
import type { Vec3 } from './world';
import {FixedStepClock} from './physics';
import {mulberry32} from './noise';
import {recordOperation} from './operations';
import {waterLevelAt} from './water-math';
import {PointLight} from 'three';

export const ARMAGEDDON_PROFILES={low:{flights:3,effects:6,fires:10},balanced:{flights:4,effects:8,fires:20},high:{flights:5,effects:10,fires:32}} as const;
type Effects=ReturnType<typeof createMeteorEffects>;
type Entry={id:string;plan:MeteorPlan;phase:'flight'|'aftermath';elapsed:number;fireAge:number;previous:Vec3;fires:FireSite[]};
export function createWalkScenarios(model: EditorModel, render: RenderingSystem, terrain: TerrainSystem, vegetation: VegetationSystem, materials: MaterialsSystem, history: HistorySystem, input: ControlsSystem, audio: NatureAudio, feedback: Feedback,onImpact:(rects:readonly (readonly [number,number,number,number])[])=>void=()=>{}) {
    const clock=new FixedStepClock(),slots:{effects:Effects;entry?:Entry}[]=[];
    const light=new PointLight(0xff782d,0,180,2);light.name='Scenario illumination';render.scene.add(light);
    let mode:'single'|'armageddon'|null=null,simulationTime=0,nextSpawn=0,uiTime=0,scenarioSeed=0,spawned=0,impacts=0,peakFlights=0;
    let random=mulberry32(0),notify=()=>{},message='Выберите сценарий и нажмите «Запустить».',lastPlan:MeteorPlan|undefined;
    let beforeStart=()=>{};
    let impactSummary:{craterRadius:number;destroyed:number;ignited:number;underwater:boolean}|undefined;
    let worldObjects=model.world.objects,heights=model.heights,terrainRevision=model.terrainRevision,objectIds=new Set<string>();
    const flights=()=>slots.filter(s=>s.entry?.phase==='flight');
    function rememberWorld(){heights=model.heights;worldObjects=model.world.objects;terrainRevision=model.terrainRevision;objectIds=new Set(worldObjects.map(o=>o.id));}
    function stop(text='Сценарий завершён. Последствия ударов можно отменить в редакторе.'){
        if(!mode&&!slots.length)return;for(const slot of slots)slot.effects.dispose();slots.length=0;light.intensity=0;audio.stopMeteor();mode=null;clock.reset();simulationTime=0;lastPlan=undefined;message=text;notify();
    }
    function release(slot:typeof slots[number]){if(slot.entry)audio.stopMeteor(slot.entry.id);slot.entry=undefined;slot.effects.hide();}
    function spawn(count:number){
        const settings=ARMAGEDDON_PROFILES[model.state.quality],maxFlights=mode==='single'?1:settings.flights,maxEffects=mode==='single'?1:settings.effects;
        for(let i=0;i<count&&flights().length<maxFlights;i++){
            let slot=slots.find(s=>!s.entry);
            if(!slot&&slots.length>=maxEffects){slot=slots.filter(s=>s.entry?.phase==='aftermath'&&s.entry.elapsed>2.5).sort((a,b)=>b.entry!.elapsed-a.entry!.elapsed)[0];if(slot)release(slot);}
            if(!slot){if(slots.length>=maxEffects)break;const budget=mode==='single'?undefined:Math.max(24,Math.floor({low:180,balanced:420,high:760}[model.state.quality]/settings.effects));slot={effects:createMeteorEffects(model,render.scene,budget)};slots.push(slot);
                // Prepare even the currently hidden explosion/ring materials while
                // the meteor is still in flight, before the impact needs them.
                void render.renderer.compileAsync?.(slot.effects.root,render.camera,render.scene).catch(()=>{});
            }
            const seed=mode==='single'?scenarioSeed:Math.floor(random()*4294967296),plan=createMeteorPlan(model,terrain,input.walk.feet.toArray() as Vec3,seed),id='meteor-'+(++spawned);
            slot.entry={id,plan,phase:'flight',elapsed:0,fireAge:0,previous:[...plan.start],fires:[]};lastPlan=plan;slot.effects.start(plan);audio.meteor('flight',plan.start,plan.radius,id);
        }
        peakFlights=Math.max(peakFlights,flights().length);
    }
    function begin(kind:'single'|'armageddon',seed:number){
        if(!input.walk.on||model.busy||mode)return false;
        beforeStart();
        history.flush();input.clearKeys();mode=kind;scenarioSeed=seed>>>0;random=mulberry32(scenarioSeed);simulationTime=uiTime=spawned=impacts=peakFlights=0;impactSummary=undefined;clock.reset();rememberWorld();
        void audio.unlock();spawn(kind==='single'?1:2+Math.floor(random()*2));nextSpawn=1.4+random()*1.6;
        message=kind==='single'?`Метеорит · диаметр ${(lastPlan!.radius*2).toFixed(1)} м · следите за небом`:'Армагеддон начался: метеоритные дожди продолжаются до остановки сценария.';
        input.setPaused(false);feedback.setStatus(message);notify();return true;
    }
    function impactBatch(arriving:typeof slots){
        const results:{slot:typeof slots[number];result:ReturnType<typeof applyMeteorImpact>}[]=[];
        const committed=history.transactionChanged(mode==='single'?'Сценарий: падение метеорита':`Армагеддон: ${arriving.length} удар(а)`,()=>{
            for(const slot of arriving){const e=slot.entry!,result=applyMeteorImpact(model,terrain,e.plan);results.push({slot,result});recordOperation(model,'meteor',e.plan.seed,{scenarioSeed,armageddon:mode==='armageddon',radius:e.plan.radius,x:e.plan.target[0],y:e.plan.target[1],z:e.plan.target[2]});}
            const rects=results.map(({result})=>result.rect);
            for(const rect of rects)terrain.updateMeshRect(...rect);terrain.recomputeRange();terrain.updateHeightTex();materials.splatTex.needsUpdate=materials.detailTex.needsUpdate=true;vegetation.refreshRegions(rects);onImpact(rects);
        });
        if(!committed){stop('Сценарий остановлен: мир занят.');return;}
        rememberWorld();
        for(const {slot,result}of results){const e=slot.entry!,settings=ARMAGEDDON_PROFILES[model.state.quality],limit=mode==='single'?settings.fires:Math.max(2,Math.floor(settings.fires/settings.effects));
            e.fires=result.fires.slice(0,limit);e.phase='aftermath';e.elapsed=e.fireAge=0;e.previous=[...e.plan.target];impacts++;lastPlan=e.plan;
            impactSummary={craterRadius:result.craterRadius,destroyed:result.destroyed,ignited:result.fires.length,underwater:result.underwater};slot.effects.hit(result);audio.meteor('impact',e.plan.target,e.plan.radius,e.id);
            message=`${result.underwater?'Удар в воду':'Падение метеорита'} · кратер ≈${Math.round(result.craterRadius*2)} м · разрушено ${result.destroyed} · очагов ${result.fires.length}`;
        }
        feedback.setStatus(mode==='armageddon'?`Армагеддон · ударов ${impacts} · в полёте ${flights().length}`:message);notify();
    }
    function step(dt:number,rain:number){
        simulationTime+=dt;const arriving:typeof slots=[];
        for(const slot of slots){const e=slot.entry;if(!e)continue;e.elapsed+=dt;
            if(e.phase==='flight'){
                const t=Math.min(1,e.elapsed/e.plan.duration),next=e.plan.start.map((v,i)=>v+(e.plan.target[i]-v)*t) as Vec3,hit=meteorContact(model,terrain,e.previous,next,e.plan.radius);
                slot.effects.fly(t,dt);audio.moveMeteor(next,e.id);
                if(hit||t===1){e.plan.target=hit??next;arriving.push(slot);}else e.previous=next;
            }else{
                e.fireAge+=dt*(1+Math.max(0,rain)*3);e.fires=e.fires.filter(s=>objectIds.has(s.id)&&terrain.getH(s.position[0],s.position[2])>waterLevelAt(model.state.water,model.world.waterBodies,s.position[0],s.position[2])+.3);
                slot.effects.aftermath(e.elapsed,dt,e.fireAge<40?e.fires:[],Math.max(0,1-e.fireAge/40));
                if(e.elapsed>12&&(!e.fires.length||e.fireAge>46)){if(mode==='single'){stop();return;}release(slot);}
            }
        }
        if(arriving.length)impactBatch(arriving);if(!mode)return;
        if(mode==='armageddon'&&simulationTime+1e-9>=nextSpawn){spawn(1+Math.floor(random()*3));nextSpawn=simulationTime+1.3+random()*2.1;}
        uiTime+=dt;if(uiTime>=.2){uiTime=0;notify();}
    }
    function update(dt:number,rain=0,photo=false){
        if(!mode)return;
        if(!input.walk.on){stop();return;}
        if(heights!==model.heights||worldObjects!==model.world.objects||terrainRevision!==model.terrainRevision){stop('Сценарий завершён после изменения мира.');return;}
        if(input.walk.paused||model.busy||photo||typeof document!=='undefined'&&(document.hidden||!document.hasFocus())){audio.pauseMeteor();return;}
        try{
            clock.advance(dt,stepDt=>{if(mode)step(stepDt,rain);});
            let strongest:Effects['illumination']|undefined,score=0;
            for(const slot of slots)if(slot.entry){slot.effects.update(Math.max(0,Math.min(1,dt)),render.renderer.domElement.height*.5);const glow=slot.effects.illumination,d=render.camera.position.distanceTo(glow.position),weight=glow.intensity*Math.max(0,1-(d/glow.distance)**4)**2/(1+d*d);if(weight>score){score=weight;strongest=glow;}}
            light.intensity=strongest?.intensity??0;if(strongest){light.position.copy(strongest.position);light.distance=strongest.distance;}
        }catch(error){stop('Ошибка сценария: '+(error instanceof Error?error.message:String(error)));feedback.setStatus(message);}
    }
    return {launch:(seed=crypto.getRandomValues(new Uint32Array(1))[0])=>begin('single',seed),launchArmageddon:(seed=crypto.getRandomValues(new Uint32Array(1))[0])=>begin('armageddon',seed),stop,update,bindBeforeStart(callback:()=>void){beforeStart=callback;},bindStatus(callback:()=>void){notify=callback;notify();},
        get active(){return mode!==null;},get status(){return mode==='armageddon'?`Армагеддон · в полёте ${flights().length} · ударов ${impacts} · запущено ${spawned}`:message;},
        get guidance(){const flying=flights().map(s=>s.entry!),entry=flying.sort((a,b)=>Math.hypot(a.previous[0]-input.walk.feet.x,a.previous[2]-input.walk.feet.z)-Math.hypot(b.previous[0]-input.walk.feet.x,b.previous[2]-input.walk.feet.z))[0],plan=entry?.plan??lastPlan;if(!mode||!plan)return '';
            const point=entry?.previous??plan.target,dx=point[0]-input.walk.feet.x,dz=point[2]-input.walk.feet.z,angle=Math.atan2(dx,-dz)+(input.walk.yaw??0),index=((Math.round(angle/(Math.PI/4))%8)+8)%8;
            const directions=['↑ впереди','↗ справа впереди','→ справа','↘ справа сзади','↓ сзади','↙ слева сзади','← слева','↖ слева впереди'];
            return `${mode==='armageddon'?`☄ Армагеддон · в полёте ${flying.length} · ударов ${impacts} · `:'☄ '}${entry?'Метеорит':'Место падения'} · ${directions[index]} · ${Math.round(Math.hypot(dx,dz))} м`;},
        get statistics(){const entries=slots.flatMap(s=>s.entry?[s.entry]:[]),primary=entries.find(e=>e.phase==='flight')??entries[0],fx=slots.reduce((v,s)=>{const q=s.effects.statistics;v.particles+=q.particles;v.capacity+=q.capacity;return v;},{particles:0,capacity:0});
            return {phase:mode?(flights().length?'flight':'aftermath'):'idle',mode,time:mode==='armageddon'?simulationTime:primary?.elapsed??0,seed:scenarioSeed,spawned,impacts,activeFlights:flights().length,peakFlights,meteor:lastPlan?structuredClone(lastPlan):null,meteors:entries.map(e=>({id:e.id,phase:e.phase,time:e.elapsed,position:[...e.previous] as Vec3,plan:structuredClone(e.plan)})),impact:impactSummary?{...impactSummary}:null,fires:entries.reduce((n,e)=>n+e.fires.length,0),...fx};},
    };
}
export type WalkScenarios=ReturnType<typeof createWalkScenarios>;
