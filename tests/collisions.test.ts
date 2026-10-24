import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createCollisions, initializeRapier } from '../src/collisions';
import { createWalkSimulation, FixedStepClock } from '../src/physics';
import { editorFixture } from './fixture';
import type { WorldObject } from '../src/world';
import {initializeModelLibrary} from '../src/model-library';
import {mulberry32} from '../src/noise';
await initializeRapier();
await initializeModelLibrary();
const item = (asset: string, x = 0, y = 0, z = 0): WorldObject => ({ id: asset, asset, source: 'manual', position: [x, y, z], rotation: [0,0,0], scale: [1,1,1], followTerrain: false, groundOffset: 0, tint: 1 });
function setup() {
    const fixture = editorFixture(); fixture.model.heights.fill(0); fixture.model.state.water = -1000; fixture.terrain.updateMeshAll();
    const collisions = createCollisions(fixture.model, fixture.terrain), simulation = createWalkSimulation(fixture.model, fixture.terrain.getH, () => true, collisions.motion);
    return { ...fixture, collisions, simulation };
}
function advance(simulation: ReturnType<typeof createWalkSimulation>, seconds = 2, fps = 60) {
    const clock = new FixedStepClock(); for (let i = 0; i < seconds * fps; i++) clock.advance(1 / fps, simulation.step);
}

test('Rapier preserves open doors, archways and cave interiors while solid walls block movement',t=>{
    for(const asset of ['cabin','arch','cave']){
        const f=setup();t.after(f.collisions.dispose);f.model.world.objects=[item(asset)];f.simulation.walk.feet.set(0,0,-7);f.simulation.keys.KeyS=true;advance(f.simulation,1.5);
        assert.ok(f.simulation.walk.feet.z>-.5,`${asset} entrance blocked at ${f.simulation.walk.feet.z}`);
        f.simulation.clearKeys();f.simulation.keys.KeyD=true;advance(f.simulation,2);assert.ok(f.simulation.walk.feet.x<4.5,`${asset} wall failed: ${f.simulation.walk.feet.x}`);
    }
});
test('pier deck remains walkable and object transforms rebuild the mesh collider',t=>{
    const f=setup();t.after(f.collisions.dispose);f.model.world.objects=[item('pier')];f.simulation.walk.feet.set(0,0,-8);f.simulation.keys.KeyS=true;advance(f.simulation,1.5);assert.ok(f.simulation.walk.feet.y>.7);assert.ok(f.simulation.walk.feet.z>-3);
    f.model.world.objects=[{...item('pier',20),rotation:[0,Math.PI/2,0],scale:[2,1,1]}];f.simulation.clearKeys();advance(f.simulation,1);assert.ok(f.simulation.walk.feet.y<.05);
});
test('Rapier capsule stops at trunks and rocks and releases after object removal', t => {
    const f = setup(); t.after(f.collisions.dispose);
    for (const asset of ['pine','rock']) {
        f.model.world.objects = [{ ...item(asset), scale: asset === 'rock' ? [2,2,2] : [1,1,1] }]; f.simulation.walk.feet.set(0, 0, 5); f.simulation.keys.KeyW = true; advance(f.simulation);
        assert.ok(f.simulation.walk.feet.z > 0.3, `${asset}: ${f.simulation.walk.feet.z}`);
    }
    f.model.world.objects = []; f.simulation.walk.feet.set(0, 0, 5); advance(f.simulation); assert.ok(f.simulation.walk.feet.z < -3);
});
test('Rapier movement and jumping are stable across render rates', t => {
    const positions: Vector3[] = [];
    for (const fps of [10,30,60,144]) { const f = setup(); t.after(f.collisions.dispose); f.simulation.keys.KeyW = true; f.simulation.walk.jumpReq = true; advance(f.simulation, 2, fps); positions.push(f.simulation.walk.feet.clone()); }
    for (const position of positions) assert.ok(position.distanceTo(positions[0]) < 1e-5);
    assert.ok(positions[0].y < 0.05); assert.ok(positions[0].z < -8.9);
});
test('Rapier follows bridge ramps and holds the character on the deck', t => {
    const f = setup(); t.after(f.collisions.dispose); f.model.world.objects = [item('bridge')];
    f.simulation.walk.feet.set(0, 0, 10); f.simulation.keys.KeyW = true; advance(f.simulation, 2);
    assert.ok(f.simulation.walk.feet.z < 2, `${f.simulation.walk.feet.z}`); assert.ok(f.simulation.walk.feet.y > 1, `${f.simulation.walk.feet.y}`);
    f.simulation.clearKeys(); advance(f.simulation, 1); assert.ok(f.simulation.walk.feet.y > 1); assert.equal(f.simulation.walk.grounded, true);
    assert.equal(f.collisions.surfaceAt(f.simulation.walk.feet.x,f.simulation.walk.feet.z,f.simulation.walk.feet.y),'wood');
});
test('Rapier steps over small obstacles and stops at tall steps', t => {
    const f = setup(); t.after(f.collisions.dispose);
    for(const scale of [.3,.55]){
        f.model.world.objects = [{ ...item('log'), scale: [1,scale,1] }]; f.simulation.walk.feet.set(0,0,3); f.simulation.keys.KeyW = true; advance(f.simulation, 2);
        assert.ok(f.simulation.walk.feet.z < -2, `log scale ${scale}: ${f.simulation.walk.feet.z}`);
    }
    f.model.world.objects = [item('boulder')]; f.simulation.walk.feet.set(0,0,5); advance(f.simulation, 2); assert.ok(f.simulation.walk.feet.z > 0);
});
test('terrain collider is rebuilt after edits and cannot leave feet below the new terrain', t => {
    const f = setup(); t.after(f.collisions.dispose); advance(f.simulation, 0.2);
    f.model.heights.fill(2); f.terrain.updateMeshAll(); advance(f.simulation, 0.2); assert.ok(f.simulation.walk.feet.y >= 2);
    f.model.heights.fill(0); f.terrain.updateMeshAll(); advance(f.simulation, 1); assert.ok(f.simulation.walk.feet.y < 0.05);
});
test('Rapier climbs gentle slopes while rejecting steep ascent', t => {
    for (const degrees of [25,43,55]) {
        const f = setup(); t.after(f.collisions.dispose);
        for (let j=0;j<f.model.n;j++) for(let i=0;i<f.model.n;i++) f.model.heights[j*f.model.n+i] = (-512+i*f.model.cell)*Math.tan(degrees*Math.PI/180);
        f.terrain.updateMeshAll(); f.simulation.keys.KeyD = true; advance(f.simulation, 2);
        if (degrees < 45) assert.ok(f.simulation.walk.feet.x > (degrees===43?4.5:6),`${degrees}°: ${f.simulation.walk.feet.x}`); else assert.ok(f.simulation.walk.feet.x < 1);
    }
});

