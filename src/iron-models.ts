import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from './noise';

export const IRON_PLANTS={
    'iron-grass':{name:'Прибрежная овсяница',category:'shrub',collider:'none'},
    'iron-sedge':{name:'Прибрежная осока',category:'shrub',collider:'none'},
    'iron-heather':{name:'Низкий морской вереск',category:'shrub',collider:'none'},
    'iron-crowberry':{name:'Водяника',category:'shrub',collider:'none'},
    'iron-cushion':{name:'Подушковидное растение',category:'shrub',collider:'none'},
    'iron-moss':{name:'Прибрежный мох',category:'shrub',collider:'none'},
    'iron-lichen':{name:'Скальный лишайник',category:'shrub',collider:'none'},
    'iron-thrift':{name:'Армерия приморская',category:'shrub',collider:'none'},
} as const;
export const IRON_ROCKS={
    'iron-stack':{name:'Морской скальный столб',category:'rock',collider:'convex'},
    'iron-cliff':{name:'Слоистая прибрежная скала',category:'rock',collider:'convex'},
    'iron-boulder':{name:'Тёмный прибрежный валун',category:'rock',collider:'convex'},
    'iron-debris':{name:'Скальная осыпь',category:'rock',collider:'convex'},
} as const;
export const isIronPlant=(id:string):id is keyof typeof IRON_PLANTS=>Object.hasOwn(IRON_PLANTS,id);
export const isIronRock=(id:string):id is keyof typeof IRON_ROCKS=>Object.hasOwn(IRON_ROCKS,id);
/** Shared opaque, vertex-coloured models, one draw part and three real LODs. */
export function makeIronModel(id:keyof typeof IRON_PLANTS|keyof typeof IRON_ROCKS,level=0){
    const root=new T.Group(),parts:T.BufferGeometry[]=[],random=mulberry32(3129+id.length*17),stone=isIronRock(id);
    const color=stone?0x65717b:id==='iron-heather'?0x727363:id==='iron-lichen'?0x9c9e8d:id==='iron-thrift'?0xb597a0:id==='iron-moss'?0x636d48:0x777d57;
    function add(g:T.BufferGeometry,x=0,y=0,z=0){g.translate(x,y,z);parts.push(g);}
    if(stone){
        const stack=id==='iron-stack',cliff=id==='iron-cliff',debris=id==='iron-debris';
        const count=debris?(level===0?7:level===1?4:2):1;
        for(let k=0;k<count;k++){
            const g=new T.CylinderGeometry(stack?.65:1,stack?1.8:1.5,stack?13:cliff?7:debris?.6:2,level===0?9:level===1?6:4,level===0?6:level===1?3:1),p=g.attributes.position;
            for(let i=0;i<p.count;i++){
                const x=p.getX(i),y=p.getY(i),z=p.getZ(i),strata=1+.10*Math.sin(y*2.1)+.07*Math.cos(y*4.3),warp=1+.11*Math.sin(x*4+z*3+y*.7);
                p.setXYZ(i,x*strata*warp+(stack?y*.05:0),y+.12*Math.sin(x*3+z*2),z*warp*(cliff?.65:1));
            }
            g.computeVertexNormals();add(g,debris?(random()-.5)*3:0,(stack?6.2:cliff?3.3:debris?.2:.8),debris?(random()-.5)*3:0);
        }
    }else if(id==='iron-grass'||id==='iron-sedge'||id==='iron-thrift'){
        const count=level===0?19:level===1?10:5,flower=id==='iron-thrift',sedge=id==='iron-sedge';
        for(let i=0;i<count;i++){
            const a=random()*Math.PI*2,r=random()*.4,x=Math.cos(a)*r,z=Math.sin(a)*r,h=(sedge?.7:flower?.3:.42)*(.5+random()*.6),bend=.15+random()*.23,w=flower?.008:.018;
            const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([x-w,0,z,x+w,0,z,x+bend+w,h*.55,z+.04,x+bend-w,h*.55,z+.04,x+bend*1.4,h,z+.08],3));g.setIndex([0,1,2,0,2,3,3,2,4]);g.computeVertexNormals();parts.push(g);
            if(flower){const head=new T.IcosahedronGeometry(.045,0);add(head,x+bend*1.4,h,z+.08);}
        }
    }else{
        const flat=id==='iron-moss'||id==='iron-lichen',cushion=id==='iron-cushion',count=level===0?13:level===1?7:3;
        for(let i=0;i<count;i++){
            const a=random()*Math.PI*2,r=Math.sqrt(random())*.55,rx=.16+random()*.15,ry=flat?.015+random()*.025:cushion?.08+random()*.05:.12+random()*.17;
            const g=level===0?new T.IcosahedronGeometry(1,0):new T.OctahedronGeometry(1,0);g.scale(rx,ry,rx*.8);add(g,Math.cos(a)*r+ry*.25,ry,Math.sin(a)*r);
        }
    }
    for(const g of parts)g.deleteAttribute('uv');
    const expanded=parts.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(expanded)!;
    new Set([...parts,...expanded]).forEach(g=>g.dispose());
    const p=geometry.attributes.position,colors=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
        const shade=.85+.12*Math.sin(p.getY(i)*(stone?2.3:9)+p.getX(i)*7+p.getZ(i)*4);
        colors.set([shade*.97,shade,Math.min(1,shade*(stone?1.05:.93))],i*3);
    }
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.computeVertexNormals();
    root.add(new T.Mesh(geometry,new T.MeshStandardMaterial({color,vertexColors:true,roughness:stone?.82:.96,side:stone?T.FrontSide:T.DoubleSide})));return root;
}
