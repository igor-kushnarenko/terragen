import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {editorFixture} from './fixture';
import {createWaterSurface,gerstnerOffset,waveSettings,impactHeight,MAX_WATER_IMPACTS} from '../src/water-surface';
import {createWaterFlow,obstacleFlow} from '../src/water-flow';
import {oceanGeometry,waterGeometry} from '../src/water-geometry';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import {createCollisions,initializeRapier} from '../src/collisions';
import {decodeProject,captureDocument} from '../src/project';
import type {WaterBody} from '../src/world';
import {createWaterEdits} from '../src/water-edits';
import {carveWater} from '../src/water-compute';
import {createWaterOptics} from '../src/water-optics';
import {createWaterRendering} from '../src/water-rendering';
import {waterExtraUniforms} from '../src/water-shader';
import type {RenderingSystem} from '../src/rendering';
import {createWaterInteractions} from '../src/water-interactions';
import type {CollisionSystem} from '../src/collisions';
import {createWaterDomain,waterAtShore,SHORE_PADDING} from '../src/water-domain';
const river:WaterBody={id:'river',kind:'river',points:[[-100,0],[100,0]],width:30,level:20,endLevel:20,opacity:.7,wave:.8,flowSpeed:1};

test('Gerstner waves preserve a calm endpoint, attenuate at the shore and distinguish sea, lake and river',()=>{
    for(const speed of [0,.5,3])for(const kind of ['ocean','lake','river'] as const){const s=waveSettings(kind,0,speed,5),w=gerstnerOffset(10,15,3,.7,s.amplitude,s.length);assert.equal(w.y,0);assert.equal(w.x,0);}
    assert.ok(waveSettings('ocean',3,3,0).amplitude>0);
    assert.ok(waveSettings('ocean',1,1,5).amplitude>waveSettings('lake',1,1,5).amplitude);
    assert.ok(waveSettings('lake',1,1,5).amplitude>waveSettings('river',1,1,5).amplitude);
    const w=gerstnerOffset(10,15,3,.7,1,1);assert.notEqual(w.y,gerstnerOffset(10,15,3,1.7,1,1).y);assert.notEqual(w.y,gerstnerOffset(10,15,4,.7,1,1).y);
});
test('physical surface inverts displaced horizontal vertices, including extreme wave settings',()=>{
    const f=editorFixture(),water=createWaterSurface(f.model,()=>-50);Object.assign(f.model.state,{wave:10,windSpeed:3,windDir:67});water.advance(1.25);
    const s=waveSettings('ocean',10,3,66);
    for(const [x,z]of [[0,0],[7,4],[-14,22],[300,-450]]){const w=gerstnerOffset(x,z,water.time,67*Math.PI/180,s.amplitude,s.length,0,0,s.chop),surface=water.sample(x+w.x,z+w.z);assert.ok(Math.abs(surface.level-(16+w.y))<.035);assert.ok(Number.isFinite(surface.normal.y)&&surface.normal.y>0);}
});
test('strong wind creates metre-high long swells while breaking limits the shallow-water height',()=>{
    const calm=waveSettings('ocean',1,.5,60),storm=waveSettings('ocean',1,3,60),shore=waveSettings('ocean',1,3,1);assert.ok(storm.peak>3);assert.ok(storm.amplitude>calm.amplitude*10);assert.ok(storm.length>calm.length*5);assert.ok(shore.amplitude*.319<=.5+shore.runup+1e-8);assert.ok(waveSettings('ocean',0,3,0).amplitude===0);
});
test('storm crests run over a dry beach and recede instead of disappearing at the mean shoreline',()=>{
    const f=editorFixture();Object.assign(f.model.state,{wave:1,windSpeed:3,windDir:90});const water=createWaterSurface(f.model,x=>16+x*.12),ground=16.36,levels:number[]=[];
    for(let i=0;i<1200;i++){water.advance(1/60);levels.push(water.sample(3,0).level);assert.ok(water.sample(40,0).level<20.8);assert.equal(water.sample(80,0).level,16);}
    assert.ok(Math.max(...levels)>ground+.15);assert.ok(Math.min(...levels)<ground-.2);
});
test('local water has a padded bank mesh for swash but cannot flood lower land outside its authored outline',()=>{
    const f=editorFixture(),lake:WaterBody={...river,kind:'lake',points:[[-10,-10],[10,-10],[10,10],[-10,10]],level:30};f.model.world.waterBodies.push(lake);
    assert.equal(waterAtShore(16,f.model.world.waterBodies,12,0,30.2).body?.id,lake.id);assert.equal(waterAtShore(16,f.model.world.waterBodies,12,0,20).level,16);assert.equal(waterAtShore(16,f.model.world.waterBodies,12+SHORE_PADDING,0,30.2).level,16);
    const d=createWaterDomain(lake,2);assert.ok(d.geometry.attributes.position.count<26000);assert.ok(d.bounds.x<-10);assert.ok(d.geometry.index!.count>0);d.geometry.dispose();d.texture.dispose();
});
test('bounded water impacts reject dry ground, stay in their body, expire, and freeze without advancing time',()=>{
    const f=editorFixture();f.model.world.waterBodies.push({...river,kind:'lake',points:[[-10,-10],[10,-10],[10,10],[-10,10]]});
    const water=createWaterSurface(f.model,(x)=>x>100?100:0);assert.equal(water.addImpact(101,0,.1),false);
    for(let i=0;i<100;i++)water.addImpact(0,0,.1);assert.equal(water.impacts.length,MAX_WATER_IMPACTS);water.advance(.25);
    const before=water.sample(1,0).level;water.advance(0);assert.equal(water.sample(1,0).level,before);assert.equal(water.upload(8).count,8);assert.equal(water.upload(8).packed[8].w,0);
    const hit=water.impacts[0];assert.equal(impactHeight(hit,0,0,hit.time-1),0);assert.equal(impactHeight(hit,0,0,hit.time+5),0);
    water.advance(5);assert.equal(water.impacts.length,0);const time=water.time;f.model.world.waterBodies=[...f.model.world.waterBodies];water.advance(0);assert.equal(water.time,time);f.model.terrainRevision++;water.advance(0);assert.equal(water.time,time);water.reset();assert.equal(water.time,0);
});
test('current diverts around a submerged obstacle and CPU samples the same quantized, filtered flow map as the shader',()=>{
    const f=editorFixture();f.model.world.waterBodies.push(river);f.model.heights.fill(0);f.terrain.updateMeshAll();const id=f.edits.addObject('boulder',0,0)!;f.edits.updateObject(id,{position:[0,19,0],followTerrain:false,scale:[2,2,2]});
    const flow=createWaterFlow(f.model,()=>0),obstacle=obstacleFlow(0,3,1,0,[{x:0,z:0,radius:2}]);assert.ok(obstacle.x>1);assert.equal(obstacleFlow(0,0,1,0,[{x:0,z:0,radius:2}]).length(),0);
    const map=flow.map(river)!;const i=28,j=38,x=map.bounds.x+(i+.5)/map.size*map.bounds.z,z=map.bounds.y+(j+.5)/map.size*map.bounds.w,s=flow.sample(river,x,z,0,0);assert.ok(Math.abs(s.x-map.data[(j*map.size+i)*2])<1e-6);assert.ok(Math.abs(s.y-map.data[(j*map.size+i)*2+1])<1e-6);
    const water=createWaterSurface(f.model,()=>0);water.bindFlow(flow.sample);assert.ok(Math.abs(water.sample(x,z).dx-s.x)<1e-6);flow.dispose();
});
test('ocean grid concentrates detail near the viewer without seams and local water has a bounded vertex budget',()=>{
    const g=oceanGeometry(96),p=g.attributes.position;assert.equal(p.count,97**2);assert.ok(Math.abs(p.getX(48)-p.getX(49))<.5);assert.ok(Math.abs(p.getX(0))>20000);
    const lake:WaterBody={...river,kind:'lake',points:[[-500,-500],[500,-500],[500,500],[-500,500]]},l=waterGeometry(lake,2);assert.ok(l.attributes.position.count<60000);assert.ok(l.attributes.position.count>1000);g.dispose();l.dispose();
});
test('wave-aware swimming and current remain stable at 10, 60 and 144 FPS',()=>{
    const results:Vector3[]=[];
    for(const fps of [10,60,144]){const f=editorFixture();f.model.world.waterBodies.push(river);const surface=createWaterSurface(f.model,()=>0),sim=createWalkSimulation(f.model,()=>0,()=>true,undefined,surface.sample),clock=new FixedStepClock();sim.walk.feet.set(-40,18.55,0);for(let i=0;i<fps*3;i++)clock.advance(1/fps,dt=>{surface.advance(dt);sim.step(dt);});assert.ok(sim.walk.swim);assert.ok(Math.abs(sim.walk.feet.y-(surface.sample(sim.walk.feet.x,sim.walk.feet.z).level-1.45))<1e-5);results.push(sim.walk.feet.clone());}
    for(const r of results)assert.ok(r.distanceTo(results[0])<1e-5);
});
test('Rapier buoyancy follows current, stays finite and is stable across render frequencies without modifying authored poses',async()=>{
    await initializeRapier();const results:Vector3[]=[];
    for(const fps of [10,60,144]){const f=editorFixture();f.model.heights.fill(0);f.terrain.updateMeshAll();f.model.world.waterBodies.push({...river,wave:0});const id=f.edits.addObject('log',-40,0)!;f.edits.updateObject(id,{floating:true,density:.45,followTerrain:false,position:[-40,20,0]});
        const authored=captureDocument(f.model),collisions=createCollisions(f.model,f.terrain),surface=createWaterSurface(f.model,()=>0),clock=new FixedStepClock();
        for(let i=0;i<fps*5;i++)clock.advance(1/fps,dt=>{surface.advance(dt);collisions.stepWater(dt,surface.sample);});const body=collisions.floating.get(id)!;
        assert.ok(body.pose.position.x>-37);assert.ok(body.pose.position.y>18.5&&body.pose.position.y<20.5);assert.deepEqual(captureDocument(f.model),authored);results.push(body.pose.position.clone());collisions.dispose();}
    for(const r of results)assert.ok(r.distanceTo(results[0])<1e-4);
});
test('floating props collide with the bed and denser props sink rather than receiving infinite lift',async()=>{
    await initializeRapier();const f=editorFixture();f.model.heights.fill(15);f.terrain.updateMeshAll();const id=f.edits.addObject('log',0,0)!;f.edits.updateObject(id,{floating:true,density:1.4,followTerrain:false,position:[0,17,0]});const c=createCollisions(f.model,f.terrain),water=createWaterSurface(f.model,()=>15);
    for(let i=0;i<720;i++){water.advance(1/120);c.stepWater(1/120,water.sample);}const p=c.floating.get(id)!.pose.position;assert.ok(p.y>=14.9&&p.y<16);c.dispose();
});
test('water optics and buoyancy settings save/load/undo and malformed additions are rejected atomically',async()=>{
    const f=editorFixture(),id=f.edits.addObject('log',0,0)!;f.edits.updateObject(id,{floating:true,followTerrain:false,density:.6});f.edits.replaceWorld({waterBodies:f.model.world.waterBodies.map(b=>({...b,clarity:25}))});
    const text=f.storage.projectJSON(),p=decodeProject(text);assert.equal(p.world.objects[0].floating,true);assert.equal(p.world.waterBodies[0].clarity,25);f.history.undo();assert.equal(f.model.world.waterBodies[0].clarity,undefined);f.history.redo();assert.equal(f.model.world.waterBodies[0].clarity,25);
    for(const change of [(p:any)=>p.world.objects[0].density=0,(p:any)=>p.world.objects[0].floating='yes',(p:any)=>p.world.objects[0].followTerrain=true,(p:any)=>p.world.waterBodies[0].clarity=NaN]){const p=JSON.parse(text);change(p);const before=captureDocument(f.model);await assert.rejects(f.storage.loadProjectText(JSON.stringify(p)));assert.deepEqual(captureDocument(f.model),before);}
});
test('changing water appearance does not excavate a hand-edited bed a second time',async()=>{
    const f=editorFixture();let jobs=0;const edits=createWaterEdits(f.model,f.terrain,f.vegetation,f.materials,f.history,f.feedback,{async run(job){jobs++;return carveWater(job.settings,job.heights!,job.waterBodies!);},cancel(){}});
    await edits.upsert(river);f.model.heights[16*f.model.n+16]=18.125;const before=new Float32Array(f.model.heights);await edits.upsert({...river,clarity:12,wave:2});assert.equal(jobs,1);assert.deepEqual(f.model.heights,before);assert.equal(f.model.world.waterBodies.at(-1)?.clarity,12);f.history.undo();assert.equal(f.model.world.waterBodies.at(-1)?.clarity,undefined);assert.deepEqual(f.model.heights,before);
});
test('optical captures restore visibility, target, XR and shadows after success, resize and renderer failure',()=>{
    const f=editorFixture();let target:any=null,fail=false,calls=0,w=800,h=600;const renderer={xr:{enabled:true},shadowMap:{autoUpdate:true},getDrawingBufferSize(v:any){return v.set(w,h);},getRenderTarget(){return target;},setRenderTarget(t:any){target=t;},clear(){},render(){calls++;assert.equal(f.materials.water.visible,false);assert.equal(renderer.xr.enabled,false);assert.equal(renderer.shadowMap.autoUpdate,false);if(fail)throw new Error('render failed');}};
    const group=f.render.scene.clone(false) as any;group.visible=true;const optics=createWaterOptics({...f.render,renderer} as unknown as RenderingSystem,f.materials,group);
    optics.capture(.5);assert.equal(calls,1);assert.equal(f.materials.water.visible,true);assert.equal(group.visible,true);assert.equal(target,null);assert.ok(renderer.xr.enabled&&renderer.shadowMap.autoUpdate);assert.deepEqual(optics.statistics.refractionSize,[400,300]);
    w=1200;h=800;optics.capture(.5);assert.deepEqual(optics.statistics.refractionSize,[600,400]);fail=true;assert.throws(()=>optics.capture(.5),/render failed/);assert.equal(target,null);assert.equal(f.materials.water.visible,true);assert.equal(group.visible,true);assert.ok(renderer.xr.enabled&&renderer.shadowMap.autoUpdate);optics.dispose();
});
test('rain reaches visible water from a dry bank and paused footsteps do not emit stale splashes',()=>{
    const f=editorFixture(),water=createWaterSurface(f.model,(_x,z)=>z>5?22:0);f.render.camera.position.set(0,24,24);f.render.camera.lookAt(0,16,-20);f.render.camera.updateMatrixWorld();
    const effects=createWaterInteractions(f.model,water,{floating:new Map()} as unknown as CollisionSystem,f.render as unknown as RenderingSystem),pose={on:false,paused:false,swim:false,feet:new Vector3(0,15,0)};
    for(let i=0;i<360;i++)effects.step(1/120,pose,1);assert.ok(water.impacts.length>=5);effects.reset();pose.on=true;effects.step(1/120,pose,0);assert.equal(water.impacts.length,1);assert.ok(effects.statistics.splashes>0);
    pose.paused=true;for(let i=0;i<720;i++)effects.step(1/120,pose,0);assert.equal(water.impacts.length,0);assert.equal(effects.statistics.splashes,0);effects.dispose();
});


