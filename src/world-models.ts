import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {JUNGLE_PLANTS,isJunglePlant,makeJunglePlant} from './jungle-models';

export const WORLD_PLANTS={
    ...JUNGLE_PLANTS,
    palm:{name:'Кокосовая пальма',category:'tree',collider:'trunk'},
    'jungle-palm':{name:'Тропическая пальма',category:'tree',collider:'trunk'},
    kapok:{name:'Капок',category:'tree',collider:'trunk'},larch:{name:'Лиственница',category:'tree',collider:'trunk'},
    'wind-pine':{name:'Ветровая сосна',category:'tree',collider:'trunk'},
    'mountain-birch':{name:'Горная берёза',category:'tree',collider:'trunk'},juniper:{name:'Можжевельник',category:'shrub',collider:'none'},
    cactus:{name:'Кактус',category:'tree',collider:'convex'},saxaul:{name:'Саксаул',category:'tree',collider:'trunk'},
    heather:{name:'Вереск',category:'shrub',collider:'none'},'dry-bush':{name:'Сухой кустарник',category:'shrub',collider:'none'},
    'coastal-bush':{name:'Прибрежный кустарник',category:'shrub',collider:'none'},'tropical-bush':{name:'Тропический кустарник',category:'shrub',collider:'none'},
} as const;
export type WorldPlantId=keyof typeof WORLD_PLANTS;
export const isWorldPlant=(id:string):id is WorldPlantId=>Object.hasOwn(WORLD_PLANTS,id);

/** Local opaque species, two merged parts at most; all three LODs keep their silhouette. */
export function makeWorldPlant(id:WorldPlantId,level=0){
    if(isJunglePlant(id))return makeJunglePlant(id,level);
    const root=new T.Group(),wood:T.BufferGeometry[]=[],leaves:T.BufferGeometry[]=[],sides=level===0?7:4;
    const color=id==='heather'?0x827087:id==='cactus'?0x82955c:id==='saxaul'||id==='dry-bush'?0x9b9665:id==='larch'?0x698f55:id==='mountain-birch'?0x8d9c65:id==='wind-pine'||id==='juniper'?0x4e6b61:0x467f4a;
    function branch(a:number[],b:number[],radius:number,leaf=false){
        const from=new T.Vector3(...a),to=new T.Vector3(...b),delta=to.clone().sub(from);
        const g=new T.CylinderGeometry(radius*.55,radius,delta.length(),sides,1,false);
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize())).translate(...from.add(to).multiplyScalar(.5).toArray());(leaf?leaves:wood).push(g);
    }
    function crown(x:number,y:number,z:number,sx:number,sy:number,sz:number){const g=level===0?new T.IcosahedronGeometry(1,0):new T.OctahedronGeometry(1,0);g.scale(sx,sy,sz).translate(x,y,z);leaves.push(g);}
    const palm=id==='palm'||id==='jungle-palm';
    if(palm){
        const height=id==='palm'?8:11;branch([0,0,0],[0,height*.35,0],.26);branch([0,height*.35,0],[.65,height,0],.22);
        const count=level===2?5:level===1?7:10;
        for(let i=0;i<count;i++){
            const a=i/count*Math.PI*2,r=id==='palm'?4.1:3.3,verts:number[]=[],indices:number[]=[];
            const steps=level===0?4:2;
            for(let j=0;j<=steps;j++){const t=j/steps,d=t*r,y=height+Math.sin(t*Math.PI)*.85-t*t*1.6,w=Math.sin(t*Math.PI)*.48;
                for(const sign of [-1,1])verts.push(.65+Math.cos(a)*d+Math.sin(a)*w*sign,y,Math.sin(a)*d-Math.cos(a)*w*sign);}
            for(let j=0;j<steps;j++){const k=j*2;indices.push(k,k+1,k+2,k+1,k+3,k+2,k+2,k+1,k,k+2,k+3,k+1);}
            const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();leaves.push(g);
        }
    }else if(id==='cactus'){
        branch([0,0,0],[0,4.5,0],.42,true);for(const sign of [-1,1]){branch([0,2,0],[sign*1.2,2,0],.25,true);branch([sign*1.2,2,0],[sign*1.2,3.1+sign*.3,0],.24,true);}
    }else if(id==='larch'){
        branch([0,0,0],[0,11,0],.3);const count=level===0?7:level===1?4:3;
        for(let i=0;i<count;i++){const t=i/(count-1),g=new T.ConeGeometry(2.4*(1-t*.85),2.9*(1-t*.4),sides,1);g.translate(0,3+t*7,0);leaves.push(g);}
    }else if(id==='kapok'){
        branch([0,0,0],[0,13,0],.65);const count=level===0?9:level===1?5:3;
        for(let i=0;i<count;i++){const a=i*2.4,r=1.8+(i%3)*.7,x=Math.cos(a)*r,z=Math.sin(a)*r,y=11+(i%3)*1.4;branch([0,7,0],[x,y,z],.17);crown(x,y,z,2.5,1.9,2.4);}
        if(level===0)for(let i=0;i<5;i++){const a=i*1.257;branch([0,1.8,0],[Math.cos(a)*1.6,.2,Math.sin(a)*1.6],.24);}
    }else if(id==='wind-pine'||id==='mountain-birch'||id==='saxaul'){
        const height=id==='saxaul'?3.8:id==='wind-pine'?6.4:5.5;branch([0,0,0],[0,height*.45,0],id==='wind-pine'?.29:.18);
        branch([0,height*.45,0],[id==='wind-pine'?1.6:.4,height,0],.16);
        const count=level===0?7:level===1?4:2;
        for(let i=0;i<count;i++){const a=i*2.4,x=Math.cos(a)*1.3+(id==='wind-pine'?1.3:0),z=Math.sin(a)*1.2,y=height-.6+(i%3)*.45;
            if(level===0)branch([0,height*.6,0],[x,y,z],.07);crown(x,y,z,id==='saxaul'?.65:1.45,.6,1.05);}
    }else{
        const large=id==='tropical-bush',count=level===0?6:level===1?3:1;
        for(let i=0;i<count;i++){const a=i*2.4;crown(Math.cos(a)*.55,(large?1.1:.45)+(i%2)*.16,Math.sin(a)*.55,large?1.2:.65,large?.9:.48,large?1:.65);}
    }
    for(const [parts,tint]of [[wood,id==='mountain-birch'?0xbcb8a5:0x82745c],[leaves,color]] as const){
        if(!parts.length)continue;const expanded=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(expanded);if(!g)throw new Error('Ошибка геометрии растения');
        new Set([...parts,...expanded]).forEach(p=>p.dispose());root.add(new T.Mesh(g,new T.MeshStandardMaterial({color:tint,roughness:.94})));
    }
    return root;
}