test('walking crosses non-planar terrain cells without sprinting or jumping at different render rates',t=>{
    const destinations:Vector3[]=[];
    for(const fps of [10,60,144]){
        const f=setup();t.after(f.collisions.dispose);
        // A saddle has different bilinear and triangle heights, with easily walkable slopes.
        for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)f.model.heights[j*f.model.n+i]=((i+j)%2)*4;
        f.terrain.updateMeshAll();f.simulation.walk.feet.set(-12,f.terrain.getSurfaceH(-12,8)+.03,8);
        f.simulation.keys.KeyD=true;advance(f.simulation,6,fps);
        assert.ok(f.simulation.walk.feet.x>13,`walk stalled: ${f.simulation.walk.feet.toArray()}`);
        assert.equal(f.simulation.walk.grounded,true);assert.equal(f.simulation.walk.swim,false);
        destinations.push(f.simulation.walk.feet.clone());
    }
    for(const position of destinations)assert.ok(position.distanceTo(destinations[0])<1e-5);
});

test('structured terrain collision has exactly the rendered triangle heights, including partial updates',t=>{
    const f=setup();t.after(f.collisions.dispose);f.model.N=f.model.state.N=128;f.terrain.buildTerrain();
    for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)f.model.heights[j*f.model.n+i]=20+i*.2+j*.4+((i+j)%2)*3;
    f.terrain.updateMeshAll();f.collisions.ensure();const random=mulberry32(712);
    const check=()=>{for(let i=0;i<100;i++){const x=random()*1000-500,z=random()*1000-500,h=f.terrain.getSurfaceH(x,z),floor=f.collisions.motion.ground(x,z,h+.03);assert.ok(Math.abs(floor-h)<.001,`${x},${z}: ${floor} != ${h}`);}};check();
    f.model.heights[62*f.model.n+64]-=6;f.terrain.updateMeshRect(64,62,64,62);f.collisions.ensure();check();assert.equal(f.collisions.statistics.rebuilds,1);assert.equal(f.collisions.statistics.terrainUpdates,1);
});

test('local edits reuse object colliders and preserve floating body positions and velocities',t=>{
    const f=setup();t.after(f.collisions.dispose);const log={...item('log',200,10,200),floating:true,density:.45};f.model.world.objects=[log,item('pine',100,0,100)];f.collisions.ensure();
    const floating=f.collisions.floating.get('log')!,body=floating.body;body.setLinvel({x:3,y:2,z:1},true);body.addForce({x:100,y:-300,z:200},true);
    const position=body.translation(),velocity=body.linvel(),created=f.collisions.statistics.objectCreates;
    f.model.heights[16*f.model.n+16]-=2;f.terrain.updateMeshRect(16,16,16,16);f.model.world.objects=f.model.world.objects.map(o=>o.asset==='pine'?{...o,tint:.24}:o);f.collisions.ensure();
    assert.equal(f.collisions.floating.get('log')!.body,body);assert.deepEqual(body.translation(),position);assert.deepEqual(body.linvel(),velocity);assert.equal(f.collisions.statistics.objectCreates,created);assert.equal(f.collisions.statistics.rebuilds,1);
});
