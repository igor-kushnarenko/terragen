import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../src/state';
import { createWalkSimulation, FixedStepClock } from '../src/physics';
import { Vector3 } from 'three';

test('Rapier receives walking input even when the sampled terrain differs from collider support', () => {
    const model=createModel();model.state.water=-1000;
    const sim=createWalkSimulation(model,()=>.15,()=>true,{
        ground:()=>0,
        resolve:(feet,movement)=>({position:feet.clone().add(new Vector3(movement.x,0,movement.z)),grounded:true}),
    });
    sim.keys.KeyW=true;sim.step(1/120);
    assert.ok(sim.walk.feet.z<-.03,'walking input was discarded before collision resolution');
});

function run(fps: number, jump = false, diagonal = false, swim = false) {
    const model = createModel(); model.state.water = swim ? 0 : -10;
    const simulation = createWalkSimulation(model, () => swim ? -20 : 0);
    simulation.walk.feet.set(0, swim ? -1.45 : 0, 0); simulation.synchronize();
    simulation.keys.KeyW = true; simulation.keys.KeyD = diagonal;
    simulation.walk.jumpReq = jump;
    const clock = new FixedStepClock(); let apex = 0, steps = 0;
    for (let i = 0; i < fps * 3; i++) clock.advance(1 / fps, dt => {
        simulation.step(dt); apex = Math.max(apex, simulation.walk.feet.y); steps++;
    });
    return { simulation, apex, steps };
}
test('walk distance is identical at 1, 10, 30, 60 and 144 FPS', () => {
    for (const fps of [1, 10, 30, 60, 144]) {
        const { simulation, steps } = run(fps);
        assert.equal(steps, 360);
        assert.ok(Math.abs(simulation.walk.feet.z + 13.5) < 1e-8);
    }
});
test('jump trajectory and landing do not depend on rendering frequency', () => {
    const expected = run(60, true);
    assert.ok(expected.apex > 1);
    for (const fps of [1, 10, 30, 144]) {
        const result = run(fps, true);
        assert.equal(result.apex, expected.apex);
        assert.equal(result.simulation.walk.feet.y, 0);
        assert.equal(result.simulation.walk.grounded, true);
    }
});
test('diagonal movement is normalized and swimming uses its own speed', () => {
    const diagonal = run(10, false, true).simulation;
    assert.ok(Math.abs(Math.hypot(diagonal.walk.feet.x, diagonal.walk.feet.z) - 13.5) < 1e-8);
    const swimming = run(10, false, false, true).simulation;
    assert.ok(Math.abs(swimming.walk.feet.z + 4.8) < 1e-8);
    assert.equal(swimming.walk.swim, true);
});
test('jump request survives frames with no physics step and is consumed once', () => {
    const model = createModel(); model.state.water = -10;
    const simulation = createWalkSimulation(model, () => 0), clock = new FixedStepClock();
    simulation.walk.jumpReq = true; simulation.keys.Space = true;
    clock.advance(0.001, simulation.step); assert.equal(simulation.walk.jumpReq, true);
    clock.advance(0.01, simulation.step); assert.equal(simulation.walk.jumpReq, false);
    assert.ok(simulation.walk.vy > 0);
    clock.advance(1, simulation.step); assert.equal(simulation.walk.grounded, true);
    clock.advance(0.1, simulation.step); assert.equal(simulation.walk.feet.y, 0);
});
test('camera interpolates between physics states and restore clears stale input', () => {
    const result = run(10).simulation;
    const midpoint = result.eyePosition(0.5).clone();
    assert.ok(Math.abs(midpoint.z - (result.walk.feet.z + result.walk.previousFeet.z) / 2) < 1e-8);
    const pose = result.capture(); result.walk.feet.set(100, 100, 100); result.walk.jumpReq = true;
    result.restore(pose);
    assert.deepEqual(result.walk.feet.toArray(), pose.feet);
    assert.deepEqual(result.walk.previousFeet.toArray(), pose.feet);
    assert.equal(result.keys.KeyW, false); assert.equal(result.walk.jumpReq, false);
});
test('long suspension is capped and reset drops accumulated substeps', () => {
    const clock = new FixedStepClock(); let steps = 0;
    clock.advance(60, () => steps++); assert.equal(steps, 120);
    clock.advance(0.004, () => steps++); clock.reset();
    clock.advance(0.004, () => steps++); assert.equal(steps, 120);
});
