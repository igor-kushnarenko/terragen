import * as T from 'three';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

const NATURAL_IDS=['pine','spruce','birch','oak','bush','rock','boulder'] as const;
export type NaturalAsset=typeof NATURAL_IDS[number];
export const isNaturalAsset=(id:string):id is NaturalAsset=>NATURAL_IDS.includes(id as NaturalAsset);
export const NATURAL_PALETTE={pine:0x4d6848,spruce:0x46604c,birch:0x78884e,oak:0x62783e,bush:0x5e7747,rock:0x827f74,boulder:0x767b71};
// Keep the dimensions of built-in trees already placed in saved projects. The crown
// is centered around the rooted trunk, which is also the origin of its collider.
const TREE_ENVELOPES:Partial<Record<NaturalAsset,readonly [number,number,number]>>={pine:[2.7,9.15,2.7],spruce:[2.4,10.35,2.4],birch:[2.7250364,8.3141003,2.7555578],oak:[2.9802318,8.1865025,3.0107529]};

// Position-based deformation keeps coincident vertices together and is independent of LOD.
function shape(x:number,y:number,z:number,seed:number){return Math.sin(x*2.1+z*1.7+seed)*Math.cos(y*2.7-x*.9+seed*.7);}
function organic(geometry:T.BufferGeometry,seed:number,stone=false){
    geometry.deleteAttribute('uv');const pos=geometry.getAttribute('position');
    for(let i=0;i<pos.count;i++){
        const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),k=1+shape(x,y,z,seed)*(stone?.17:.12);
        pos.setXYZ(i,x*k+(stone?.08:.04)*y,y*k,z*k);
    }
    const welded=mergeVertices(geometry,1e-5);geometry.dispose();welded.computeVertexNormals();return welded;
}
function shade(geometry:T.BufferGeometry,seed:number,kind:'leaf'|'bark'|'stone',birch=false){
    const p=geometry.getAttribute('position'),values=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=shape(x,y,z,seed);
        let k=kind==='leaf'?.92+.08*Math.tanh(y-5)+n*.045:kind==='stone'?.94+n*.075:.94+n*.06;
        if(birch&&kind==='bark')k*=Math.sin(y*8+x*3+z*5)>.62?.38:1;
        k=Math.min(1,Math.max(0,k));
        values.set(kind==='leaf'?[k*.99,k,k*.96]:[k,k,k],i*3);
    }
    geometry.setAttribute('color',new T.BufferAttribute(values,3));return geometry;
}

