import {readFile,writeFile} from 'node:fs/promises';
const root='verification/graphics-v017/';
const read=async(name:string)=>JSON.parse(await readFile(root+name,'utf8'));
const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
const p95=(a:number[])=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length*.95)];
const comparison:Record<string,unknown>={};
for(const scene of ['forest','coast']){
    const before=await read(`browser-before-${scene}-final.json`),after=await read(`browser-after-${scene}-final.json`);
    const gpuBefore=await read(`gpu-before-${scene}.json`),gpuAfter=await read(`gpu-after-${scene}.json`);
    if(!before.renderValid||!after.renderValid||gpuBefore.disjoint||gpuAfter.disjoint)throw new Error('Invalid rendering or GPU timing');
    if(JSON.stringify(before.canvas)!==JSON.stringify(after.canvas)||before.quality!==after.quality)throw new Error('Unequal canvas or profile');
    comparison[scene]=['baseline',...(scene==='forest'?['storm']:[])].map(phase=>{
        const first=before.results.find((r:{phase:string})=>r.phase===phase),last=after.results.find((r:{phase:string})=>r.phase===phase);
        const gpu=(data:{samples:{scene:string;phase:string;ms:number}[]})=>{const values=data.samples.filter(s=>s.scene===scene&&s.phase===phase).map(s=>s.ms);if(!values.length)throw new Error('No GPU samples');return {samples:values.length,meanMs:mean(values),p95Ms:p95(values)};};
        return {phase,before:first,after:last,gpuBefore:gpu(gpuBefore),gpuAfter:gpu(gpuAfter)};
    });
}
await writeFile(root+'comparison.json',JSON.stringify(comparison,null,2));
console.log(JSON.stringify(comparison,null,2));
