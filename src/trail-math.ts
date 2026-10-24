import { CatmullRomCurve3, Vector3, type Ray } from 'three';
import { clamp } from './noise';
import { HALF, SIZE } from './state';
import type { Vec2, WorldRoute } from './world';

export function segmentPoint(x: number, z: number, a: Vec2, b: Vec2) {
    const dx=b[0]-a[0], dz=b[1]-a[1], length=dx*dx+dz*dz;
    const t=length?clamp(((x-a[0])*dx+(z-a[1])*dz)/length,0,1):0;
    return { x:a[0]+dx*t, z:a[1]+dz*t, t };
}
export function polylineDistance(points: Vec2[], x: number, z: number) {
    let distance=Infinity;
    for(let i=1;i<points.length;i++){const p=segmentPoint(x,z,points[i-1],points[i]);distance=Math.min(distance,Math.hypot(x-p.x,z-p.z));}
    return distance;
}
export function routeLength(points: Vec2[]) { return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0); }
export function controlPointHit(ray:Ray,points:Vec2[],getH:(x:number,z:number)=>number,radius:number){
    let index=-1,distance=radius*1.35;
    for(let i=0;i<points.length;i++){const p=points[i],center=new Vector3(p[0],getH(...p)+radius,p[1]),d=ray.distanceToPoint(center);if(d<distance){distance=d;index=i;}}
    return index;
}
export function trailCurve(controls: Vec2[], step=2): Vec2[] {
    const clean=controls.filter((p,i)=>!i||Math.hypot(p[0]-controls[i-1][0],p[1]-controls[i-1][1])>0.25);
    if(clean.length<2) return [];
    if(clean.length>64 || clean.some(p=>p.length!==2 || p.some(n=>!Number.isFinite(n)||Math.abs(n)>HALF)))throw new Error('Контрольные точки тропы некорректны');
    const curve=new CatmullRomCurve3(clean.map(p=>new Vector3(p[0],0,p[1])),false,'centripetal');
    const points:Vec2[]=curve.getSpacedPoints(Math.min(999,Math.max(2,Math.ceil(routeLength(clean)/Math.max(1,step))))).map(p=>[p.x,p.z]);
    points[0]=[...clean[0]];points[points.length-1]=[...clean.at(-1)!];return points;
}
export function sampleHeight(heights: Float32Array, N: number, x: number, z: number) {
    const fx=clamp((x+HALF)/SIZE*N,0,N-0.00001),fz=clamp((z+HALF)/SIZE*N,0,N-0.00001),i=Math.floor(fx),j=Math.floor(fz),tx=fx-i,tz=fz-j,k=j*(N+1)+i;
    return (heights[k]*(1-tx)+heights[k+1]*tx)*(1-tz)+(heights[k+N+1]*(1-tx)+heights[k+N+2]*tx)*tz;
}
export function triangleGrade(heights: Float32Array, N: number, x: number, z: number) {
    const fx=clamp((x+HALF)/SIZE*N,0,N-0.00001),fz=clamp((z+HALF)/SIZE*N,0,N-0.00001),i=Math.floor(fx),j=Math.floor(fz),k=j*(N+1)+i,cell=SIZE/N;
    return fx-i+fz-j<=1?Math.hypot(heights[k+1]-heights[k],heights[k+N+1]-heights[k])/cell
        :Math.hypot(heights[k+N+2]-heights[k+N+1],heights[k+N+2]-heights[k+1])/cell;
}
/** Local corridor queries avoid scanning thousands of curve segments for every plant. */
export class RouteIndex {
    private bins=new Map<string,{a:Vec2;b:Vec2;width:number}[]>();
    constructor(routes: WorldRoute[]) {
        for(const route of routes)for(let i=1;i<route.points.length;i++){
            const a=route.points[i-1],b=route.points[i],pad=route.width/2+32,entry={a,b,width:route.width};
            for(let z=Math.floor((Math.min(a[1],b[1])-pad)/32);z<=Math.floor((Math.max(a[1],b[1])+pad)/32);z++)
                for(let x=Math.floor((Math.min(a[0],b[0])-pad)/32);x<=Math.floor((Math.max(a[0],b[0])+pad)/32);x++){
                    const key=x+','+z,list=this.bins.get(key)??[];list.push(entry);this.bins.set(key,list);
                }
        }
    }
    clearance(x:number,z:number){
        let distance=Infinity;
        for(const segment of this.bins.get(Math.floor(x/32)+','+Math.floor(z/32))??[]){const p=segmentPoint(x,z,segment.a,segment.b);distance=Math.min(distance,Math.hypot(x-p.x,z-p.z)-segment.width/2);}
        return distance;
    }
}
