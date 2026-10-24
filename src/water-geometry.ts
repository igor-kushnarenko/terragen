import * as T from 'three';
import type {WaterBody} from './world';
import {waterPath} from './water-math';

/** One continuous logarithmic grid: dense near the viewer, sparse at the horizon, no LOD seams. */
export function oceanGeometry(segments=96){
    const positions:number[]=[],indices:number[]=[],half=segments/2;
    const axis=(i:number)=>{const t=(i-half)/half;return Math.sign(t)*2*(Math.exp(Math.abs(t)*Math.log(10241))-1);};
    for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++)positions.push(axis(x),0,axis(z));
    for(let z=0;z<segments;z++)for(let x=0;x<segments;x++){const a=z*(segments+1)+x,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.setAttribute('aFlow',new T.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));g.setAttribute('aTravel',new T.Float32BufferAttribute(new Float32Array(positions.length/3),1));g.computeBoundingSphere();return g;
}
export function waterGeometry(body:WaterBody,spacing=4) {
    if(body.kind==='ocean')return oceanGeometry();
    let geometry:T.BufferGeometry;
    if(body.kind==='lake'){
        geometry=new T.ShapeGeometry(new T.Shape(body.points.map(p=>new T.Vector2(p[0],p[1]))));
        const pos=geometry.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setXYZ(i,pos.getX(i),body.level,pos.getY(i));
        const index=geometry.index!;for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+2));index.setX(i+2,a);}
        // Uniform subdivision shares midpoint vertices, preserving every polygon edge exactly.
        let positions=Array.from(pos.array),indices=Array.from(index.array);let maxEdge=0;
        for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){const a=indices[i+k]*3,b=indices[i+(k+1)%3]*3;maxEdge=Math.max(maxEdge,Math.hypot(positions[a]-positions[b],positions[a+2]-positions[b+2]));}
        for(let round=0;maxEdge>spacing&&round<8&&indices.length*4<150000;round++,maxEdge/=2){
            const midpoints=new Map<string,number>(),next:number[]=[];
            const midpoint=(a:number,b:number)=>{const key=Math.min(a,b)+','+Math.max(a,b);let mid=midpoints.get(key);if(mid!==undefined)return mid;mid=positions.length/3;for(let k=0;k<3;k++)positions.push((positions[a*3+k]+positions[b*3+k])/2);midpoints.set(key,mid);return mid;};
            for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3),ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}indices=next;
        }
        geometry.dispose();geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
    } else {
        const positions:number[]=[],indices:number[]=[],points:typeof body.points=[];
        const total=body.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-body.points[i][0],p[1]-body.points[i][1]),0),step=Math.max(spacing,total/1024),across=Math.max(1,Math.min(24,Math.ceil(body.width/spacing)));
        body.points.slice(1).forEach((p,i)=>{const a=body.points[i],n=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/step));for(let k=0;k<n;k++)points.push([a[0]+(p[0]-a[0])*k/n,a[1]+(p[1]-a[1])*k/n]);});points.push(body.points.at(-1)!);
        points.forEach((p,i)=>{
            const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],length=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
            const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
            for(let j=0;j<=across;j++){const offset=(j/across-.5)*body.width,x=p[0]-dz*offset,z=p[1]+dx*offset;positions.push(x,waterPath(body,x,z).level,z);}
            if(i<points.length-1)for(let j=0;j<across;j++){const k=i*(across+1)+j,b=k+across+1;indices.push(k,k+1,b,k+1,b+1,b);}
        });
        geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
    }
    const pos=geometry.getAttribute('position'),flow=new Float32Array(pos.count*2),travel=new Float32Array(pos.count);
    if(body.kind==='river')for(let i=0;i<pos.count;i++){const p=waterPath(body,pos.getX(i),pos.getZ(i));flow.set([p.dx,p.dz],i*2);travel[i]=p.along*(body.flowDirection??1);}
    geometry.setAttribute('aFlow',new T.BufferAttribute(flow,2));geometry.setAttribute('aTravel',new T.BufferAttribute(travel,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}
