import {HALF,SIZE,SPLAT_RES,type EditorState,type EditorModel} from './state';
import {clamp,smoothstep} from './noise';
import type {WaterBody} from './world';
import {waterBounds,waterSignedDistance} from './water-math';
import type {Progress} from './terrain-compute';

export function carveWater(settings:EditorState,input:Float32Array,bodies:WaterBody[],progress:Progress=()=>{}) {
    if(input.length!==(settings.N+1)**2||bodies.length>32)throw new Error('Слишком большая операция водоёма');
    const heights=input.slice(),n=settings.N+1,cell=SIZE/settings.N;
    bodies.forEach((body,b)=>{
        if(body.kind==='ocean')return;
        const bank=body.bankWidth??8,depth=body.depth??4,bounds=waterBounds(body,bank);
        const i0=clamp(Math.floor((bounds.minX+HALF)/cell),0,settings.N),i1=clamp(Math.ceil((bounds.maxX+HALF)/cell),0,settings.N);
        const j0=clamp(Math.floor((bounds.minZ+HALF)/cell),0,settings.N),j1=clamp(Math.ceil((bounds.maxZ+HALF)/cell),0,settings.N);
        for(let j=j0;j<=j1;j++){
            if(j%4===0)progress((b+(j-j0)/Math.max(1,j1-j0))/bodies.length);
            for(let i=i0;i<=i1;i++){
                const p=waterSignedDistance(body,-HALF+i*cell,-HALF+j*cell);if(p.signed<-bank)continue;
                const outlet=body.outlet!==undefined&&p.segment>=body.outlet;
                const bedLevel=outlet?(body.endLevel??settings.water):p.level;
                const target=p.signed>=0?bedLevel-depth*smoothstep(0,Math.max(cell,body.kind==='river'?body.width*.3:depth*1.5),p.signed):bedLevel+(-p.signed/bank)*Math.max(1,depth*.5);
                const weight=p.signed>=0?1:1-smoothstep(bank*.2,bank,-p.signed),k=j*n+i;
                heights[k]+=(outlet?Math.min(0,target-heights[k]):target-heights[k])*weight;
            }
        }
    });progress(1);return heights;
}
export function paintWaterBanks(model:EditorModel,bodies:WaterBody[]) {
    const cell=SIZE/SPLAT_RES;
    for(const body of bodies){
        if(body.kind==='ocean')continue;
        const bank=body.bankWidth??8,bounds=waterBounds(body,bank);
        const i0=clamp(Math.floor((bounds.minX+HALF)/cell),0,SPLAT_RES-1),i1=clamp(Math.ceil((bounds.maxX+HALF)/cell),0,SPLAT_RES-1);
        const j0=clamp(Math.floor((bounds.minZ+HALF)/cell),0,SPLAT_RES-1),j1=clamp(Math.ceil((bounds.maxZ+HALF)/cell),0,SPLAT_RES-1);
        for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
            const p=waterSignedDistance(body,-HALF+(i+.5)*cell,-HALF+(j+.5)*cell);
            if(p.signed<-bank||p.signed>bank)continue;
            const weight=(1-smoothstep(bank*.35,bank,Math.abs(p.signed)))*.9,k=(j*SPLAT_RES+i)*4;
            for(let c=0;c<4;c++){model.splat[k+c]*=1-weight;model.splatDetail[k+c]*=1-weight;}
            if(body.bankSurface==='gravel')model.splatDetail[k+2]+=255*weight;else model.splat[k+2]+=255*weight;
        }
    }
}
