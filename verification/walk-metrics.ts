export function percentile(values:readonly number[],p:number){
    if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
}
export interface WalkFrame {dtMs:number;cpuMs:number;calls:number;triangles:number;objects:number;x:number;y:number;z:number;}
export function walkMetrics(frames:readonly WalkFrame[]){
    const times=frames.map(f=>f.dtMs),seconds=times.reduce((sum,t)=>sum+t,0)/1000;
    return {frames:frames.length,seconds,fps:seconds?frames.length/seconds:0,medianMs:percentile(times,.5),p95Ms:percentile(times,.95),p99Ms:percentile(times,.99),maxMs:Math.max(0,...times),
        over50Ms:times.filter(t=>t>50).length,over100Ms:times.filter(t=>t>100).length,cpuP95Ms:percentile(frames.map(f=>f.cpuMs),.95),
        callsP95:percentile(frames.map(f=>f.calls),.95),trianglesP95:percentile(frames.map(f=>f.triangles),.95)};
}
