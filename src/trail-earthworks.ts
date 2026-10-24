import { getModel } from './model-library';
import { objectFootprint } from './ecology';
import { HALF, SIZE, SPLAT_RES, type EditorModel } from './state';
import { clamp, smoothstep } from './noise';
import { localWater } from './landscape-compute';
import { sampleHeight, segmentPoint, triangleGrade, RouteIndex } from './trail-math';
import type { PathObstacle } from './composition';
import type { WorldRoute } from './world';
export function pathObstacles(model:EditorModel,includePlants=false):PathObstacle[]{
    return model.world.objects.filter(o=>o.source!=='scatter'&&(includePlants||!['tree','shrub'].includes(getModel(o.asset).category))).map(o=>objectFootprint(o,{getH:(x,z)=>sampleHeight(model.heights,model.N,x,z)}));
}
export function checkRoutes(model:EditorModel,routes:WorldRoute[],heights=model.heights,graded=false,preservePlants=false){
    const obstacles=pathObstacles(model,preservePlants),cell=SIZE/model.N;
    for(const route of routes)for(let i=1;i<route.points.length;i++){
        const a=route.points[i-1],b=route.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(length/Math.max(0.5,cell/2)));
        for(let s=0;s<=steps;s++){
            const x=a[0]+(b[0]-a[0])*s/steps,z=a[1]+(b[1]-a[1])*s/steps;
            if(Math.abs(x)>HALF-route.width/2-cell*2||Math.abs(z)>HALF-route.width/2-cell*2)throw new Error('Тропа слишком близко к краю мира');
            if(obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+route.width/2+0.8))throw new Error('Тропа пересекает ручной объект. Обойдите препятствие.');
            if(sampleHeight(heights,model.N,x,z)<=localWater(model.state.water,model.world.waterBodies,x,z)+(graded?0.5:0.3))throw new Error('Тропа пересекает воду. Проведите кривую по суше.');
            if(graded){
                for(const offset of [-route.width*0.3,0,route.width*0.3]){
                    const xx=x-(b[1]-a[1])/(length||1)*offset,zz=z+(b[0]-a[0])/(length||1)*offset;
                    if(triangleGrade(heights,model.N,xx,zz)>(route.maxGrade??0.36)+0.015)throw new Error('Не удалось обеспечить заданный уклон. Разведите повороты или уменьшите уклон исходного рельефа.');
                }
            }
        }
    }
}
export function paintTrails(model:EditorModel,routes:WorldRoute[]){
    const cell=SIZE/SPLAT_RES;
    for(const route of routes){
        const mask=new Float32Array(SPLAT_RES*SPLAT_RES),radius=route.width/2+1;
        for(let p=1;p<route.points.length;p++){
            const a=route.points[p-1],b=route.points[p];
            const x0=clamp(Math.floor((Math.min(a[0],b[0])-radius+HALF)/cell),0,SPLAT_RES-1),x1=clamp(Math.ceil((Math.max(a[0],b[0])+radius+HALF)/cell),0,SPLAT_RES-1);
            const z0=clamp(Math.floor((Math.min(a[1],b[1])-radius+HALF)/cell),0,SPLAT_RES-1),z1=clamp(Math.ceil((Math.max(a[1],b[1])+radius+HALF)/cell),0,SPLAT_RES-1);
            for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){
                const x=-HALF+(i+0.5)*cell,z=-HALF+(j+0.5)*cell,near=segmentPoint(x,z,a,b),weight=1-smoothstep(Math.max(0,route.width/2-0.5),radius,Math.hypot(x-near.x,z-near.z)),k=j*SPLAT_RES+i;
                mask[k]=Math.max(mask[k],weight);
            }
        }
        const layer=route.surface==='sand'?2:route.surface==='soil'?5:6;
        for(let k=0;k<mask.length;k++)if(mask[k]>0){
            const alpha=mask[k];for(let c=0;c<4;c++){model.splat[k*4+c]*=1-alpha;model.splatDetail[k*4+c]*=1-alpha;}
            const data=layer<4?model.splat:model.splatDetail;data[k*4+layer%4]=Math.min(255,data[k*4+layer%4]+alpha*255);
        }
    }
}
export function clearTrailObjects(model:EditorModel,routes:WorldRoute[],preserveManual=false){
    const index=new RouteIndex(routes),before=model.world.objects.length;
    model.world.objects=model.world.objects.filter(item=>{
        if(preserveManual&&item.source==='manual')return true;
        const category=getModel(item.asset).category;if(item.source!=='scatter'&&category!=='tree'&&category!=='shrub')return true;
        const p=objectFootprint(item,{getH:(x,z)=>sampleHeight(model.heights,model.N,x,z)});
        return index.clearance(p.x,p.z)>=p.radius+0.8;
    });return before-model.world.objects.length;
}
