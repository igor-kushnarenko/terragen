import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from './noise';

export const JUNGLE_PLANTS = {
    'jungle-emergent':{name:'Тропический гигант',category:'tree',collider:'trunk'},
    'jungle-emergent-vines':{name:'Тропический гигант с лианами',category:'tree',collider:'trunk'},
    'jungle-canopy':{name:'Дерево тропического полога',category:'tree',collider:'trunk'},
    'jungle-canopy-vines':{name:'Дерево полога с лианами',category:'tree',collider:'trunk'},
    'jungle-canopy-b':{name:'Широколистное дерево полога',category:'tree',collider:'trunk'},
    'jungle-canopy-b-vines':{name:'Широколистное дерево с лианами',category:'tree',collider:'trunk'},
    'jungle-sapling':{name:'Молодое тропическое дерево',category:'tree',collider:'trunk'},
    'jungle-banana':{name:'Банановые заросли',category:'shrub',collider:'none'},
    'jungle-tree-fern':{name:'Древовидный папоротник',category:'shrub',collider:'none'},
    'jungle-broadleaf':{name:'Крупнолистный подлесок',category:'shrub',collider:'none'},
    'jungle-log':{name:'Гниющий тропический ствол',category:'wood',collider:'convex'},
    'jungle-rock':{name:'Влажный валун со мхом',category:'rock',collider:'convex'},
} as const;
export type JunglePlantId=keyof typeof JUNGLE_PLANTS;
export const isJunglePlant=(id:string):id is JunglePlantId=>Object.hasOwn(JUNGLE_PLANTS,id);
export const isJungleCanopy=(id:string)=>id.startsWith('jungle-canopy')||id.startsWith('jungle-emergent');
export const jungleTreeHeight=(id:JunglePlantId)=>id.startsWith('jungle-emergent')?45:id.startsWith('jungle-canopy-b')?23:id.startsWith('jungle-canopy')?27:11;

