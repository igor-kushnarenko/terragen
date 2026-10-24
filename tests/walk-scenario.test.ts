import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createWalkWorld, WALK_POINTS, WALK_DB } from '../verification/walk-world';
import { RouteDriver } from '../verification/route-driver';
import { editorFixture } from './fixture';
import { createCollisions, initializeRapier } from '../src/collisions';
import { initializeModelLibrary } from '../src/model-library';
import { createWalkSimulation, FixedStepClock } from '../src/physics';
import { waterLevelAt } from '../src/water-math';
import { decodeProject } from '../src/project';
import { openWorldRepository } from '../src/world-library';
import { IDBFactory } from 'fake-indexeddb';
await initializeRapier();await initializeModelLibrary();
const example=createWalkWorld();
async function setup(project=example.project){
    const f=editorFixture();await f.storage.loadProjectText(project);
    const collisions=createCollisions(f.model,f.terrain);
    const rejected:number[][]=[];
    const simulation=createWalkSimulation(f.model,f.terrain.getH,(x,z)=>{
        const floor=collisions.motion.ground(x,z,simulation.walk.feet.y);
        const safe=floor>waterLevelAt(f.model.state.water,f.model.world.waterBodies,x,z)+.3&&Math.abs(floor-simulation.walk.feet.y)<.45;
        if(!safe)rejected.push([x,z,floor,simulation.walk.feet.y]);return safe;
    },collisions.motion);
    const view=decodeProject(project).view;simulation.restore(view.walk!);
    const route=f.model.world.routes[0].points,driver=new RouteDriver(route,simulation.walk);
    f.storage.bindView(()=>({...view,walk:simulation.capture()}),v=>{if(v.walk)simulation.restore(v.walk);});
    return {...f,collisions,simulation,driver,rejected};
}
test('complete forest–lake–viewpoint route crosses the bridge with Rapier at 10/30/60/144 FPS',async()=>{
    const positions:Vector3[]=[];
    for(const fps of [10,30,60,144]){
        const f=await setup(),clock=new FixedStepClock();f.driver.start();let bridge=false,swam=false,minClearance=Infinity;
        try{
            for(let frame=0;frame<fps*45&&!f.driver.complete&&!f.driver.blocked;frame++)clock.advance(1/fps,()=>{
                f.driver.step();f.simulation.step(1/120);const p=f.simulation.walk.feet;
                minClearance=Math.min(minClearance,p.y-f.terrain.getH(p.x,p.z));swam ||= f.simulation.walk.swim;
                bridge ||= Math.abs(p.x)<3&&Math.abs(p.z-36)<1&&p.y>16.8;
            });
            assert.equal(f.driver.blocked,'',`${fps} FPS stopped at ${f.simulation.walk.feet.toArray()} rejected=${JSON.stringify(f.rejected)}`);
            assert.equal(f.driver.complete,true,`${fps} FPS did not finish at ${f.simulation.walk.feet.toArray()}`);
            assert.equal(swam,false);assert.equal(bridge,true);assert.ok(minClearance>-.08,`below terrain: ${minClearance}`);
            assert.ok(f.simulation.walk.feet.distanceTo(new Vector3(WALK_POINTS.at(-1)![0],f.terrain.getH(...WALK_POINTS.at(-1)!),WALK_POINTS.at(-1)![1]))<.5);
            positions.push(f.simulation.walk.feet.clone());
        }finally{f.collisions.dispose();}
    }
    for(const p of positions)assert.ok(p.distanceTo(positions[0])<.5,'frame rate changes route destination');
});
test('the walk survives IndexedDB close/reopen at the lake and continues to the viewpoint',async()=>{
    const first=await setup(),clock=new FixedStepClock();first.driver.start();
    try{
        for(let i=0;i<60*20&&first.simulation.walk.feet.x < -20.5&&!first.driver.blocked;i++)clock.advance(1/60,()=>{first.driver.step();first.simulation.step(1/120);});
        assert.ok(first.simulation.walk.feet.x>=-20.5,'lake checkpoint not reached');
        assert.equal(first.driver.blocked,'');first.simulation.clearKeys();
        const text=first.storage.projectJSON(),factory=new IDBFactory();
        const user=await openWorldRepository(factory);await user.put({id:'user',name:'Пользовательский мир',updatedAt:1,project:'preserve',preview:'preview'});user.close();
        const repository=await openWorldRepository(factory,WALK_DB);await repository.put({id:'scenario',name:'Лес → озеро → видовая точка',updatedAt:2,project:text,preview:'data:image/png;base64,preview'});repository.close();
        const reopened=await openWorldRepository(factory,WALK_DB),saved=await reopened.last();reopened.close();assert.ok(saved);
        const second=await setup(saved.project);
        try{
            assert.deepEqual(second.simulation.capture(),decodeProject(text).view.walk);assert.deepEqual(second.model.world,first.model.world);
            assert.deepEqual(second.model.heights,first.model.heights);assert.deepEqual(second.model.splatDetail,first.model.splatDetail);assert.deepEqual(second.model.seeds,first.model.seeds);
            let nearest=1,best=Infinity;for(let i=1;i<second.driver.points.length;i++){const p=second.driver.points[i],d=Math.hypot(p[0]-second.simulation.walk.feet.x,p[1]-second.simulation.walk.feet.z);if(d<best){best=d;nearest=i;}}
            second.driver.start(nearest);for(let i=0;i<60*35&&!second.driver.complete&&!second.driver.blocked;i++)clock.advance(1/60,()=>{second.driver.step();second.simulation.step(1/120);});
            assert.equal(second.driver.blocked,'');assert.equal(second.driver.complete,true);
        }finally{second.collisions.dispose();}
        const original=await openWorldRepository(factory);assert.equal((await original.last())?.project,'preserve');original.close();
    }finally{first.collisions.dispose();}
});
