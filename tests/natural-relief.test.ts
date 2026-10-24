import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {createModel,SIZE,type EditorState} from '../src/state';
import {generateHeightmap} from '../src/terrain-compute';
import {decodeProject,captureDocument} from '../src/project';
import {editorFixture} from './fixture';
import {TERRAIN_ALGORITHM} from '../src/generation-settings';

function reliefMetrics(settings:EditorState,heights:Float32Array){
    const n=settings.N+1,cell=SIZE/settings.N,slopes:number[]=[],curvature:number[]=[],shoreSlopes:number[]=[];
    let peak=0,max=-Infinity;
    for(let j=1;j<settings.N;j++)for(let i=1;i<settings.N;i++){
        const k=j*n+i,h=heights[k];max=Math.max(max,h);if(h<=settings.water)continue;
        const a=heights[k-1],b=heights[k+1],c=heights[k-n],d=heights[k+n];
        const slope=Math.hypot((b-a)/(2*cell),(d-c)/(2*cell));slopes.push(slope);
        curvature.push(Math.abs(4*h-a-b-c-d));peak=Math.max(peak,h-Math.max(a,b,c,d));
        if(h<settings.water+8)shoreSlopes.push(slope);
    }
    const percentile=(values:number[],fraction:number)=>values.sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]??0;
    return{max,peak,p99Slope:percentile(slopes,.99),maxSlope:percentile(slopes,1),p99Curvature:percentile(curvature,.99),shoreP99:percentile(shoreSlopes,.99)};
}

test('low and middle sharpness keep rounded mountains without isolated vertex needles',()=>{
    for(const seed of [1337,17,456,3403971791])for(const sharp of [.5,1.5,2.5]){
        const recipe={sharp};
        const s={...createModel().state,...recipe,seed},h=generateHeightmap(s),m=reliefMetrics(s,h);
        assert.ok(m.p99Curvature<4,`${seed}: abrupt changes of slope`);
        assert.ok(m.maxSlope<4,`${seed}: near-vertical generated slope`);
        assert.ok(m.peak<2,`${seed}: isolated vertex peak`);
        assert.ok(m.max>s.water+3,'nonzero sharpness must keep terrain relief');
    }
});

test('coasts have a gradual transition through the shoreline instead of a narrow wall',()=>{
    for(const seed of [1337,17,456,3403971791]){
        const s={...createModel().state,seed},h=generateHeightmap(s),m=reliefMetrics(s,h);
        assert.ok(m.shoreP99<.8,`${seed}: shoreline slope is too steep`);
        assert.deepEqual(generateHeightmap(s),h);
    }
});

test('worlds remain finite and surrounded by sea at every supported grid size, including extreme settings',()=>{
    for(const N of [16,32,64,128,256,512])for(const areaSize of [.125,1]){
        const s={...createModel().state,N,areaSize,height:400,scale:.3,sharp:5,warp:2},h=generateHeightmap(s),n=N+1;
        assert.ok(h.every(v=>Number.isFinite(v)&&Math.abs(v)<1000));
        for(let j=0;j<=N;j++)for(let i=0;i<=N;i++)if(Math.hypot(i/N-.5,j/N-.5)>=areaSize*.5)assert.ok(h[j*n+i]<s.water-5);
    }
});

test('visible relief error keeps distant islands and ridges detailed while flat terrain still simplifies',()=>{
    const f=editorFixture();f.model.N=f.model.state.N=64;f.terrain.buildTerrain();
    const camera=new PerspectiveCamera(55,16/9,.5,10000);camera.position.set(0,300,1000);camera.lookAt(0,20,0);camera.updateProjectionMatrix();
    f.model.heights.fill(20);f.terrain.updateMeshAll();f.terrain.updateView(camera,null,720);
    assert.equal(f.terrain.chunks[0].level,2,'flat terrain should still use the cheapest mesh');
    for(let z=0;z<f.model.n;z++)for(let x=0;x<f.model.n;x++)f.model.heights[z*f.model.n+x]=20+65*Math.exp(-((x-31)**2+(z-31)**2)/12);
    f.terrain.updateMeshAll();f.terrain.updateView(camera,null,720);
    const level=f.terrain.chunks[0].level;assert.ok(level<2,'a visible rounded peak was simplified too much');
    f.terrain.updateView(camera,null,1440);assert.ok(f.terrain.chunks[0].level<=level,'a larger viewport needs at least the same detail');
    camera.position.set(0,3000,9000);camera.lookAt(0,20,0);f.terrain.updateView(camera,null,720);
    assert.equal(f.terrain.chunks[0].level,2,'subpixel detail should still simplify');
});

test('new terrain algorithm is saved and old operation versions remain readable through undo and redo',async()=>{
    const f=editorFixture(),before=captureDocument(f.model);
    await f.generation.runGeneration(()=>{f.terrain.buildTerrain();f.terrain.updateMeshAll();});
    const saved=f.storage.projectJSON();assert.equal(decodeProject(saved).operations.at(-1)?.algorithmVersion,TERRAIN_ALGORITHM);
    for(const algorithmVersion of [1,2,3,4,5]){const data=JSON.parse(saved);data.operations.at(-1).algorithmVersion=algorithmVersion;assert.equal(decodeProject(JSON.stringify(data)).operations.at(-1)?.algorithmVersion,algorithmVersion);}
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.equal(f.model.operations.at(-1)?.algorithmVersion,TERRAIN_ALGORITHM);
});
