import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {createModel,SIZE} from '../src/state';
import {connectRiverToSea} from '../src/river-mouth';
import {createCoastlineField} from '../src/coastline';
import {waterPath,validWaterOutline} from '../src/water-math';
import {createWaterDomain} from '../src/water-domain';
import {carveWater} from '../src/water-compute';
import {captureDocument,decodeProject} from '../src/project';
import {editorFixture} from './fixture';
import {createWaterEdits} from '../src/water-edits';
import type {WaterBody} from '../src/world';

function outlet(level=26,seed=1337){
    const settings={...createModel().state,N:128,areaSize:.5,seed};
    const source:WaterBody={id:'outlet',kind:'river',points:[[0,0],[0,40],[0,65]],level,endLevel:level-1,width:10,depth:3,bankWidth:5,opacity:.75,wave:.1,flowSpeed:.6};
    return {settings,source,body:connectRiverToSea(settings,source)};
}

test('coastal rivers extend into the sea with a continuous deterministic height profile',()=>{
    for(const seed of [1337,17,456,4280917390]){
        const {settings,source,body}=outlet(26,seed),shore=createCoastlineField(seed),size=SIZE*settings.areaSize;
        assert.deepEqual(connectRiverToSea(settings,source),body);assert.deepEqual(connectRiverToSea(settings,body),body);
        assert.ok(validWaterOutline('river',body.points));assert.ok(body.outlet!>=source.points.length);
        assert.ok(shore(body.points.at(-1)![0]/size,body.points.at(-1)![1]/size)<0);
        assert.equal(body.pointLevels!.at(-1),settings.water);assert.equal(body.endLevel,settings.water);
        assert.equal(body.pointLevels![body.outlet!],source.endLevel);
        for(let i=1;i<body.points.length;i++){
            assert.ok(body.pointLevels![i]<=body.pointLevels![i-1]);
            assert.ok(Math.abs(waterPath(body,...body.points[i]).level-body.pointLevels![i])<1e-8);
            const a=body.points[i-1],b=body.points[i],mid: [number,number]=[(a[0]+b[0])/2,(a[1]+b[1])/2];
            assert.ok(Math.abs(waterPath(body,...mid).level-(body.pointLevels![i-1]+body.pointLevels![i])/2)<1e-8);
        }
        assert.deepEqual(source.points,[[0,0],[0,40],[0,65]],'source remains unchanged');
        const reversed={...body,points:[...body.points].reverse(),pointLevels:[...body.pointLevels!].reverse(),flowDirection:-1 as const};
        for(const point of body.points)assert.equal(waterPath(reversed,...point).level,waterPath(body,...point).level);
    }
});

test('elevated mouths have steep waterfall geometry while near-sea rivers have gentle outlets',()=>{
    for(const high of [true,false]){
        const {settings,body}=outlet(high?26:createModel().state.water+1.4);
        const slopes=body.points.slice(1).map((p,i)=>(body.pointLevels![i]-body.pointLevels![i+1])/Math.hypot(p[0]-body.points[i][0],p[1]-body.points[i][1]));
        if(high)assert.ok(Math.max(...slopes)>2);else assert.ok(Math.max(...slopes)<.2);
        const domain=createWaterDomain(body,6),pos=domain.geometry.attributes.position,index=domain.geometry.index!;
        let steep=0;
        for(let i=0;i<index.count;i+=3){
            const a=new Vector3().fromBufferAttribute(pos,index.getX(i)),b=new Vector3().fromBufferAttribute(pos,index.getX(i+1)),c=new Vector3().fromBufferAttribute(pos,index.getX(i+2));
            const normal=b.sub(a).cross(c.sub(a)).normalize();assert.ok(normal.y>0);if(normal.y<.5)steep++;
        }
        if(high)assert.ok(steep>0,'fall must survive a coarse domain mesh');
        assert.equal(waterPath(body,...body.points.at(-1)!).level,settings.water);
        domain.geometry.dispose();domain.texture.dispose();
    }
});

test('outlet earthworks excavate a connected estuary without raising seabed or building a dam',()=>{
    const {settings,body}=outlet(),shore=createCoastlineField(settings.seed),size=SIZE*settings.areaSize,n=settings.N+1;
    const heights=new Float32Array(n*n);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++)heights[j*n+i]=shore((i/settings.N-.5)/settings.areaSize,(j/settings.N-.5)/settings.areaSize)>0?28:settings.water-5;
    const shaped=carveWater(settings,heights,[body]);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        const x=(i/settings.N-.5)*SIZE,z=(j/settings.N-.5)*SIZE,k=j*n+i;
        if(shore(x/size,z/size)<0)assert.ok(shaped[k]<=heights[k]);
    }
    assert.ok(shaped.some((h,i)=>heights[i]>settings.water&&h<settings.water),'estuary must reach below sea level');
});

test('river profiles survive save/load and appearance edits; malformed profiles are rejected',async()=>{
    const f=editorFixture(),{body}=outlet();f.model.world.waterBodies.push(body);
    const saved=f.storage.projectJSON();assert.deepEqual(decodeProject(saved).world.waterBodies.at(-1),body);
    for(const change of [(b:any)=>b.pointLevels.pop(),(b:any)=>b.pointLevels[1]=NaN,(b:any)=>b.pointLevels[1]=b.level+5,(b:any)=>b.outlet=999,(b:any)=>b.outlet=.5]){
        const data=JSON.parse(saved);change(data.world.waterBodies.at(-1));assert.throws(()=>decodeProject(JSON.stringify(data)),/Неверный проект/);
    }
    let jobs=0;const edits=createWaterEdits(f.model,f.terrain,f.vegetation,f.materials,f.history,f.feedback,{async run(job){jobs++;return carveWater(job.settings,job.heights!,job.waterBodies!);},cancel(){}});
    const before=captureDocument(f.model);await edits.upsert({...body,clarity:15});assert.equal(jobs,0);assert.deepEqual(f.model.world.waterBodies.at(-1)?.pointLevels,body.pointLevels);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);
});
