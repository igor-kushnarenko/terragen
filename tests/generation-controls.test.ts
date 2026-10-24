import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel,SIZE,type EditorState} from '../src/state';
import {generateHeightmap} from '../src/terrain-compute';
import {generationOctaveLimit} from '../src/generation-settings';
import {validateState,decodeProject} from '../src/project';
import {editorFixture} from './fixture';

const settings=(patch:Partial<EditorState>={})=>({...createModel().state,island:false,mountains:1,warp:0,height:200,...patch});
function slopePercentile(h:Float32Array,N:number){
    const n=N+1,cell=SIZE/N,slopes:number[]=[];
    for(let j=1;j<N;j++)for(let i=1;i<N;i++){const k=j*n+i;slopes.push(Math.hypot((h[k+1]-h[k-1])/(2*cell),(h[k+n]-h[k-n])/(2*cell)));}
    slopes.sort((a,b)=>a-b);return slopes[Math.floor(slopes.length*.99)];
}
function range(h:Float32Array){let min=Infinity,max=-Infinity;for(const v of h){min=Math.min(min,v);max=Math.max(max,v);}return max-min;}

test('zero sharpness or zero height creates an exactly flat dry plain for every seed',()=>{
    for(const seed of [1337,17,456])for(const patch of [{sharp:0},{height:0}]){
        const s=settings({seed,warp:2,octaves:9,...patch}),h=generateHeightmap(s);
        assert.ok(h.every(y=>y===s.water+3));
        const island=generateHeightmap({...s,island:true});
        for(let z=112;z<=144;z++)for(let x=112;x<=144;x++)assert.equal(island[z*257+x],s.water+3);
        assert.ok(island[0]<s.water-5,'the flat island must retain a sea bed');
    }
});

test('sharpness progresses from hills to visibly steep peaks instead of smoothing every setting equally',()=>{
    for(const seed of [1337,17,456]){
        let previousSlope=0,previousRange=0;
        for(const sharp of [0,.5,1,2,3,4,5]){
            const s=settings({seed,sharp}),h=generateHeightmap(s),slope=slopePercentile(h,s.N),span=range(h);
            assert.ok(slope>=previousSlope*.95,`${seed}/${sharp}: slope should increase`);
            assert.ok(span>=previousRange*.95,`${seed}/${sharp}: relief should increase`);
            previousSlope=slope;previousRange=span;
        }
        const gentle=generateHeightmap(settings({seed,sharp:1})),peaks=generateHeightmap(settings({seed,sharp:5}));
        assert.ok(slopePercentile(peaks,256)>slopePercentile(gentle,256)*5);
        assert.ok(slopePercentile(peaks,256)>2,'maximum should retain genuinely steep slopes');
    }
});

test('height scales vertical relief linearly without stretching the horizontal shape',()=>{
    const s=settings({height:50}),a=generateHeightmap(s),b=generateHeightmap({...s,height:200}),floor=s.water+3;
    for(let k=0;k<a.length;k++)assert.ok(Math.abs((a[k]-floor)*4-(b[k]-floor))<.0001);
});

test('mountain coverage has working endpoints and increasing it adds mountain areas without renormalizing the world',()=>{
    const s=settings(),hills=generateHeightmap({...s,mountains:0});let previous=hills,previousCount=0;
    for(const mountains of [.25,.5,.75,1]){
        const h=generateHeightmap({...s,mountains});let count=0;
        for(let k=0;k<h.length;k++){
            assert.ok(h[k]>=previous[k]-.0001,'coverage unexpectedly lowered existing terrain');
            if(h[k]-hills[k]>5)count++;
        }
        assert.ok(count>previousCount,'coverage should affect a larger area');previous=h;previousCount=count;
    }
    assert.ok(range(previous)>range(hills)*3);
});

test('larger horizontal scale creates fewer, broader terrain forms',()=>{
    const peaks=(scale:number)=>{const h=generateHeightmap(settings({scale,octaves:1}));let count=0;for(let x=1;x<256;x++){const k=128*257+x;if(h[k]>h[k-1]&&h[k]>h[k+1])count++;}return count;};
    assert.ok(peaks(.3)>peaks(1));assert.ok(peaks(1)>peaks(3));
});

test('every available octave adds detail with bounded amplitude and the limit follows actual grid density',()=>{
    const s=settings(),limit=generationOctaveLimit(s),base=generateHeightmap({...s,octaves:1});let previous=base;
    for(let octaves=2;octaves<=limit;octaves++){
        const h=generateHeightmap({...s,octaves});let changed=0,maxChange=0;
        for(let k=0;k<h.length;k++){if(Math.abs(h[k]-previous[k])>.0001)changed++;maxChange=Math.max(maxChange,Math.abs(h[k]-base[k]));}
        assert.ok(changed>h.length*.8);assert.ok(maxChange<s.height*.06,'detail must not rescale the mountain range');previous=h;
    }
    assert.deepEqual(generateHeightmap({...s,octaves:9}),generateHeightmap({...s,octaves:limit}));
    assert.ok(generationOctaveLimit({...s,N:512})>limit);
    assert.ok(generationOctaveLimit({...s,areaSize:.125})<limit);
    assert.ok(generationOctaveLimit({...s,scale:3})>generationOctaveLimit({...s,scale:.3}));
});

test('warp changes ridge shape while respecting the same vertical height budget and seed',()=>{
    const s=settings(),a=generateHeightmap(s),b=generateHeightmap({...s,warp:2});let difference=0;
    for(let k=0;k<a.length;k++){difference+=Math.abs(a[k]-b[k]);assert.ok(b[k]>=s.water+3&&b[k]<=s.water+3+s.height);}
    assert.ok(difference/a.length>5);assert.deepEqual(generateHeightmap({...s,warp:2}),b);
});

test('zero-valued generation controls save, load and undo without losing their endpoints',()=>{
    const f=editorFixture(),oldSharp=f.model.state.sharp;
    f.history.transaction('Плоская равнина',()=>Object.assign(f.model.state,validateState({...f.model.state,sharp:0,height:0})));
    const saved=decodeProject(f.storage.projectJSON());assert.equal(saved.state.sharp,0);assert.equal(saved.state.height,0);
    f.history.undo();assert.equal(f.model.state.sharp,oldSharp);f.history.redo();assert.equal(f.model.state.sharp,0);assert.equal(f.model.state.height,0);
    for(const patch of [{sharp:-.1},{height:-1}])assert.throws(()=>validateState({...f.model.state,...patch}));
});
