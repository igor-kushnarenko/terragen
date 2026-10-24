import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {editorFixture} from './fixture';
import {createStepTracker,footstepSamples,groundSurface,nearestWater,noiseSamples,SURFACES} from '../src/soundscape';
import {createNatureAudio} from '../src/nature-audio';

test('painted surface layers select their matching footstep sound',()=>{
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();
    const k=(256*512+256)*4;
    for(let i=0;i<8;i++){f.model.splat.fill(0);f.model.splatDetail.fill(0);(i<4?f.model.splat:f.model.splatDetail)[k+i%4]=230;assert.equal(groundSurface(f.model,f.terrain,0,0),SURFACES[i]);}
});
test('footsteps follow actual distance, stay silent in the air and menu, and include landing',()=>{
    const tracker=createStepTracker(()=> 'wood'),pose={on:true,paused:false,feet:new Vector3(),grounded:true,swim:false};tracker.step(1/120,pose);
    for(let i=0;i<120;i++){pose.feet.x+=4.5/120;tracker.step(1/120,pose);}assert.equal(tracker.take().length,2);
    pose.grounded=false;for(let i=0;i<60;i++){pose.feet.x+=0.05;pose.feet.y+=0.01;tracker.step(1/120,pose);}assert.equal(tracker.take().length,0);
    pose.grounded=true;tracker.step(1/120,pose);assert.equal(tracker.take()[0].surface,'wood');pose.paused=true;for(let i=0;i<120;i++){pose.feet.x+=0.1;tracker.step(1/120,pose);}assert.equal(tracker.take().length,0);
});
test('sound tracking does not emit footsteps for teleportation or stale catch-up queues',()=>{
    const tracker=createStepTracker(()=> 'grass'),pose={on:true,paused:false,feet:new Vector3(),grounded:true,swim:false};tracker.step(1/120,pose);pose.feet.x=200;tracker.step(1/120,pose);assert.equal(tracker.take().length,0);
    for(let i=0;i<1000;i++){pose.feet.x+=0.05;tracker.step(1/120,pose);}assert.ok(tracker.take().length<=4);pose.on=false;tracker.step(1/120,pose);assert.equal(tracker.take().length,0);
});
test('water ambience finds an actual nearby shoreline and disappears on dry inland terrain',()=>{
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();assert.equal(nearestWater(f.model,f.terrain,0,0),null);
    const terrain={getH:(x:number)=>x>20?0:30,getNormalY:()=>1},water=nearestWater(f.model,terrain,0,0)!;assert.ok(water.distance>20&&water.distance<50);assert.ok(water.position.x>20);assert.equal(water.position.y,f.model.state.water);
});
test('offline sound buffers are deterministic, bounded and differ across surfaces',()=>{
    const noise=noiseSamples(8000,1,9,true);assert.deepEqual(noiseSamples(8000,1,9,true),noise);assert.ok(noise.every(Number.isFinite));assert.ok(Math.max(...noise.map(Math.abs))<1);
    const grass=footstepSamples('grass',8000,9),gravel=footstepSamples('gravel',8000,9),wood=footstepSamples('wood',8000,9);assert.notDeepEqual(grass,gravel);assert.notDeepEqual(wood,gravel);assert.equal(grass.at(-1),0);
});
class Param {value=0;setTargetAtTime(value:number){this.value=value;}setValueAtTime(value:number){this.value=value;}linearRampToValueAtTime(value:number){this.value=value;}exponentialRampToValueAtTime(value:number){this.value=value;}}
class Node {gain=new Param();frequency=new Param();Q=new Param();positionX=new Param();positionY=new Param();positionZ=new Param();threshold=new Param();ratio=new Param();playbackRate=new Param();onended?:()=>void;stopped=false;connect(){}disconnect(){}start(){}stop(at?:number){this.stopped=true;if(at===undefined)this.onended?.();}}
class Context {
    state='suspended';sampleRate=8000;currentTime=0;destination={};onstatechange?:()=>void;nodes:Node[]=[];
    listener=Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(key=>[key,new Param()]));
    createGain(){const node=new Node();this.nodes.push(node);return node;}createDynamicsCompressor(){return this.createGain();}createPanner(){return this.createGain();}createBufferSource(){return this.createGain();}createBiquadFilter(){return this.createGain();}createOscillator(){return this.createGain();}
    createBuffer(){return {copyToChannel(){}};}async resume(){this.state='running';this.onstatechange?.();}async suspend(){this.state='suspended';}async close(){this.state='closed';}
}
test('audio graph starts only after unlock, plays distance-based steps and fades when muted or paused',async()=>{
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();const ctx=new Context(),audio=createNatureAudio(f.model,f.terrain,()=>undefined,()=>ctx as unknown as AudioContext);
    const camera=new PerspectiveCamera(),pose={on:true,paused:false,feet:new Vector3(),grounded:true,swim:false},weather={rain:0,snow:0,dark:0};assert.equal(audio.statistics.loops,0);
    await audio.unlock();assert.equal(audio.status,'Звук готов');assert.equal(audio.statistics.loops,3);
    for(let i=0;i<60;i++){pose.feet.x+=4.5/120;audio.physicsStep(1/120,pose);}audio.update(0.5,camera,pose,weather);assert.equal(audio.statistics.steps,1);assert.ok(ctx.nodes[0].gain.value>0);
    pose.paused=true;audio.update(0.1,camera,pose,weather);assert.equal(ctx.nodes[0].gain.value,0);f.model.state.soundEnabled=false;assert.equal(audio.status,'Звук выключен');audio.dispose();assert.equal(ctx.state,'closed');
});
test('burner uses one spatial loop and releases it across repeated scenario stops',async()=>{
    const f=editorFixture(),ctx=new Context(),audio=createNatureAudio(f.model,f.terrain,()=>undefined,()=>ctx as unknown as AudioContext);await audio.unlock();const camera=new PerspectiveCamera(),pose={on:true,paused:false,feet:new Vector3(),grounded:false,swim:false},weather={rain:0,snow:0,dark:0};
    for(let i=0;i<5;i++){audio.balloon(.8,[i,30,0],2);audio.update(.01,camera,pose,weather);assert.equal(audio.statistics.burner,true);const count=ctx.nodes.length;audio.balloon(.4,[i+1,31,0],1);audio.update(.01,camera,pose,weather);assert.equal(ctx.nodes.length,count);audio.balloon(0,null);assert.equal(audio.statistics.burner,false);assert.equal(audio.statistics.voices,0);}audio.dispose();assert.equal(ctx.state,'closed');
});

