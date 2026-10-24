import test from 'node:test';
import assert from 'node:assert/strict';
import {walkMetrics} from '../verification/walk-metrics';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import {createModel} from '../src/state';
test('walk metrics retain long frames and calculate FPS from elapsed wall time',()=>{
    const frames=[10,10,10,170].map(dtMs=>({dtMs,cpuMs:2,calls:10,triangles:100,objects:4,x:0,y:0,z:0}));
    const result=walkMetrics(frames);assert.equal(result.fps,20);assert.equal(result.over100Ms,1);assert.equal(result.over50Ms,1);assert.equal(result.maxMs,170);assert.ok(result.p95Ms>140);assert.equal(result.medianMs,10);
});
test('autowalk tolerates a transient mesh contact and still stops at a persistent wall',()=>{
    const model=createModel();model.state.water=-100;let calls=0,blocked=false;
    const sim=createWalkSimulation(model,()=>0,()=>true,{ground:()=>0,resolve(feet,move){calls++;return {position:feet.clone().add(blocked||calls===3?move.clone().set(0,0,0):move.clone().setY(0)),grounded:true};}});
    sim.walk.autoWalking=true;const clock=new FixedStepClock();clock.advance(.2,sim.step);assert.equal(sim.walk.autoWalking,true);assert.ok(sim.walk.feet.z<-.7);
    blocked=true;const before=sim.walk.feet.clone();clock.advance(.5,sim.step);assert.equal(sim.walk.autoWalking,false);assert.deepEqual(sim.walk.feet,before);
});
