import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import { createJobRunner, OperationCancelled, type JobWorker } from '../src/worker-jobs';
import { createModel } from '../src/state';
import { generateHeightmap, erodeHeightmap } from '../src/terrain-compute';
import {shapeLandscape} from '../src/landscape-compute';
import {trailCurve} from '../src/trail-math';
import {carveWater} from '../src/water-compute';
import type {WorldRoute} from '../src/world';

// Run the production worker entry in an actual separate thread, with only the browser transport adapted.
const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, target: 'es2022', lib: { entry: 'src/terrain.worker.ts', formats: ['iife'], name: 'TerrainWorker' } } });
const output = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).find(item => item.type === 'chunk');
assert.ok(output && output.type === 'chunk');
const source = `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);parentPort.on('message',data=>self.onmessage({data}));${output.code}`;
function factory(): JobWorker {
    const thread = new Worker(source, { eval: true });
    const adapter: JobWorker = { onmessage: null, onerror: null, onmessageerror: null,
        postMessage(job, transfer) { thread.postMessage(job, transfer); }, terminate() { void thread.terminate(); } };
    thread.on('message', data => adapter.onmessage?.({ data } as MessageEvent));
    thread.on('error', error => adapter.onerror?.({ message: error.message, preventDefault() {} } as ErrorEvent));
    return adapter;
}

test('production worker carves separate water basins with progress and keeps live terrain attached',async()=>{
    const jobs=createJobRunner(factory),settings={...createModel().state,N:128},heights=new Float32Array(129**2).fill(40),waterBodies=[{id:'lake',kind:'lake' as const,level:30,width:1,opacity:.7,wave:0,depth:5,points:[[-100,-100],[100,-100],[100,100],[-100,100]] as [number,number][]}];
    const progress:number[]=[];let beats=0;const timer=setInterval(()=>beats++,2);
    try{const result=await jobs.run({kind:'water',settings,seed:1,heights,waterBodies},p=>progress.push(p));assert.deepEqual(result,carveWater(settings,heights,waterBodies));assert.equal(heights[64*129+64],40);assert.equal(result[64*129+64],25);assert.ok(beats>0);assert.equal(progress.at(-1),1);assert.ok(progress.every((p,i)=>!i||p>=progress[i-1]));}finally{clearInterval(timer);jobs.cancel();}
});
test('production worker returns deterministic generation and erosion while the main thread stays responsive', async () => {
    const jobs = createJobRunner(factory), settings = { ...createModel().state, N: 128, droplets: 10, thermal: 2 };
    const progress: number[] = []; let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 2);
    try {
        const heights = await jobs.run({ kind: 'terrain', settings, seed: settings.seed }, value => progress.push(value));
        assert.deepEqual(heights, generateHeightmap(settings)); assert.ok(progress.length > 1); assert.equal(progress.at(-1), 1); assert.ok(heartbeats > 0);
        const eroded = await jobs.run({ kind: 'erosion', settings, seed: 123, heights }, () => {});
        assert.deepEqual(eroded, erodeHeightmap(settings, 123, heights)); assert.equal(heights.byteLength, 129 ** 2 * 4);
    } finally { clearInterval(timer); jobs.cancel(); }
});
test('terminating a production worker cancels a large operation promptly', async () => {
    const jobs = createJobRunner(factory), settings = { ...createModel().state, N: 512 };
    const task = jobs.run({ kind: 'terrain', settings, seed: settings.seed }, () => jobs.cancel());
    await assert.rejects(task, OperationCancelled);
});
test('production worker grades curved trails without blocking the main thread or detaching live heights',async()=>{
    const jobs=createJobRunner(factory),settings={...createModel().state,N:128,water:0},heights=new Float32Array(129**2);
    for(let j=0;j<129;j++)for(let i=0;i<129;i++)heights[j*129+i]=30+(i>64?120:0);
    const controls:[number,number][]=[[-200,-50],[0,80],[200,-30]],route:WorldRoute={id:'test',name:'Test',kind:'trail',width:8,points:trailCurve(controls,4),maxGrade:0.3};
    let ticks=0;const timer=setInterval(()=>ticks++,2);const progress:number[]=[];
    try{const result=await jobs.run({kind:'shape',settings,seed:1,heights,routes:[route]},p=>progress.push(p));assert.deepEqual(result,shapeLandscape(settings,heights,[],[route]));assert.ok(ticks>0);assert.equal(heights.byteLength,129**2*4);assert.equal(progress.at(-1),1);assert.ok(progress.every((p,i)=>!i||p>=progress[i-1]));}
    finally{clearInterval(timer);jobs.cancel();}
});