test('simultaneous meteor sounds move and stop independently; one impact does not silence other flights',async()=>{
    const f=editorFixture(),ctx=new Context(),audio=createNatureAudio(f.model,f.terrain,()=>undefined,()=>ctx as unknown as AudioContext);await audio.unlock();
    audio.meteor('flight',[0,200,0],2,'a');audio.meteor('flight',[100,300,0],12,'b');assert.equal(audio.statistics.meteorFlights,2);assert.equal(audio.statistics.voices,2);
    audio.meteor('impact',[0,40,0],2,'a');assert.equal(audio.statistics.meteorFlights,1);assert.equal(audio.statistics.voices,3);audio.stopMeteor('a');assert.equal(audio.statistics.voices,1);assert.equal(audio.statistics.meteorFlights,1);audio.moveMeteor([80,100,0],'b');audio.stopMeteor();assert.equal(audio.statistics.voices,0);assert.equal(audio.statistics.meteorFlights,0);audio.dispose();
});
test('meteor roar moves spatially, pauses and releases its sources on impact, cancellation or mute',async()=>{
    const f=editorFixture(),ctx=new Context(),audio=createNatureAudio(f.model,f.terrain,()=>undefined,()=>ctx as unknown as AudioContext);
    await audio.unlock();const first=ctx.nodes.length;
    audio.meteor('flight',[100,200,0],4);assert.equal(audio.statistics.voices,1);
    const spatial=ctx.nodes[first],gain=ctx.nodes[first+1];assert.equal(spatial.positionX.value,100);assert.ok(gain.gain.value>0);
    audio.pauseMeteor();assert.equal(gain.gain.value,0);audio.moveMeteor([40,50,10]);assert.equal(spatial.positionX.value,40);assert.equal(spatial.positionY.value,50);assert.equal(spatial.positionZ.value,10);assert.ok(gain.gain.value>0);
    audio.meteor('impact',[40,40,10],4);assert.equal(audio.statistics.voices,2);audio.stopMeteor();assert.equal(audio.statistics.voices,0);
    f.model.state.soundEnabled=false;audio.meteor('flight',[0,200,0],2);assert.equal(audio.statistics.voices,0);audio.dispose();
});
