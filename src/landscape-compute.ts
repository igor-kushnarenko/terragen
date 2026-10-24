import { clamp, smoothstep } from './noise';
import { HALF, SIZE, type EditorState } from './state';
import { sampleHeight, segmentPoint } from './trail-math';
import type { Vec2, WaterBody, WorldRoute } from './world';
import type { Progress } from './terrain-compute';
import {waterLevelAt} from './water-math';
export interface HeightFeature { kind:'pad'|'valley'; points:Vec2[]; radius:number; height:number; }
interface ConeSeed { x:number; z:number; h:number; }
interface ConeNode { x0:number;x1:number;z0:number;z1:number;h:number;seeds?:ConeSeed[];left?:ConeNode;right?:ConeNode; }
function coneTree(seeds:ConeSeed[],depth=0):ConeNode{
    const node:ConeNode={x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity,h:Infinity};
    for(const p of seeds){node.x0=Math.min(node.x0,p.x);node.x1=Math.max(node.x1,p.x);node.z0=Math.min(node.z0,p.z);node.z1=Math.max(node.z1,p.z);node.h=Math.min(node.h,p.h);}
    if(seeds.length<=16)node.seeds=seeds;
    else{seeds.sort((a,b)=>depth%2?a.z-b.z:a.x-b.x);const mid=seeds.length>>1;node.left=coneTree(seeds.slice(0,mid),depth+1);node.right=coneTree(seeds.slice(mid),depth+1);}return node;
}
function coneHeight(root:ConeNode,x:number,z:number,grade:number){
    let result=Infinity;const lower=(n:ConeNode)=>n.h+grade*Math.hypot(Math.max(n.x0-x,0,x-n.x1),Math.max(n.z0-z,0,z-n.z1));
    function visit(node:ConeNode){if(lower(node)>=result)return;if(node.seeds){for(const p of node.seeds)result=Math.min(result,p.h+grade*Math.hypot(x-p.x,z-p.z));}
        else{const a=node.left!,b=node.right!;if(lower(a)<lower(b)){visit(a);visit(b);}else{visit(b);visit(a);}}}
    visit(root);return result;
}
export function localWater(water:number,bodies:WaterBody[],x:number,z:number){
    return waterLevelAt(water,bodies,x,z);
}
/** All earthworks run in the same cancellable worker as terrain generation. */
export function shapeLandscape(settings:EditorState,input:Float32Array,features:HeightFeature[]=[],routes:WorldRoute[]=[],bodies:WaterBody[]=[],progress:Progress=()=>{}){
    const N=settings.N,n=N+1,cell=SIZE/N,heights=input.slice();
    if(input.length!==n*n || features.length>32 || routes.length>64)throw new Error('Слишком большая операция ландшафта');
    for(let j=0;j<n;j++){
        if(j%8===0)progress(j/n*0.2);
        for(let i=0;i<n;i++){
            const x=-HALF+i*cell,z=-HALF+j*cell,k=j*n+i;
            if(settings.areaSize<1 && Math.hypot(x,z)>=HALF*settings.areaSize)continue;
            for(const feature of features){
                let distance=Math.hypot(x-feature.points[0][0],z-feature.points[0][1]);
                for(let p=1;p<feature.points.length;p++){const near=segmentPoint(x,z,feature.points[p-1],feature.points[p]);distance=Math.min(distance,Math.hypot(x-near.x,z-near.z));}
                const weight=1-smoothstep(feature.radius*(feature.kind==='pad'?0.55:0.25),feature.radius,distance);
                heights[k]+=(feature.height-heights[k])*weight;
            }
        }
    }
    if(!routes.length){progress(1);return heights;}
    const mask=new Float32Array(heights.length),seeds:ConeSeed[]=[];
    for(const route of routes){
        if(route.points.length>1000 || route.points.length<2 || !route.maxGrade)throw new Error('Некорректная тропа');
        const core=route.width/2+cell*2,shoulder=Math.max(6,cell*3),limit=core+shoulder;
        for(const p of route.points)seeds.push({x:p[0],z:p[1],h:Math.max(sampleHeight(heights,N,...p),localWater(settings.water,bodies,...p)+1.5)});
        for(let p=1;p<route.points.length;p++){
            const a=route.points[p-1],b=route.points[p];
            const x0=clamp(Math.floor((Math.min(a[0],b[0])-limit+HALF)/cell),0,N),x1=clamp(Math.ceil((Math.max(a[0],b[0])+limit+HALF)/cell),0,N);
            const z0=clamp(Math.floor((Math.min(a[1],b[1])-limit+HALF)/cell),0,N),z1=clamp(Math.ceil((Math.max(a[1],b[1])+limit+HALF)/cell),0,N);
            for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){
                const x=-HALF+i*cell,z=-HALF+j*cell,near=segmentPoint(x,z,a,b),distance=Math.hypot(x-near.x,z-near.z),k=j*n+i;
                mask[k]=Math.max(mask[k],1-smoothstep(core,limit,distance));
            }
        }
    }
    // A lower envelope of cones is Lipschitz continuous. The 0.65 margin also
    // bounds the gradients of the actual triangulated grid, not only a sampled profile.
    const grade=Math.min(...routes.map(r=>r.maxGrade!))*0.65;
    const cones=coneTree(seeds);
    for(let j=0;j<n;j++){
        if(j%4===0)progress(0.2+j/n*0.8);
        for(let i=0;i<n;i++){
            const k=j*n+i;if(mask[k]<=0)continue;
            const x=-HALF+i*cell,z=-HALF+j*cell;let target=coneHeight(cones,x,z,grade);
            if(settings.areaSize<1 && Math.hypot(x,z)>=HALF*settings.areaSize)continue;
            target=Math.max(target,localWater(settings.water,bodies,x,z)+1.5);
            heights[k]+= (target-heights[k])*mask[k];
        }
    }
    progress(1);return heights;
}