test('waterfall clipping is disabled by default for the sea, lakes and ordinary rivers',()=>{
    assert.deepEqual(waterExtraUniforms().uCascade.value.toArray(),[0,0,0,0]);
    const f=editorFixture();f.model.state.quality='low';f.model.state.waterReflections=false;
    const lake:WaterBody={...river,id:'lake',kind:'lake',level:f.model.state.water,points:[[-20,-20],[20,-20],[20,20],[-20,20]]};
    f.model.world.waterBodies.push(lake,{...river,id:'ordinary-river',level:f.model.state.water,endLevel:f.model.state.water});
    const renderer={xr:{enabled:false},shadowMap:{autoUpdate:false},getDrawingBufferSize:(v:any)=>v.set(64,64),getRenderTarget:()=>null,setRenderTarget(){},clear(){},render(){}};
    const rendering=createWaterRendering(f.model,{...f.render,renderer} as unknown as RenderingSystem,f.materials);
    rendering.update(0);
    assert.deepEqual(f.materials.waterUniforms.uCascade.value.toArray(),[0,0,0,0]);
    for(const mesh of rendering.group.children)assert.deepEqual((mesh as any).material.uniforms.uCascade.value.toArray(),[0,0,0,0]);
    (rendering.group.children[0] as any).material.uniforms.uCascade.value.w=10;
    assert.equal(f.materials.waterUniforms.uCascade.value.w,0,'local effects must not enable ocean clipping');
    assert.equal((rendering.group.children[1] as any).material.uniforms.uCascade.value.w,0);
    f.model.world.waterBodies=[...f.model.world.waterBodies];rendering.update(0);
    for(const mesh of rendering.group.children)assert.equal((mesh as any).material.uniforms.uCascade.value.w,0);
    rendering.dispose();
});

test('ocean storms build larger swells and several metres of swash without changing a breeze',()=>{
    const breeze=waveSettings('ocean',1,.5,60),storm=waveSettings('ocean',1,3,60);
    assert.ok(Math.abs(breeze.peak-.2620419131)<1e-8);
    assert.ok(storm.peak>8&&storm.peak<10);assert.ok(storm.runup>4&&storm.runup<6);
    assert.ok(storm.length>10);assert.ok(storm.chop>breeze.chop);
    assert.ok(waveSettings('lake',1,3,60).runup<=1.4);assert.ok(waveSettings('river',1,3,60).runup<=.45);
    let peak=0;for(let i=0;i<=100;i++){const s=waveSettings('ocean',1,i*.03,60);assert.ok(s.peak>=peak);peak=s.peak;}
    const f=editorFixture();Object.assign(f.model.state,{wave:1,windSpeed:3,windDir:90});const water=createWaterSurface(f.model,x=>16+x*.12);
    let wet=0,dry=0;
    for(let i=0;i<2400;i++){water.advance(1/60);const h=water.sample(12,0).level;if(h>17.44)wet++;else dry++;}
    assert.ok(wet>30&&dry>30,'storm must wash up and drain back from higher beach ground');
});
