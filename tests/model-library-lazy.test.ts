import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getModel,modelEntries,loadedBuiltinModels,initializeModelLibrary} from '../src/model-library';
import {createModel} from '../src/state';

test('catalog and startup allocate no builtin geometry; first use caches just the requested model',async()=>{
    assert.deepEqual(loadedBuiltinModels(),[]);
    await initializeModelLibrary();
    const entries=modelEntries(createModel().world);
    assert.ok(entries.length>20);
    assert.ok(entries.some(e=>e.id==='bridge'&&e.collider==='mesh'));
    assert.deepEqual(loadedBuiltinModels(),[]);
    const rock=getModel('rock');
    assert.deepEqual(loadedBuiltinModels(),['rock']);
    assert.equal(getModel('rock'),rock);
    assert.equal(entries.find(e=>e.id==='rock')!.parts,rock.parts);
    await initializeModelLibrary(['bridge']);
    assert.deepEqual(loadedBuiltinModels(),['rock','bridge']);
    assert.ok(getModel('bridge').parts.length>0);
    assert.throws(()=>getModel('missing'),/Модель не загружена/);
});
