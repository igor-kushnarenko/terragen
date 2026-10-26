import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Mesh,BoxGeometry,MeshBasicMaterial} from 'three';
import {createGraphicFilters,type GraphicFilter} from '../src/graphic-filters';
import {editorFixture} from './fixture';
import {decodeProject,captureDocument} from '../src/project';
import {MIN_AREA_SIZE} from '../src/territory-size';
import {worldSettings,defaultWorldRequest} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {WORLD_PRESET_IDS} from '../src/world';

test('filter selection saves, loads, undoes, and old documents default to colour',()=>{
 const f=editorFixture(),before=captureDocument(f.model);f.edits.setPreferences({graphicFilter:'monochrome'});
 assert.equal(decodeProject(f.storage.projectJSON()).state.graphicFilter,'monochrome');f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.equal(f.model.state.graphicFilter,'monochrome');
 const raw=JSON.parse(f.storage.projectJSON());delete raw.state.graphicFilter;assert.equal(decodeProject(JSON.stringify(raw)).state.graphicFilter,'none');raw.state.graphicFilter='invalid';assert.throws(()=>decodeProject(JSON.stringify(raw)),/graphicFilter/);
});

test('grading wraps existing shaders once, bypasses offscreen captures and restores nested render state',()=>{
 let mode:GraphicFilter='monochrome',target:unknown=null;const values:number[]=[],material=new MeshBasicMaterial();let hook=0;material.onBeforeCompile=()=>{hook++;};
 const shader={uniforms:{} as any,fragmentShader:'void main(){gl_FragColor=vec4(1.0);}',vertexShader:''};
 const scene=new Scene();scene.add(new Mesh(new BoxGeometry(),material));
 const renderer={xr:{enabled:true,isPresenting:true},getRenderTarget:()=>target,render(_scene?:Scene){material.onBeforeCompile(shader as any,renderer as any);values.push(shader.uniforms.uTerragenMonochrome.value);}};
 createGraphicFilters(renderer as any,()=>mode);renderer.render(scene);const key=material.customProgramCacheKey();target={};renderer.render(scene);target={isXRRenderTarget:true};renderer.render(scene);target={};renderer.render(scene);target=null;mode='none';renderer.render(scene);
 assert.deepEqual(values,[1,0,1,0,0]);assert.equal(hook,5);assert.equal(material.customProgramCacheKey(),key);assert.equal(shader.uniforms.uTerragenMonochrome.value,0);
});

test('arbitrary territory sizes and micro islands validate, serialize and produce dry land in every biome',()=>{
 const f=editorFixture();for(const size of [MIN_AREA_SIZE,.1375,.623,1]){f.model.state.areaSize=size;assert.equal(decodeProject(f.storage.projectJSON()).state.areaSize,size);}
 for(const preset of WORLD_PRESET_IDS){const s=worldSettings(f.model.state,{...defaultWorldRequest(),preset,N:512,areaSize:MIN_AREA_SIZE,erosion:0,plants:false,routes:false});const h=computeTerrainJob({kind:'terrain',settings:s,preset,seed:s.seed,worldErosion:0});assert.ok(h.every(Number.isFinite));assert.ok(h.some(v=>v>s.water+1),preset+' micro land');assert.ok(h[0]<s.water,preset+' surrounding sea');}
 assert.throws(()=>worldSettings(f.model.state,{...defaultWorldRequest(),areaSize:MIN_AREA_SIZE/2}));
});