/** Authored opaque meshes: no alpha cards, extra passes or per-frame geometry work. */
export function makeNaturalModel(id:NaturalAsset,level=0){
    const root=new T.Group(),stone=id==='rock'||id==='boulder',birch=id==='birch';
    const foliage=new T.MeshStandardMaterial({name:id+' foliage',color:NATURAL_PALETTE[id],vertexColors:true,roughness:stone?.87:.96});
    const bark=new T.MeshStandardMaterial({name:id+' bark',color:birch?0xc8c5ae:0x77624b,vertexColors:true,roughness:.96});
    const leaves:T.BufferGeometry[]=[],wood:T.BufferGeometry[]=[];
    const add=(geometry:T.BufferGeometry,scale:number[],position:number[],seed:number,kind:'leaf'|'bark'|'stone')=>{
        geometry.scale(scale[0],scale[1],scale[2]).translate(position[0],position[1],position[2]);
        shade(geometry,seed,kind,birch);(kind==='bark'?wood:leaves).push(geometry);
    };
    function trunk(height:number,radius:number,sides:number,segments=1){
        const g=new T.CylinderGeometry(radius*.36,radius,height,sides,segments),p=g.getAttribute('position');
        for(let i=0;i<p.count;i++){const y=p.getY(i)+height/2,t=y/height;p.setXYZ(i,p.getX(i)+t*t*.17,y,p.getZ(i)-t*t*.09);}
        add(g,[1,1,1],[0,0,0],3,'bark');
    }
    function branch(from:number[],to:number[],radius:number){
        const a=new T.Vector3(...from),b=new T.Vector3(...to),direction=b.clone().sub(a),g=new T.CylinderGeometry(radius*.45,radius,direction.length(),3,1,true);
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize())).translate(...a.add(b).multiplyScalar(.5).toArray());
        add(g,[1,1,1],[0,0,0],4,'bark');
    }
    function crown(center:number[],scale:number[],seed:number){
        const g=organic(level===0?new T.IcosahedronGeometry(1,0):new T.OctahedronGeometry(1,0),seed);
        add(g,scale,center,seed,'leaf');
    }
    if(stone){
        const r=id==='boulder'?2:1,g=organic(new T.IcosahedronGeometry(1,level===0?1:0),id==='boulder'?8:5,true),p=g.getAttribute('position');
        for(let i=0;i<p.count;i++)p.setY(i,Math.max(-.72,p.getY(i)));
        g.computeVertexNormals();add(g,[r*1.3,r*.72,r],[0,0,0],5,'stone');
    }else if(id==='spruce'){
        const height=10.35,sides=level===0?6:level===1?4:5;
        const rings=level===0?[[.16,.65],[.26,1],[.34,.70],[.46,.81],[.55,.49],[.67,.56],[.79,.28],[.90,.17]]:level===1?[[.16,.65],[.28,1],[.58,.65],[.84,.27]]:[[.18,.7],[.32,1]];
        const vertices:number[]=[],indices:number[]=[],phase=.31;
        rings.forEach(([y,r],j)=>{for(let i=0;i<sides;i++){
            const a=i/sides*Math.PI*2+phase,k=1+.13*Math.sin(a*3+.5)+.07*Math.cos(a*2+1.1);
            vertices.push(Math.cos(a)*r*2.4*k+y*.13,y*height+.12*r*Math.sin(a*2+j*.2),Math.sin(a)*r*2.4*k);
        }});
        for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;indices.push(a,c,b,b,c,d);}
        const top=vertices.length/3;vertices.push(.15,height,-.08);const bottom=vertices.length/3;vertices.push(0,rings[0][0]*height,0);
        for(let i=0;i<sides;i++){indices.push((rings.length-1)*sides+i,top,(rings.length-1)*sides+(i+1)%sides);indices.push(i,(i+1)%sides,bottom);}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
        add(g,[1,1,1],[0,0,0],1,'leaf');trunk(6,.30,level===0?6:3);
    }else if(id==='pine'){
        trunk(7.2,.30,level===0?5:3);
        const centers=[[-1.05,6.3,.1],[1.0,6.9,.05],[-.45,7.8,-.6],[.5,8.1,.65]];
        const scales=[[1.6,1.05,1.5],[1.7,1.15,1.65],[1.55,1.35,1.45],[1.45,1.05,1.5]];
        const selected=level===2?[0,2]:[0,1,2,3];
        for(const i of selected)crown(centers[i],level===2?[2.4,1.6,2.1]:scales[i],i+2);
        if(level===0){branch([.1,4.5,0],centers[0],.11);branch([.1,5.1,0],centers[1],.1);}
    }else if(id==='birch'||id==='oak'){
        const oak=id==='oak';trunk(oak?6.2:7.5,oak?.34:.24,level===0?(oak?8:6):3,level===0?(oak?2:5):1);
        const count=level===0?(oak?8:9):level===1?6:3;
        for(let i=0;i<count;i++){
            const a=i*2.39996,r=Math.sqrt((i+.4)/count)*(oak?2.0:1.65),y=(oak?5.4:6.1)+Math.sin(i*1.3)*(oak?1.25:1.6);
            const center=[Math.cos(a)*r,y,Math.sin(a)*r],s=level===2?1.85:oak?1.65:1.3;
            crown(center,[s,oak?s*.78:s*1.12,s*.95],i+5);
            if(level===0&&i%2===0)branch([.1,y-2.4,0],center,oak?.13:.065);
        }
    }else{
        for(let i=0;i<(level===0?7:1);i++){
            const a=i*2.4,g=organic(new T.IcosahedronGeometry(1,level===0?1:0),i+11);
            add(g,level===0?[.65,.52,.65]:[1.15,.78,1.1],level===0?[Math.cos(a)*.55,.5+i%3*.13,Math.sin(a)*.55]:[0,.65,0],i+11,'leaf');
        }
    }
    const envelope=TREE_ENVELOPES[id];
    if(envelope){
        const bounds=new T.Box3();for(const geometry of leaves){geometry.computeBoundingBox();bounds.union(geometry.boundingBox!);}
        const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
        for(const geometry of leaves)geometry.translate(-center.x,0,-center.z).scale(envelope[0]*2/size.x,envelope[1]/bounds.max.y,envelope[2]*2/size.z);
    }
    for(const [geometries,material]of [[wood,bark],[leaves,foliage]] as const){
        if(!geometries.length){material.dispose();continue;}
        const expanded=geometries.map(g=>g.index?g.toNonIndexed():g),merged=mergeGeometries(expanded);
        if(!merged)throw new Error('Несовместимая геометрия растения');
        new Set([...geometries,...expanded]).forEach(g=>g.dispose());root.add(new T.Mesh(merged,material));
    }
    return root;
}
