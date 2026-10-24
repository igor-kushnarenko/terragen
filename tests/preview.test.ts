import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldPreviewCache} from '../src/preview';
import {createModel} from '../src/state';
test('autosave reuses the map thumbnail during a walk, but refreshes changed terrain and water',()=>{
    const model=createModel();let renders=0;const preview=createWorldPreviewCache(model,()=>`preview-${++renders}`);
    assert.equal(preview.get(),'preview-1');
    model.state.wetness=1;model.state.dayTime=22;model.walkSettings.fov=90;
    assert.equal(preview.get(),'preview-1');assert.equal(renders,1);
    model.terrainRevision++;assert.equal(preview.get(),'preview-2');
    model.world.waterBodies=model.world.waterBodies.map(body=>({...body,level:body.level+2}));assert.equal(preview.get(),'preview-3');
    model.state.water++;assert.equal(preview.get(),'preview-4');
    model.state.snowLine--;assert.equal(preview.get(),'preview-5');
    model.heights=model.heights.slice();assert.equal(preview.get(),'preview-6');
    assert.equal(preview.get(),'preview-6');assert.equal(preview.statistics.hits,2);
});
