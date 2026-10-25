import test from 'node:test';
import assert from 'node:assert/strict';
import {Camera,Color,Scene,Mesh,Points} from 'three';
import {createModel} from '../src/state';
import {waterfallPlan,waterfallCurtain,createWaterfallEffects} from '../src/waterfall-effects';
import type {WaterBody} from '../src/world';
const river:WaterBody={id:'fall',kind:'river',points:[[0,0],[0,20],[0,22],[0,40]],pointLevels:[30,28,16,16],level:30,endLevel:16,outlet:1,width:10,wave:.2,opacity:.8};

test('fall curtains have layered depth, bounded geometry and retain the brink and plunge level',()=>{
    const plan=waterfallPlan(river)!;assert.equal(plan.drop,12);
    const g=waterfallCurtain(plan),p=g.attributes.position,l=g.attributes.aLayer;
    assert.ok(p.count<2000);assert.ok(p.array.every(Number.isFinite));assert.equal(Math.max(...l.array),2);
    assert.ok(Math.abs(p.getZ(12*13+6)-p.getZ(25*13+12*13+6))>.1,'layers must enclose depth');
    assert.ok(Math.abs(p.getY(0)-plan.top)<.1);assert.ok(Math.abs(p.getY(24*13)-plan.sea)<.1);g.dispose();
    assert.equal(waterfallPlan({...river,outlet:undefined}),null);
    assert.equal(waterfallPlan({...river,pointLevels:[16,16,16,16]}),null);
});
test('effects rebuild without accumulating resources, respect quality and distance, and do not change saved water',()=>{
    const model=createModel(),scene=new Scene(),camera=new Camera();model.world.waterBodies.push(river);
    const before=JSON.stringify(model.world),effects=createWaterfallEffects(model,scene,{uTime:{value:0},uFogColor:{value:new Color()},uFogDensity:{value:.001}});
    effects.update(camera);assert.equal(effects.statistics.waterfalls,1);assert.equal(effects.statistics.sprayParticles,144);
    const root=scene.getObjectByName('Waterfall streams, spray and plunge foam')!;
    assert.equal(root.children[0].children.length,3);assert.ok(root.userData.noWaterReflection);
    let disposed=0;for(const o of root.children[0].children){assert.ok(o instanceof Mesh||o instanceof Points);(o as Mesh).geometry.addEventListener('dispose',()=>disposed++);}
    model.state.quality='low';effects.update(camera);assert.equal(disposed,3);assert.equal(effects.statistics.sprayParticles,64);
    camera.position.set(10000,10000,10000);effects.update(camera);assert.equal(root.children[0].visible,false);
    assert.equal(JSON.stringify(model.world),before);
    model.world.waterBodies=[model.world.waterBodies[0]];effects.update(camera);assert.equal(effects.statistics.waterfalls,0);
    effects.dispose();assert.equal(scene.children.length,0);
});
