import { Vector3,type Camera } from 'three';
import { mulberry32 } from './noise';
import { createSoundEnvironment,createStepTracker,footstepSamples,noiseSamples,type SoundPose,type StepSurface } from './soundscape';
import type { EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { Vec3 } from './world';
export function createNatureAudio(model:EditorModel,terrain:TerrainSystem,objectSurface:(x:number,z:number,y:number)=>StepSurface|undefined=()=>undefined,contextFactory:()=>AudioContext=()=>new AudioContext()) {
    const environment=createSoundEnvironment(model,terrain),tracker=createStepTracker((x,z,y)=>objectSurface(x,z,y)??environment.surface(x,z));
    let context:AudioContext|undefined,master:GainNode,ambient:GainNode,wind:GainNode,leaves:GainNode,water:GainNode,waterPanner:PannerNode;
    let windFilter:BiquadFilterNode,available=true,focused=true,notify=()=>{},timer=0,birdTimer=3,eventIndex=0,lastStepAt=0,simulationTime=0;
    let random=mulberry32(model.seeds.scatter^0x8592),seed=model.seeds.scatter,env=environment.sample(0,0);
    const loops:AudioBufferSourceNode[]=[],voices=new Set<AudioScheduledSourceNode>(),buffers=new Map<StepSurface,AudioBuffer[]>(),forward=new Vector3(),up=new Vector3();
    const targets=new WeakMap<AudioParam,number>();
    type MeteorGroup={sources:Set<AudioScheduledSourceNode>;flight?:{source:AudioBufferSourceNode;gain:GainNode;spatial:PannerNode;volume:number}};
    const meteorGroups=new Map<string,MeteorGroup>();
    let meteorBuffer:AudioBuffer|undefined;
    let balloonSound:{power:number;position:Vec3;relative?:number}|null=null;
    let burner:{source:AudioBufferSourceNode;gain:GainNode;spatial:PannerNode;filter:BiquadFilterNode}|undefined;
    function stopBurner(){if(!burner)return;burner.source.stop();burner.source.disconnect();burner.gain.disconnect();burner.spatial.disconnect();burner.filter.disconnect();burner=undefined;}
    function updateBurner(){
        if(!balloonSound||!context)return;
        if(!burner){const source=context.createBufferSource(),gain=context.createGain(),spatial=panner(),filter=context.createBiquadFilter();source.buffer=buffer(noiseSamples(context.sampleRate,3,0xba1100,true));source.loop=true;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=1100;source.connect(filter);filter.connect(gain);gain.connect(spatial);spatial.connect(master);source.start();burner={source,gain,spatial,filter};}
        const p=balloonSound.position;burner.spatial.positionX.value=p[0];burner.spatial.positionY.value=p[1]+2;burner.spatial.positionZ.value=p[2];set(burner.gain.gain,balloonSound.power*.65,.08);
    }
    const set=(param:AudioParam,value:number,time=0.6)=>{if(targets.get(param)!==value){param.setTargetAtTime(value,context!.currentTime,time);targets.set(param,value);}};
    function buffer(data:Float32Array){const result=context!.createBuffer(1,data.length,context!.sampleRate);result.copyToChannel(data as Float32Array<ArrayBuffer>,0);return result;}
    function panner(){const node=context!.createPanner();node.panningModel='HRTF';node.distanceModel='inverse';node.refDistance=8;node.rolloffFactor=1.2;node.maxDistance=400;return node;}
    function loop(data:Float32Array,filter:BiquadFilterNode|null,destination:AudioNode) {
        const source=context!.createBufferSource();source.buffer=buffer(data);source.loop=true;if(filter){source.connect(filter);filter.connect(destination);}else source.connect(destination);source.start();loops.push(source);
    }
    function initialize() {
        context=contextFactory();master=context.createGain();master.gain.value=0;const limiter=context.createDynamicsCompressor();limiter.threshold.value=-10;limiter.ratio.value=4;master.connect(limiter);limiter.connect(context.destination);
        ambient=context.createGain();ambient.gain.value=model.state.ambienceVolume;ambient.connect(master);
        wind=context.createGain();leaves=context.createGain();water=context.createGain();wind.gain.value=leaves.gain.value=water.gain.value=0;
        wind.connect(ambient);leaves.connect(ambient);waterPanner=panner();water.connect(waterPanner);waterPanner.connect(ambient);
        windFilter=context.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=420;
        loop(noiseSamples(context.sampleRate,8,12345,true),windFilter,wind);
        const leafFilter=context.createBiquadFilter();leafFilter.type='bandpass';leafFilter.frequency.value=1600;leafFilter.Q.value=0.35;loop(noiseSamples(context.sampleRate,7,52631),leafFilter,leaves);
        const waterFilter=context.createBiquadFilter();waterFilter.type='lowpass';waterFilter.frequency.value=2100;loop(noiseSamples(context.sampleRate,9,82713),waterFilter,water);
        context.onstatechange=()=>notify();notify();
    }
    async function unlock() {
        if(!model.state.soundEnabled||!focused||typeof document!=='undefined'&&document.hidden)return;
        try{if(!context)initialize();if(context!.state!=='running')await context!.resume();notify();}catch{available=false;notify();}
    }
    function own(source:AudioScheduledSourceNode,nodes:AudioNode[],scenarioId?:string){
        voices.add(source);let group:MeteorGroup|undefined;
        if(scenarioId!==undefined){group=meteorGroups.get(scenarioId)??{sources:new Set()};meteorGroups.set(scenarioId,group);group.sources.add(source);}
        source.onended=()=>{voices.delete(source);if(group){group.sources.delete(source);if(group.flight?.source===source)group.flight=undefined;if(!group.sources.size&&meteorGroups.get(scenarioId!)===group)meteorGroups.delete(scenarioId!);}source.disconnect();nodes.forEach(node=>node.disconnect());};
    }
    function stopMeteor(id?:string){for(const [key,group]of [...meteorGroups])if(id===undefined||key===id){for(const source of [...group.sources])source.stop();meteorGroups.delete(key);}}
    function meteor(kind:'flight'|'impact',position:Vec3,radius:number,id='single'){
        stopMeteor(id);if(!context||!model.state.soundEnabled)return;
        meteorBuffer??=buffer(noiseSamples(context.sampleRate,4,0x7ea2,true));
        const spatial=panner(),gain=context.createGain(),filter=context.createBiquadFilter(),source=context.createBufferSource(),now=context.currentTime;
        spatial.refDistance=70;spatial.maxDistance=4000;spatial.rolloffFactor=1;
        spatial.positionX.value=position[0];spatial.positionY.value=position[1];spatial.positionZ.value=position[2];
        source.buffer=meteorBuffer;source.loop=kind==='flight';filter.type='lowpass';filter.frequency.value=kind==='flight'?1000:650;
        source.connect(filter);filter.connect(gain);gain.connect(spatial);spatial.connect(master);own(source,[filter,gain,spatial],id);
        const volume=Math.min(3.5,.15+Math.sqrt(radius)*.65);
        if(kind==='flight'){gain.gain.value=volume;meteorGroups.get(id)!.flight={source,gain,spatial,volume};source.start();}
        else{
            gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume*2,now+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+3.8);source.start();source.stop(now+4);
            const boom=context.createOscillator(),envelope=context.createGain();boom.type='sine';boom.frequency.setValueAtTime(65,now);boom.frequency.exponentialRampToValueAtTime(22,now+1.6);
            envelope.gain.setValueAtTime(volume*.8,now);envelope.gain.exponentialRampToValueAtTime(.0001,now+2.2);boom.connect(envelope);envelope.connect(spatial);own(boom,[envelope],id);boom.start();boom.stop(now+2.3);
        }
    }
    function moveMeteor(position:Vec3,id='single'){const flight=meteorGroups.get(id)?.flight;if(!flight||!context)return;const {spatial,gain,volume}=flight;spatial.positionX.value=position[0];spatial.positionY.value=position[1];spatial.positionZ.value=position[2];set(gain.gain,volume,.08);}
    function footstep(surface:StepSurface,intensity:number,at:number) {
        if(voices.size>20)return;
        let variants=buffers.get(surface);if(!variants){variants=Array.from({length:4},(_,i)=>buffer(footstepSamples(surface,context!.sampleRate,8712+i*251)));buffers.set(surface,variants);}
        const source=context!.createBufferSource(),gain=context!.createGain();source.buffer=variants[eventIndex++%variants.length];source.playbackRate.value=0.94+random()*0.12;
        gain.gain.value=0.5*model.state.footstepVolume*intensity;source.connect(gain);gain.connect(master);own(source,[gain]);source.start(at);
    }
    function bird(camera:Camera,strength:number) {
        if(strength<0.05||voices.size>16)return;
        const spatial=panner(),gain=context!.createGain(),angle=random()*Math.PI*2,distance=18+random()*35;
        spatial.positionX.value=camera.position.x+Math.cos(angle)*distance;spatial.positionZ.value=camera.position.z+Math.sin(angle)*distance;spatial.positionY.value=camera.position.y+4+random()*5;spatial.connect(gain);gain.connect(ambient);gain.gain.value=strength*0.24;
        const base=1700+random()*1500,now=context!.currentTime;
        for(let i=0;i<3;i++) {
            const oscillator=context!.createOscillator(),envelope=context!.createGain(),at=now+i*0.22;oscillator.type='sine';oscillator.frequency.setValueAtTime(base*(i%2?0.82:1),at);oscillator.frequency.exponentialRampToValueAtTime(base*1.25,at+0.055);oscillator.frequency.exponentialRampToValueAtTime(base*0.75,at+0.14);
            envelope.gain.setValueAtTime(0,at);envelope.gain.linearRampToValueAtTime(0.45,at+0.018);envelope.gain.exponentialRampToValueAtTime(0.0001,at+0.16);oscillator.connect(envelope);envelope.connect(spatial);
            own(oscillator,i===2?[envelope,spatial,gain]:[envelope]);oscillator.start(at);oscillator.stop(at+0.18);
        }
    }
    function update(dt:number,camera:Camera,pose:SoundPose,weather:{rain:number;snow:number;dark:number}) {
        const active=pose.on&&!pose.paused&&!model.busy&&focused&&!(typeof document!=='undefined'&&document.hidden)&&model.state.soundEnabled;
        if(!active){tracker.reset();if(context?.state==='running')set(master.gain,0,0.05);return;}
        if(!context||context.state!=='running'){tracker.take();return;}
        if(seed!==model.seeds.scatter){seed=model.seeds.scatter;random=mulberry32(seed^0x8592);birdTimer=3;}
        set(master.gain,model.state.soundVolume,0.18);set(ambient.gain,model.state.ambienceVolume,0.2);
        updateBurner();
        const listener=context.listener,now=context.currentTime;camera.getWorldDirection(forward);up.set(0,1,0).applyQuaternion(camera.quaternion);
        for(const [param,value]of [[listener.positionX,camera.position.x],[listener.positionY,camera.position.y],[listener.positionZ,camera.position.z],[listener.forwardX,forward.x],[listener.forwardY,forward.y],[listener.forwardZ,forward.z],[listener.upX,up.x],[listener.upY,up.y],[listener.upZ,up.z]] as const)param.setValueAtTime(value,now);
        timer-=dt;if(timer<=0){env=environment.sample(pose.feet.x,pose.feet.z);timer=0.35;}
        const flightWind=balloonSound?.relative;
        set(wind.gain,flightWind===undefined?env.wind*(1-env.forest*0.35)*(1+weather.rain*0.5):Math.min(.8,flightWind*.035));set(windFilter.frequency,320+(flightWind??model.state.windSpeed)*180);
        const aboveForest=flightWind===undefined?1:Math.exp(-Math.max(0,pose.feet.y-terrain.getH(pose.feet.x,pose.feet.z))/50);
        set(leaves.gain,env.forest*(0.055+model.state.windSpeed*0.04)*(1-weather.snow*0.65)*aboveForest);set(water.gain,env.water&&env.water.distance<180?0.28:0,1);
        if(env.water){set(waterPanner.positionX,env.water.position.x,0.4);set(waterPanner.positionY,env.water.position.y,0.4);set(waterPanner.positionZ,env.water.position.z,0.4);}
        const events=tracker.take();for(const event of events) {
            // Catch-up physics steps preserve spacing without playing old sounds after a pause.
            const at=Math.max(now,lastStepAt+0.12);if(at>now+0.5)break;footstep(event.surface,event.intensity,at);lastStepAt=at;
        }
        birdTimer-=dt;if(birdTimer<=0){bird(camera,env.birds*(1-weather.rain*0.85)*(1-weather.dark*0.5)*aboveForest);birdTimer=4+random()*7;}
    }
    const gesture=()=>{void unlock();},blur=()=>{focused=false;tracker.reset();if(context?.state==='running'){set(master.gain,0,0.03);setTimeout(()=>{if(!focused)void context?.suspend();},150);}},focus=()=>{focused=true;},visibility=()=>{if(document.hidden)blur();else focus();};
    if(typeof window!=='undefined'){window.addEventListener('pointerdown',gesture,{capture:true});window.addEventListener('keydown',gesture,{capture:true});window.addEventListener('blur',blur);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);}
    return {unlock,update,meteor,moveMeteor,stopMeteor,balloon(power:number,position:Vec3|null,relative?:number){balloonSound=position?{power,position,relative}:null;if(!position)stopBurner();},pauseMeteor(){if(context)for(const group of meteorGroups.values())if(group.flight)set(group.flight.gain.gain,0,.03);},reset(){stopMeteor();stopBurner();balloonSound=null;tracker.reset();lastStepAt=0;timer=0;voices.forEach(source=>source.stop());},physicsStep(dt:number,pose:SoundPose){simulationTime+=dt;tracker.step(dt,pose);},bindStatus(callback:()=>void){notify=callback;notify();},
        get status(){return !available?'Звук недоступен':!model.state.soundEnabled?'Звук выключен':context?.state==='running'?'Звук готов':'Для звука нажмите клавишу или кликните';},
        get statistics(){return {voices:voices.size,meteorFlights:[...meteorGroups.values()].filter(g=>g.flight).length,loops:loops.length,burner:!!burner,steps:eventIndex,time:simulationTime};},
        dispose(){stopBurner();if(typeof window!=='undefined'){window.removeEventListener('pointerdown',gesture,true);window.removeEventListener('keydown',gesture,true);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);}loops.forEach(source=>source.stop());voices.forEach(source=>source.stop());void context?.close();}
    };
}
export type NatureAudio=ReturnType<typeof createNatureAudio>;
