import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel,SIZE} from '../src/state';
import {WORLD_PRESET_IDS} from '../src/world';
import {worldSettings,defaultWorldRequest} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {createCoastlineField} from '../src/coastline';
import {jungleDefaults} from '../src/jungle-settings';
import {jungleWaterBodies} from '../src/jungle-terrain';
import {taigaDefaults} from '../src/taiga-settings';
import {taigaWaterBodies} from '../src/taiga-terrain';

function components(h:Float32Array,N:number,water:number){
    const seen=new Uint8Array(h.length),sizes:number[]=[],n=N+1;
    for(let k=0;k<h.length;k++)if(!seen[k]&&h[k]>water){
        const queue=[k];seen[k]=1;
        for(let p=0;p<queue.length;p++){
            const at=queue[p],x=at%n,z=Math.floor(at/n);
            for(const next of [x?at-1:-1,x<N?at+1:-1,z?at-n:-1,z<N?at+n:-1]){
                if(next>=0&&!seen[next]&&h[next]>water){seen[next]=1;queue.push(next);}
            }
        }
        sizes.push(queue.length);
    }
    return sizes.filter(size=>size>=3);
}

test('all cropped world recipes have seeded bays and irregular outlines instead of circular clipping',()=>{
    for(const preset of WORLD_PRESET_IDS)for(const seed of [1337,17,456])for(const areaSize of [.25,.5,.75]){
        const settings=worldSettings(createModel().state,{...defaultWorldRequest(),preset,seed,areaSize,N:128});
        const job={kind:'terrain' as const,settings,preset,seed,worldErosion:0 as const};
        const h=computeTerrainJob(job),n=settings.N+1;
        assert.deepEqual(computeTerrainJob(job),h,`${preset}/${seed}/${areaSize}: reproducibility`);
        assert.ok(h.every(Number.isFinite));
        const radii:number[]=[];
        for(let a=0;a<120;a++){
            let shore=0;
            for(let r=.15;r<.5;r+=.005){
                const x=Math.round((.5+Math.cos(a*Math.PI/60)*r*areaSize)*settings.N),z=Math.round((.5+Math.sin(a*Math.PI/60)*r*areaSize)*settings.N);
                if(h[z*n+x]>settings.water)shore=r;
            }
            radii.push(shore);
        }
        assert.ok(Math.max(...radii)-Math.min(...radii)>.1,`${preset}/${seed}/${areaSize}: circular shore`);
        for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(Math.hypot(i/settings.N-.5,j/settings.N-.5)>=areaSize*.5){
            assert.ok(h[j*n+i]<settings.water,`${preset}: land outside selected area`);
        }
    }
});

test('cropped mainland biomes include offshore islands even with flat relief, and seeds change the outline',()=>{
    for(const preset of ['desert','jungle','taiga'] as const){
        let previous:Float32Array|undefined;
        for(const seed of [1337,17,456]){
            const settings=worldSettings(createModel().state,{...defaultWorldRequest(),preset,seed,areaSize:.5,N:256,terrain:{height:0,sharp:0}});
            const h=computeTerrainJob({kind:'terrain',settings,preset,seed,worldErosion:0});
            assert.ok(components(h,256,settings.water).length>=3,`${preset}/${seed}: missing offshore islands`);
            if(previous)assert.notDeepEqual(h,previous);previous=h;
        }
    }
});

test('preview and detailed mainland generation use the same shoreline in map coordinates',()=>{
    for(const preset of ['desert','jungle','taiga'] as const){
        const settings=worldSettings(createModel().state,{...defaultWorldRequest(),preset,areaSize:.5,seed:17,N:256});
        // Disable inland waters here to compare the coast independently of grid-sized river banks.
        const jungle={...jungleDefaults(),streams:false},taiga={...taigaDefaults(),water:false};
        const h=computeTerrainJob({kind:'terrain',settings,preset,seed:17,worldErosion:0,jungle,taiga});
        const preview=computeTerrainJob({kind:'terrain',settings:{...settings,N:64},preset,seed:17,worldErosion:0,jungle,taiga});
        for(let j=0;j<=64;j++)for(let i=0;i<=64;i++)assert.equal(h[j*4*257+i*4]>settings.water,preview[j*65+i]>settings.water,`${preset}: preview shore`);
    }
});

test('lakes stay inland, rivers reach the sea and erosion does not fill new bays',()=>{
    for(const preset of ['jungle','taiga'] as const)for(const seed of [1337,17,456]){
        const settings=worldSettings(createModel().state,{...defaultWorldRequest(),preset,areaSize:.5,N:128,seed});
        const shore=createCoastlineField(seed),size=SIZE*settings.areaSize;
        const bodies=preset==='jungle'?jungleWaterBodies(settings,jungleDefaults()):taigaWaterBodies(settings,taigaDefaults());
        assert.ok(bodies.some(body=>body.kind==='river'),`${preset}/${seed}: inland river lost`);
        for(const body of bodies){
            if(body.kind==='lake')for(const [x,z]of body.points)assert.ok(shore(x/size,z/size)*size>(body.bankWidth??8));
            else {assert.ok(body.outlet!==undefined);assert.equal(body.endLevel,settings.water);const [x,z]=body.points.at(-1)!;assert.ok(shore(x/size,z/size)<0);}
        }
        const h=computeTerrainJob({kind:'terrain',settings,preset,seed,worldErosion:1});
        for(let j=0;j<=settings.N;j++)for(let i=0;i<=settings.N;i++){
            const u=(i/settings.N-.5)/settings.areaSize,v=(j/settings.N-.5)/settings.areaSize;
            if(shore(u,v)<-.02)assert.ok(h[j*(settings.N+1)+i]<settings.water,`${preset}/${seed}: raised seabed in a bay`);
        }
    }
});
