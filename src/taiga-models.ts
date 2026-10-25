import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from './noise';

export const TAIGA_PLANTS={
    'taiga-spruce':{name:'Ель обыкновенная · Picea abies',category:'tree',collider:'trunk'},
    'taiga-siberian-spruce':{name:'Ель сибирская · Picea obovata',category:'tree',collider:'trunk'},
    'taiga-pine':{name:'Сосна обыкновенная · Pinus sylvestris',category:'tree',collider:'trunk'},
    'taiga-fir':{name:'Пихта сибирская · Abies sibirica',category:'tree',collider:'trunk'},
    'taiga-larch':{name:'Лиственница сибирская · Larix sibirica',category:'tree',collider:'trunk'},
    'taiga-cedar':{name:'Кедровая сосна · Pinus sibirica',category:'tree',collider:'trunk'},
    'taiga-birch':{name:'Берёза бореальная',category:'tree',collider:'trunk'},
    'taiga-aspen':{name:'Осина',category:'tree',collider:'trunk'},
    'taiga-rowan':{name:'Рябина',category:'tree',collider:'trunk'},
    'taiga-young-spruce':{name:'Молодая ель',category:'tree',collider:'trunk'},
    'taiga-young-pine':{name:'Молодая сосна',category:'tree',collider:'trunk'},
    'taiga-dead-tree':{name:'Сухостой со сломанной вершиной',category:'tree',collider:'trunk'},
    'taiga-log':{name:'Поваленный гниющий ствол',category:'wood',collider:'convex'},
    'taiga-stump':{name:'Трухлявый пень',category:'wood',collider:'convex'},
    'taiga-roots':{name:'Выступающие лесные корни',category:'wood',collider:'none'},
    'taiga-boulder':{name:'Ледниковый валун со мхом и лишайником',category:'rock',collider:'convex'},
    'taiga-blueberry':{name:'Черника',category:'shrub',collider:'none'},
    'taiga-lingonberry':{name:'Брусника',category:'shrub',collider:'none'},
    'taiga-bilberry':{name:'Голубика',category:'shrub',collider:'none'},
    'taiga-bog-shrub':{name:'Багульник болотный',category:'shrub',collider:'none'},
    'taiga-juniper':{name:'Можжевельник',category:'shrub',collider:'none'},
} as const;
export type TaigaPlantId=keyof typeof TAIGA_PLANTS;
export const isTaigaPlant=(id:string):id is TaigaPlantId=>Object.hasOwn(TAIGA_PLANTS,id);
export const taigaTreeHeight=(id:string)=>id==='taiga-pine'?30:id==='taiga-larch'?28:id==='taiga-cedar'?26:id==='taiga-fir'?29:id==='taiga-siberian-spruce'?25:id==='taiga-spruce'?28:id==='taiga-birch'?19:id==='taiga-aspen'?23:id==='taiga-rowan'?8:id.startsWith('taiga-young')?9:18;
const decorated=new WeakSet<T.Material>();
const seasonalDepths=new WeakMap<T.MeshDepthMaterial,Map<boolean,T.MeshDepthMaterial>>();
export function taigaLeafDepth(source:T.MeshDepthMaterial,mixed=false){
    const variants=seasonalDepths.get(source)??new Map<boolean,T.MeshDepthMaterial>();
    let material=variants.get(mixed);if(material)return material;
    material=source.clone();material.side=T.DoubleSide;
    material.onBeforeCompile=(shader,renderer)=>{
        source.onBeforeCompile(shader,renderer);
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vTaigaSeason;varying float vTaigaLeaf;'+(mixed?'attribute float aTaigaLeaf;':''))
            .replace('#include <begin_vertex>',`#include <begin_vertex>
vTaigaSeason=0.0;vTaigaLeaf=${mixed?'aTaigaLeaf':'1.0'};
#ifdef USE_INSTANCING_COLOR
vTaigaSeason=instanceColor.b;
#endif`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vTaigaSeason;varying float vTaigaLeaf;')
            .replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(vTaigaSeason>1.5&&vTaigaLeaf>.5)discard;');
    };
    material.customProgramCacheKey=()=>source.customProgramCacheKey()+'/taiga-leafless/'+mixed;variants.set(mixed,material);seasonalDepths.set(source,variants);return material;
}

/** Per-instance seasons keep shared geometry and draw calls. Restored GLBs use the same hook. */
export function decorateTaigaMaterial(material:T.Material|T.Material[]){
    if(Array.isArray(material)){material.forEach(decorateTaigaMaterial);return;}
    if(decorated.has(material))return;decorated.add(material);
    const leaf=material.name==='taiga-needles'||material.name==='taiga-deciduous',mixed=material.name==='taiga-mixed-deciduous',deciduous=material.name==='taiga-deciduous'||mixed;
    material.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec2 vTaigaClimate;varying float vTaigaUp;varying vec3 vTaigaLocal;varying float vTaigaLeaf;
${mixed?'attribute float aTaigaLeaf;':''}`)
            .replace('#include <color_vertex>',`#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
vColor.rgb=vec3(instanceColor.r);
#ifdef USE_COLOR
vColor.rgb*=color;
#endif
#endif`)
            .replace('#include <fog_vertex>',`#include <fog_vertex>
vTaigaClimate=vec2(0.0);vTaigaLocal=position;vTaigaLeaf=${mixed?'aTaigaLeaf':'1.0'};
#ifdef USE_INSTANCING_COLOR
vTaigaClimate=instanceColor.gb;
#endif
vTaigaUp=objectNormal.y;`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vTaigaClimate;varying float vTaigaUp;varying vec3 vTaigaLocal;varying float vTaigaLeaf;')
            .replace('#include <color_fragment>',`#include <color_fragment>
${deciduous?'if(vTaigaClimate.y>1.5&&vTaigaLeaf>.5)discard; diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(2.5,1.4,.35),smoothstep(.5,1.0,vTaigaClimate.y)*vTaigaLeaf);':''}
float snowFacing=smoothstep(${leaf?'-.15,.7':' .1,.85'},vTaigaUp);
float snowPatch=.72+.28*sin(dot(vTaigaLocal,vec3(9.1,11.7,7.3)));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.78,.85,.9),vTaigaClimate.x*snowFacing*snowPatch);`)
            .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
reflectedLight.indirectSpecular*=.15;
reflectedLight.indirectDiffuse*=vec3(1.0,.98,.70);`);
    };
    material.customProgramCacheKey=()=>`taiga-season-v1/${material.name}`;
}

/** Branch-built crowns and needle sprays, no solid cones; two opaque merged parts per LOD. */
export function makeTaigaPlant(id:TaigaPlantId,level=0){
    const root=new T.Group(),wood:T.BufferGeometry[]=[],foliage:T.BufferGeometry[]=[],seed=[...id].reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0),17),random=mulberry32(seed);
    const sides=level===0?7:level===1?5:4,deciduous=['taiga-birch','taiga-aspen','taiga-rowan','taiga-larch'].includes(id);
    function add(g:T.BufferGeometry,leaf:boolean,color:number){
        if(g.index){const old=g;g=g.toNonIndexed();old.dispose();}g.deleteAttribute('uv');
        const p=g.attributes.position,c=new T.Color(color),colors:number[]=[];
        for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),tone=.80+.25*(.5+.5*Math.sin(x*3.7+y*1.9+z*4.3));
            const tint=c.clone().multiplyScalar(tone);if(!leaf&&y<1.5)tint.lerp(new T.Color(0x586446),(.5+.5*Math.sin(x*9+z*7))*.27);
            colors.push(tint.r,tint.g,tint.b);}
        g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();(leaf?foliage:wood).push(g);
    }
    function branch(a:number[],b:number[],r:number,color=0x71614d,taper=.42){
        const from=new T.Vector3(...a),to=new T.Vector3(...b),delta=to.clone().sub(from),g=new T.CylinderGeometry(r*taper,r,delta.length(),sides,1,false);
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize())).translate(...from.add(to).multiplyScalar(.5).toArray());add(g,false,color);
    }
    function leafPatch(x:number,y:number,z:number,a:number,r:number,color:number){
        const verts:number[]=[],steps=level===0?7:5;
        for(let i=0;i<steps;i++){const b=i/steps*Math.PI*2,c=(i+1)/steps*Math.PI*2;
            const point=(t:number)=>[x+Math.cos(t)*r*Math.cos(a)-Math.sin(t)*r*.55*Math.sin(a),y-.15*r+Math.sin(t*3+a)*r*.16,z+Math.cos(t)*r*Math.sin(a)+Math.sin(t)*r*.55*Math.cos(a)];
            verts.push(x,y+r*.2,z,...point(b),...point(c));}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));add(g,true,color);
    }
    function spray(x:number,y:number,z:number,a:number,length:number,width:number,color:number){
        const verts:number[]=[],count=level===0?4:level===1?3:2;
        for(let k=0;k<count;k++){
            const t=k/count,px=x+Math.cos(a)*length*t,pz=z+Math.sin(a)*length*t,py=y+Math.sin(t*Math.PI)*length*.1;
            for(const side of [-1,1]){const b=a+side*(.7+(1-t)*.35),r=width*(1-t*.65);
                verts.push(px,py+.045,pz,px+Math.cos(b)*r,py-.09,pz+Math.sin(b)*r,px+Math.cos(a)*length/count*1.5,py+.04,pz+Math.sin(a)*length/count*1.5);}
        }
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));add(g,true,color);
    }
    function bough(base:number[],end:number[],width:number,color:number){
        const verts:number[]=[],indices:number[]=[],spokes=level===0?7:level===1?5:4;
        const axis=new T.Vector3(...end).sub(new T.Vector3(...base)),side=new T.Vector3(-axis.z,0,axis.x).normalize(),up=new T.Vector3().crossVectors(axis,side).normalize();
        for(let j=0;j<4;j++){
            const t=[0,.32,.7,1][j],r=[.07,1,.74,.025][j];
            for(let k=0;k<spokes;k++){
                const a=k/spokes*Math.PI*2,w=width*r*(.8+random()*.4),p=new T.Vector3(...base).addScaledVector(axis,t).addScaledVector(side,Math.cos(a)*w).addScaledVector(up,Math.sin(a)*w*.55);
                p.y-=Math.sin(t*Math.PI)*width*.18;verts.push(...p.toArray());
            }
        }
        for(let j=0;j<3;j++)for(let k=0;k<spokes;k++){const a=j*spokes+k,b=j*spokes+(k+1)%spokes,c=a+spokes,d=b+spokes;indices.push(a,b,c,b,d,c);}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);add(g,true,color);
    }
    const tree=TAIGA_PLANTS[id].category==='tree',dead=id==='taiga-dead-tree',broad=['taiga-birch','taiga-aspen','taiga-rowan'].includes(id);
    if(tree){
        const h=taigaTreeHeight(id),pine=id.includes('pine'),larch=id==='taiga-larch',cedar=id==='taiga-cedar',fir=id==='taiga-fir',young=id.includes('young');
        const radius=young?.16:broad?.24:pine?.45:.35,bark=id==='taiga-birch'?0xc7c6b5:pine?0x96745a:0x746950;
        const trunk=(t:number)=>[Math.sin(t*2.1)*h*.015,t*h,Math.sin(t*3.1)*h*.009];
        const trunkSteps=level===2?3:5;for(let i=0;i<trunkSteps;i++)branch(trunk(i/trunkSteps),trunk((i+1)/trunkSteps),radius*(1-i/trunkSteps*.88),bark,.75);
        if(level<2)for(let i=0;i<5;i++){const a=i*2.39996;branch(trunk(.035),[Math.cos(a)*radius*5,.02,Math.sin(a)*radius*5],radius*.5,bark,.18);}
        const bottom=dead?.2:broad?.45:pine?.59:larch?.25:cedar?.28:.12,tiers=level===0?12:level===1?8:4;
        for(let tier=0;tier<tiers;tier++){
            const t=tier/(tiers-1),th=bottom+(1-bottom)*t*.97,y=th*h,whorl=level===2?3:level===1?4:5;
            for(let k=0;k<whorl;k++){
                const a=k/whorl*Math.PI*2+tier*2.39996+(random()-.5)*.6,r=(broad?3.7:pine?4.4:cedar?4.1:fir?2.65:3.25)*(1-t)**.7*(.75+random()*.45)*(young?.55:1);
                const base=trunk(th),end=[base[0]+Math.cos(a)*r,y+(pine||broad?r*.23:-r*.18),base[2]+Math.sin(a)*r];
                if(level<2||dead)branch(base,end,radius*(1-t)*.26+.012,bark,.12);
                if(dead||level===0&&tier===0&&k%3===0)continue;
                if(broad){
                    const clusters=level===0?4:level===1?3:2;
                    for(let j=0;j<clusters;j++)leafPatch(end[0]+Math.cos(a+j)*.5,end[1]+j*.24,end[2]+Math.sin(a+j)*.5,a+j,level===2?1.4:1.0,[0x688651,0x78965a,0x547447][k%3]);
                }else{
                    const needleColor=larch?0x889b59:fir?0x59744d:pine?0x718551:0x607d4c;
                    const start=[base[0]+(end[0]-base[0])*.12,y+.12,base[2]+(end[2]-base[2])*.12];
                    bough(start,end,(larch?.45:pine?1.05:.85)*(1-t*.65)*(young?.65:1),needleColor);
                    const shoots=level===0?2:level===1?1:0;
                    for(let j=0;j<shoots;j++){
                        const f=(j+.8)/(shoots+.2),px=base[0]+(end[0]-base[0])*f,pz=base[2]+(end[2]-base[2])*f,py=y+(end[1]-y)*f;
                        for(const sign of [-1,1])spray(px,py,pz,a+sign*.8,(level===2?r*.85:r*.36+.2),larch?.38:pine?.65:.53,needleColor);
                    }
                }
            }
        }
        if(id==='taiga-birch'&&level===0)for(let i=0;i<18;i++){const t=.05+i*.045,p=trunk(t);branch([p[0]-.15,p[1],p[2]],[p[0]+.17,p[1]+.09,p[2]+.035],.035,0x55594f,.85);}
    }else if(id==='taiga-log'){
        branch([-4,.5,-.3],[4,.4,.3],.46,0x655844,.77);branch([1,.6,0],[1.8,1.25,-1],.13);
        if(level<2)for(let i=0;i<5;i++)leafPatch(-2+i,.83,.12,i,1.0,0x5b713d);
    }else if(id==='taiga-stump'){
        branch([0,0,0],[.1,1.1,0],.55,0x6a5d46,.65);for(let i=0;i<5;i++){const a=i*2.4;branch([0,.3,0],[Math.cos(a)*1.3,.02,Math.sin(a)*1.3],.2,0x726045,.2);}
    }else if(id==='taiga-roots'){
        for(let i=0;i<5;i++){const a=i*2.4;branch([0,.3,0],[Math.cos(a),.18,Math.sin(a)],.14);branch([Math.cos(a),.18,Math.sin(a)],[Math.cos(a+.2)*2.4,0,Math.sin(a+.2)*2.4],.065);}
    }else if(id==='taiga-boulder'){
        const g=new T.IcosahedronGeometry(1,level===0?2:level===1?1:0),p=g.attributes.position;
        for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=1+.1*Math.sin(x*5+z*4)+.07*Math.cos(y*8-z*3);p.setXYZ(i,x*r*2.1,y*r*1.6+.65,z*r*1.7);}add(g,false,0x858981);
        if(level<2)for(let i=0;i<5;i++)leafPatch(Math.cos(i*2.4)*.8,1.85-i*.1,Math.sin(i*2.4)*.8,i,.65,i%2?0x939c82:0x627047);
    }else{
        const juniper=id==='taiga-juniper',bog=id==='taiga-bog-shrub'||id==='taiga-bilberry',low=id==='taiga-lingonberry',h=juniper?1.6:bog?1.1:low?.28:.6,count=level===0?7:level===1?5:3;
        for(let i=0;i<count;i++){
            const a=i*2.39996,r=(juniper?.7:bog?.45:.4)*(.7+random()*.6),end=[Math.cos(a)*r,h*(.55+random()*.45),Math.sin(a)*r];branch([0,0,0],end,.026,0x756c4e);
            for(let k=0;k<(level===0?4:2);k++){const t=(k+1)/(level===0?4:2),x=end[0]*t,y=end[1]*t,z=end[2]*t;
                if(juniper)spray(x,y,z,a+k, .55,.35,0x54725b);else leafPatch(x,y,z,a+k,low?.16:bog?.23:.24,low?0x677846:bog?0x75825c:0x4f703b);}
        }
    }
    if(level===2){
        for(const [parts,leaf]of [[wood,0],[foliage,1]] as const)for(const g of parts)g.setAttribute('aTaigaLeaf',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(leaf),1));
        const merged=mergeGeometries([...wood,...foliage]);[...wood,...foliage].forEach(g=>g.dispose());if(!merged)throw new Error('Не удалось собрать дальнюю модель тайги');
        const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.94,side:T.DoubleSide});material.name=deciduous?'taiga-mixed-deciduous':'taiga-mixed';decorateTaigaMaterial(material);
        root.add(new T.Mesh(merged,material));return root;
    }
    for(const [parts,leaf]of [[wood,false],[foliage,true]] as const){
        if(!parts.length)continue;const merged=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(!merged)throw new Error('Не удалось собрать модель тайги');
        const material=new T.MeshStandardMaterial({vertexColors:true,roughness:leaf?.95:.9,side:leaf?T.DoubleSide:T.FrontSide});
        material.name=leaf?(deciduous?'taiga-deciduous':'taiga-needles'):'taiga-bark';decorateTaigaMaterial(material);root.add(new T.Mesh(merged,material));
    }
    return root;
}
