import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorFixture} from './fixture';
import {decodeProject} from '../src/project';
import {createWaterRendering} from '../src/water-rendering';
import {QUALITY_PROFILES} from '../src/quality';
import type {RenderingSystem} from '../src/rendering';

test('legacy balloon sessions open without restoring the vehicle or leaving a suspended passenger',()=>{
    const f=editorFixture(),saved=JSON.parse(f.storage.projectJSON());
    saved.balloon={seated:true};
    saved.view.walk={on:true,feet:[0,100,0],yaw:0,pitch:0,start:[0,0,0],autoWalking:false,vy:0,grounded:false,swim:false,bob:0,saved:{pos:saved.view.camera.pos,target:saved.view.camera.target,near:saved.view.camera.near}};
    const migrated=decodeProject(JSON.stringify(saved));
    assert.equal(migrated.balloon,null);
    assert.equal(migrated.view.walk,null);
    assert.equal(migrated.heights.length,f.model.heights.length);
});

test('scene reflections exist only in high desktop quality and targets are released on downgrade',()=>{
    const f=editorFixture();f.model.busy=true;f.model.state.waterReflections=true;
    const water=createWaterRendering(f.model,f.render as unknown as RenderingSystem,f.materials);
    for(const [quality,size]of [['balanced',0],['high',512],['low',0],['high',512],['balanced',0]] as const){
        f.model.state.quality=quality;water.update(0);
        assert.equal(water.statistics.reflectionSize,size);
        assert.ok(QUALITY_PROFILES[quality].shadowSize<=2048);
    }
    f.model.state.quality='high';f.model.xrActive=true;f.model.xrQuality='quality';water.update(0);
    assert.equal(water.statistics.reflectionSize,0);
    water.dispose();
});
