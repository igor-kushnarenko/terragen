import {clamp} from './noise';
import type {Vec2,WaterBody} from './world';

export function polygonContains(x:number,z:number,points:Vec2[]) {
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
        const a=points[i],b=points[j];
        if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
}
export function waterPath(body:WaterBody,x:number,z:number) {
    const points=body.points,lengths:number[]=[];let total=0;
    const count=body.kind==='lake'?points.length:points.length-1;
    for(let i=0;i<count;i++){const a=points[i],b=points[(i+1)%points.length],d=Math.hypot(b[0]-a[0],b[1]-a[1]);lengths.push(d);total+=d;}
    let distance=Infinity,along=0,passed=0,px=x,pz=z,dx=0,dz=0,segment=0,fraction=0;
    for(let i=0;i<count;i++){
        const a=points[i],b=points[(i+1)%points.length],length=lengths[i];
        const t=length?clamp(((x-a[0])*(b[0]-a[0])+(z-a[1])*(b[1]-a[1]))/(length*length),0,1):0;
        const xx=a[0]+(b[0]-a[0])*t,zz=a[1]+(b[1]-a[1])*t,d=Math.hypot(x-xx,z-zz);
        if(d<distance){distance=d;along=passed+length*t;px=xx;pz=zz;dx=length?(b[0]-a[0])/length:0;dz=length?(b[1]-a[1])/length:0;segment=i;fraction=t;}
        passed+=length;
    }
    const direction=body.flowDirection??1,t=total?along/total:0,progress=direction===1?t:1-t;
    const level=body.pointLevels?body.pointLevels[segment]+(body.pointLevels[segment+1]-body.pointLevels[segment])*fraction:body.level+((body.endLevel??body.level)-body.level)*progress;
    return {distance,along,total,segment,x:px,z:pz,dx:dx*direction,dz:dz*direction,level:body.kind==='river'?level:body.level};
}
export function waterSignedDistance(body:WaterBody,x:number,z:number) {
    const path=waterPath(body,x,z);
    return {...path,signed:body.kind==='lake'?(polygonContains(x,z,body.points)?path.distance:-path.distance):body.width/2-path.distance};
}
export function waterBounds(body:WaterBody,padding=0) {
    const width=(body.kind==='river'?body.width/2:0)+padding;
    return {minX:Math.min(...body.points.map(p=>p[0]))-width,maxX:Math.max(...body.points.map(p=>p[0]))+width,minZ:Math.min(...body.points.map(p=>p[1]))-width,maxZ:Math.max(...body.points.map(p=>p[1]))+width};
}
const caches=new WeakMap<WaterBody[],{length:number;bins:Map<string,WaterBody[]>}>();
function candidates(bodies:WaterBody[],x:number,z:number){
    const cached=caches.get(bodies);let bins=cached?.length===bodies.length?cached.bins:undefined;
    if(!bins){bins=new Map();for(const body of bodies){if(body.kind==='ocean')continue;const b=waterBounds(body);for(let j=Math.floor(b.minZ/32);j<=Math.floor(b.maxZ/32);j++)for(let i=Math.floor(b.minX/32);i<=Math.floor(b.maxX/32);i++){const key=i+','+j,list=bins.get(key)??[];list.push(body);bins.set(key,list);}}caches.set(bodies,{length:bodies.length,bins});}
    return bins.get(Math.floor(x/32)+','+Math.floor(z/32))??[];
}
/** The highest surface at this coordinate; the ocean remains the fallback. */
export function waterAt(water:number,bodies:WaterBody[],x:number,z:number) {
    let level=water,body:WaterBody|undefined,dx=0,dz=0;
    for(const item of candidates(bodies,x,z)){
        const p=waterSignedDistance(item,x,z);
        if(p.signed>=-1e-6&&p.level>=level){level=p.level;body=item;dx=p.dx;dz=p.dz;}
    }
    return {level,body,dx:body?.kind==='river'?dx*(body.flowSpeed??.6):0,dz:body?.kind==='river'?dz*(body.flowSpeed??.6):0};
}
export function waterLevelAt(water:number,bodies:WaterBody[],x:number,z:number){return waterAt(water,bodies,x,z).level;}

export function validWaterOutline(kind:'lake'|'river',points:Vec2[]) {
    if(points.length<(kind==='lake'?3:2)||points.length>1000)return false;
    const count=kind==='lake'?points.length:points.length-1;
    const cross=(a:Vec2,b:Vec2,c:Vec2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(let i=0;i<count;i++){
        const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.01)return false;
        for(let j=i+2;j<count;j++){
            if(kind==='lake'&&i===0&&j===count-1)continue;
            const c=points[j],d=points[(j+1)%points.length];
            if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a[0],b[0])>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])>=Math.min(a[0],b[0])&&Math.max(a[1],b[1])>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])>=Math.min(a[1],b[1]))return false;
        }
    }
    if(kind==='lake'){let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-a[1]*b[0];}if(Math.abs(area)<1)return false;}
    return true;
}
