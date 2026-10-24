import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {createModel} from '../src/state';
import {generateHeightmap} from '../src/terrain-compute';
import {editorFixture} from './fixture';
import {initializeModelLibrary,getModel} from '../src/model-library';
import {createVegetationPainter,DEFAULT_VEGETATION_BRUSH,MAX_STROKE_OBJECTS} from '../src/vegetation-paint';
import {captureDocument,decodeProject} from '../src/project';
import {MAX_WORLD_OBJECTS,type WorldObject} from '../src/world';
import {scatterObjects} from '../src/scatter';
await initializeModelLibrary();

test('seeded coasts contain separate islands and deeply irregular shores at full and reduced area',()=>{
    for(const seed of [1337,17,456])for(const areaSize of [1,.25]){
        const s={...createModel().state,N:256,seed,areaSize,island:true},h=generateHeightmap(s),n=s.N+1,seen=new Set<number>(),sizes:number[]=[];
        assert.deepEqual(generateHeightmap(s),h);
        for(let k=0;k<h.length;k++)if(!seen.has(k)&&h[k]>s.water){
            const queue=[k];seen.add(k);
            for(let p=0;p<queue.length;p++){
                const at=queue[p],x=at%n,z=Math.floor(at/n);
                for(const nb of [x?at-1:-1,x<n-1?at+1:-1,z?at-n:-1,z<n-1?at+n:-1])if(nb>=0&&!seen.has(nb)&&h[nb]>s.water){seen.add(nb);queue.push(nb);}
            }
            sizes.push(queue.length);
        }
        assert.ok(sizes.filter(count=>count>=3).length>=3,`${seed}/${areaSize}: missing offshore islands ${sizes}`);
        const radii:number[]=[];
        for(let a=0;a<180;a++){
            let shore=0;
            for(let r=.2;r<.5;r+=.004){const x=Math.round((.5+Math.cos(a*Math.PI/90)*r*areaSize)*s.N),z=Math.round((.5+Math.sin(a*Math.PI/90)*r*areaSize)*s.N);if(h[z*n+x]>s.water)shore=r;}
            radii.push(shore);
        }
        assert.ok(Math.max(...radii)-Math.min(...radii)>.12,'coast is too close to a circular shoreline');
    }
});
function flat(){const f=editorFixture();f.model.heights.fill(40);f.terrain.updateMeshAll();return f;}
const settings=(patch:Partial<typeof DEFAULT_VEGETATION_BRUSH>={})=>({...structuredClone(DEFAULT_VEGETATION_BRUSH),radius:8,spacing:1,...patch});
test('a mixed vegetation stroke is seeded, avoids duplicate dabs, saves and undoes as one edit',()=>{
    const results:WorldObject[][]=[];
    for(let run=0;run<2;run++){
        const f=flat(),before=captureDocument(f.model),p=createVegetationPainter(f.model,f.terrain,f.vegetation,f.history),draft=settings({assets:['grass','flowers','fern','moss','pine','rock']});
        assert.equal(p.begin(draft),true);assert.ok(p.dab([{x:0,z:0}])>5);assert.equal(p.dab([{x:0,z:0}]),0);p.dab([{x:4,z:0}]);p.end();
        assert.equal(f.history.undoDepth,1);assert.equal(f.model.operations.at(-1)?.parameters.manualBrush,true);
        const planted=structuredClone(f.model.world.objects);results.push(planted);
        assert.ok(planted.some(o=>o.asset==='grass'));assert.ok(planted.every(o=>o.source==='manual'&&o.scale.every(v=>v>=draft.minScale&&v<=draft.maxScale)));
        assert.deepEqual(decodeProject(f.storage.projectJSON()).world.objects,planted);
        f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(f.model.world.objects,planted);
        const scattered=scatterObjects(f.model,f.terrain).objects;assert.ok(planted.every(o=>scattered.some(s=>s.id===o.id&&s.source==='manual')));
    }
    assert.deepEqual(results[0],results[1]);
});
test('painting respects shores, slopes, trails and existing solid models; empty and cancelled strokes leave no history',()=>{
    const f=flat(),p=createVegetationPainter(f.model,f.terrain,f.vegetation,f.history);
    f.model.world.routes=[{id:'trail',name:'Trail',kind:'trail',points:[[-20,0],[20,0]],width:4}];
    f.model.world.waterBodies.push({id:'lake',kind:'lake',points:[[3,-20],[20,-20],[20,20],[3,20]],level:45,opacity:.7,wave:1,width:1});
    f.edits.addObject('cabin',-8,-6);
    p.begin(settings({assets:['grass']}));assert.ok(p.dab([{x:0,z:0}])>0);p.end();
    assert.ok(f.model.world.objects.every(o=>Math.abs(o.position[2])>2.3&&o.position[0]<3));
    assert.ok(f.model.world.objects.filter(o=>o.asset==='grass').every(o=>Math.hypot(o.position[0]+8,o.position[2]+6)>5),'grass intersects a cabin');
    const before=captureDocument(f.model),depth=f.history.undoDepth;
    p.begin(settings({density:0}));p.dab([{x:0,z:0}]);p.end();assert.equal(f.history.undoDepth,depth);
    p.begin(settings());p.dab([{x:-20,z:20}]);p.rollback();assert.deepEqual(captureDocument(f.model),before);
    for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)f.model.heights[j*f.model.n+i]=40+(-512+i*f.model.cell)*2;f.terrain.updateMeshAll();
    p.begin(settings({maxSlope:20}));assert.equal(p.dab([{x:0,z:0}]),0);p.end();
    assert.throws(()=>p.begin(settings({minScale:2,maxScale:1})));assert.equal(f.history.editing,false);
});
test('eraser removes selected kinds only, repairs group references and is undoable',()=>{
    const f=flat();const a=f.edits.addObject('grass',0,0)!,b=f.edits.addObject('flowers',1,0)!,tree=f.edits.addObject('pine',0,1)!;
    f.edits.groupObjects([a,b,tree]);const before=structuredClone(f.model.world),p=createVegetationPainter(f.model,f.terrain,f.vegetation,f.history);
    p.begin(settings({assets:['grass','flowers'],erase:true}));assert.equal(p.dab([{x:0,z:0}]),2);p.end();
    assert.deepEqual(f.model.world.objects.map(o=>o.id),[tree]);assert.equal(f.model.world.groups.length,0);decodeProject(f.storage.projectJSON());
    f.history.undo();assert.deepEqual(f.model.world,before);f.history.redo();assert.equal(f.model.world.objects.length,1);
});
test('dense painting is bounded per stroke and respects the project object limit',()=>{
    const f=flat(),p=createVegetationPainter(f.model,f.terrain,{rebuild(){}},f.history);
    p.begin(settings({radius:80,spacing:.3,density:1,minScale:.05,maxScale:.05}));
    for(let i=0;i<12;i++)p.dab([{x:0,z:0}]);p.end();assert.ok(f.model.world.objects.length>400);assert.ok(f.model.world.objects.length<=MAX_STROKE_OBJECTS);assert.equal(p.statistics.limited,true);
    const template=f.model.world.objects[0];f.model.world.objects=Array.from({length:MAX_WORLD_OBJECTS-1},(_,i)=>({...structuredClone(template),id:'existing-'+i,position:[400,40,400] as [number,number,number]}));
    p.begin(settings());p.dab([{x:0,z:0}]);p.end();assert.equal(f.model.world.objects.length,MAX_WORLD_OBJECTS);
});
test('manual fine plants use their real geometry, instancing and nearby visibility without heavy shadows',()=>{
    const f=flat();for(const asset of ['grass','flowers','fern','moss']){assert.equal(getModel(asset).collider,'none');f.edits.addObject(asset,0,0);}
    const camera=new PerspectiveCamera();camera.position.set(0,45,5);camera.lookAt(0,40,0);camera.updateMatrixWorld();f.vegetation.updateView(camera);
    const plants=f.render.scene.children.filter(o=>o.name.startsWith('Objects '));assert.equal(plants.length,4);assert.ok(plants.every(o=>o.visible&&!(o as any).castShadow));
    camera.position.set(400,200,400);camera.updateMatrixWorld();f.vegetation.updateView(camera);assert.ok(plants.every(o=>!o.visible));
});