/** Branch endpoints are also the attachment points. All decorations share the host instance transform. */
export function jungleBranches(id:JunglePlantId,level=0) {
    const emergent=id.startsWith('jungle-emergent'),broadleaf=id.startsWith('jungle-canopy-b'),height=jungleTreeHeight(id),count=level===2?3:level===1?5:8;
    return Array.from({length:count},(_,i)=>{
        const a=i*2.39996+(emergent?.5:broadleaf?1.1:0),r=(emergent?5.7:broadleaf?3.8:4.4)+(i%3)*(emergent?1.45:broadleaf?.9:1.15);
        return {start:[.35,height*.57,0] as [number,number,number],end:[Math.cos(a)*r,height*(.76+(i%3)*.066),Math.sin(a)*r] as [number,number,number]};
    });
}
export function jungleVines(id:JunglePlantId,level=0) {
    if(!id.endsWith('-vines')||level===2)return [];
    const height=jungleTreeHeight(id);
    return jungleBranches(id,level).filter((_,i)=>i%2===0).map((b,i)=>{
        const a=b.end,length=height*(.2+(i%3)*.075),points:[number,number,number][]=[];
        for(let k=0;k<=6;k++){const t=k/6;points.push([a[0]+Math.sin(t*Math.PI*1.4+i)*t*.65,a[1]-length*t,a[2]+Math.sin(t*Math.PI)*.55]);}
        return {anchor:[...a] as [number,number,number],points,radius:.045+(i%2)*.018};
    });
}
/** Opaque, vertex-coloured geometry, merged into at most two parts at every LOD. */
export function makeJunglePlant(id:JunglePlantId,level=0) {
    const root=new T.Group(),wood:T.BufferGeometry[]=[],leaves:T.BufferGeometry[]=[],random=mulberry32(731+(id.length*19)),sides=level===0?7:level===1?5:4;
    function add(geometry:T.BufferGeometry,leaf:boolean,color:number,organic=false) {
        let g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();g.deleteAttribute('uv');
        const p=g.getAttribute('position'),rgb=new T.Color(color),colors:number[]=[];
        for(let i=0;i<p.count;i++) {
            const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
            if(organic){const amount=1+.10*Math.sin(x*1.7+z*.9)+.06*Math.cos(y*2.1-z);p.setXYZ(i,x*amount,y*(1+.04*Math.sin(x*2-z)),z*amount);}
            const tone=.86+.15*(.5+.5*Math.sin(Math.floor(i/3)*3.7+x*.8+z*.3));
            const moss=!leaf&&y<3.8?Math.max(0,.55-y*.12)*(.5+.5*Math.sin(x*3+z*2)):0;
            const c=rgb.clone().multiplyScalar(tone).lerp(new T.Color(0x526a32),moss);colors.push(c.r,c.g,c.b);
        }
        g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();(leaf?leaves:wood).push(g);
    }
    function branch(a:number[],b:number[],radius:number,color=0x76684b,leaf=false) {
        const from=new T.Vector3(...a),to=new T.Vector3(...b),delta=to.clone().sub(from),g=new T.CylinderGeometry(radius*.56,radius,delta.length(),sides,1,true);
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize())).translate(...from.add(to).multiplyScalar(.5).toArray());add(g,leaf,color);
    }
    function crown(x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number) {
        const g=level===0?new T.IcosahedronGeometry(1,1):level===1?new T.IcosahedronGeometry(1,0):new T.OctahedronGeometry(1,0);
        g.scale(sx,sy,sz).translate(x,y,z);add(g,true,color,true);
    }
    function blade(base:number[],angle:number,length:number,width:number,rise:number,color:number) {
        const steps=level===0?6:3,verts:number[]=[],indices:number[]=[];
        for(let i=0;i<=steps;i++) {
            const t=i/steps,r=length*t,w=Math.sin(Math.PI*t)**.7*width,y=base[1]+Math.sin(t*Math.PI)*rise-t*t*rise*.5;
            verts.push(base[0]+Math.cos(angle)*r-Math.sin(angle)*w,y,base[2]+Math.sin(angle)*r+Math.cos(angle)*w,
                base[0]+Math.cos(angle)*r,y+.10*Math.sin(t*Math.PI),base[2]+Math.sin(angle)*r,
                base[0]+Math.cos(angle)*r+Math.sin(angle)*w,y-.04,base[2]+Math.sin(angle)*r-Math.cos(angle)*w);
        }
        for(let i=0;i<steps;i++){const k=i*3;indices.push(k,k+3,k+1,k+1,k+3,k+4,k+1,k+4,k+2,k+2,k+4,k+5);}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);add(g,true,color);
    }
    const tall=isJungleCanopy(id);
    if(tall||id==='jungle-sapling') {
        const h=jungleTreeHeight(id),emergent=id.startsWith('jungle-emergent'),broadleaf=id.startsWith('jungle-canopy-b'),radius=emergent?1.05:tall?.55:.2;
        branch([0,0,0],[.2,h*.4,-.15],radius);branch([.2,h*.4,-.15],[.35,h*.8,0],radius*.65);
        if(tall) {
            const count=level===2?4:6;
            for(let i=0;i<count;i++){
                const a=i/count*Math.PI*2,r=emergent?3.4:1.9,y=emergent?4.5:2.4,v=[0,y,0,Math.cos(a)*r,.08,Math.sin(a)*r,Math.cos(a+.14)*.7,0,Math.sin(a+.14)*.7];
                const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([...v,...v.slice(6),...v.slice(3,6),...v.slice(0,3)],3));add(g,false,0x6d6546);
            }
            for(const [i,b]of jungleBranches(id,level).entries()){
                branch(b.start,b.end,emergent?.34:.23);
                crown(...b.end,emergent?5.8:broadleaf?5.2:5.9,broadleaf?4:3.5,emergent?5.0:broadleaf?4.7:5.7,[0x496839,0x5b7741,0x3d6037,0x70834c][i%4]);
                if(level===0&&i%3===0){
                    const epiphyte=[b.end[0]*.8,b.end[1]-.3,b.end[2]*.8];
                    for(let k=0;k<4;k++)blade(epiphyte,k*1.6,1.1,.18,.35,0x527c42);
                    for(let k=0;k<5;k++)blade([epiphyte[0],epiphyte[1]+.25,epiphyte[2]],k*1.257,.22,.09,.12,0xbaa0b9);
                }
            }
            for(const vine of jungleVines(id,level))for(let i=1;i<vine.points.length;i++)branch(vine.points[i-1],vine.points[i],vine.radius,0x566d35,true);
            // A climbing vine wraps the trunk; its endpoints remain on the host bark.
            if(id.endsWith('-vines')&&level===0)for(let i=1;i<=22;i++){
                const t=i/22,prev=(i-1)/22,a=t*Math.PI*7,b=prev*Math.PI*7;
                branch([Math.cos(b)*radius*.94,1+prev*h*.5,Math.sin(b)*radius*.94],[Math.cos(a)*radius*.94,1+t*h*.5,Math.sin(a)*radius*.94],.055,0x4b6938,true);
            }
        } else {
            for(let i=0;i<(level===2?2:4);i++){const a=i*2.4;branch([0,5,0],[Math.cos(a)*1.6,8+i*.5,Math.sin(a)*1.4],.08);crown(Math.cos(a)*1.5,8+i*.5,Math.sin(a)*1.4,2.2,1.3,2,0x668b43);}
        }
    } else if(id==='jungle-log') {
        branch([-3,.6,-.3],[3,.45,.4],.55,0x665339);if(level<2){branch([.7,.7,.1],[1.4,1.5,-.6],.16,0x756047);crown(-.9,.87,0,1.8,.15,.5,0x57723b);}
    } else if(id==='jungle-rock') {
        const g=new T.IcosahedronGeometry(1,level===0?1:0);g.scale(2,1.3,1.6).translate(0,.5,0);add(g,false,0x73776a,true);
        crown(-.3,1.2,.15,1.55,.25,1.1,0x546e36);
    } else {
        const banana=id==='jungle-banana',fern=id==='jungle-tree-fern',h=banana?3.4:fern?2.7:.6;
        if(banana||fern)branch([0,0,0],[.15,h,0],fern?.14:.19,fern?0x64583d:0x71834b);
        const count=level===2?5:level===1?7:banana?10:fern?9:8;
        for(let i=0;i<count;i++){
            const a=i*2.39996,length=(banana?2.8:fern?2.3:1.7)*(1+random()*.25);
            if(fern&&level===0){
                for(let k=1;k<=5;k++){const t=k/6,r=length*t;for(const sign of [-1,1])blade([Math.cos(a)*r,h+Math.sin(t*Math.PI)*.5,Math.sin(a)*r],a+sign*1.0,.55*(1-t)+.12,.08,.18,0x4e7d3c);}
            }else blade([.15,h+(i%3)*.25,0],a,length,banana?.55:.38,banana?.95:.65,[0x4d783b,0x658c43,0x3d6939][i%3]);
        }
    }
    for(const [parts,leaf]of [[wood,false],[leaves,true]] as const){
        if(!parts.length)continue;const merged=mergeGeometries([...parts]);parts.forEach(g=>g.dispose());if(!merged)throw new Error('Не удалось собрать тропическую модель');
        root.add(new T.Mesh(merged,new T.MeshStandardMaterial({vertexColors:true,roughness:leaf?.91:.85,side:leaf?T.DoubleSide:T.FrontSide})));
    }
    return root;
}
