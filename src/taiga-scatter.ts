import {mulberry32} from './noise';
import {SIZE,type EditorModel} from './state';
import {MAX_WORLD_OBJECTS,type WorldObject} from './world';
import {createEcology,FootprintIndex,objectFootprint,type EcologyTerrain} from './ecology';
import {CanopyIndex} from './jungle-habitat';
import {createTaigaHabitat,taigaRegion} from './taiga-habitat';
import {getModel} from './model-library';
import {waterSignedDistance} from './water-math';
import {taigaTreeHeight} from './taiga-models';

export function scatterTaiga(model:EditorModel,terrain:EcologyTerrain,existing=model.world.objects.filter(o=>o.source!=='scatter'),regionId?:string){
    const objects=[...existing],occupied=new FootprintIndex(),canopy=new CanopyIndex(),habitat=createTaigaHabitat(model,terrain),ecology=createEcology(model,terrain);
    const random=mulberry32(model.seeds.scatter^0x72bad1),ids=new Set([...objects,...model.world.biomes,...model.world.groups,...model.world.waterBodies,...model.world.routes,...model.world.landmarks,...model.world.viewpoints].map(o=>o.id));
    for(const o of existing){occupied.insert(objectFootprint(o,terrain));canopy.add(o);}
    const selected=regionId?model.world.biomes.find(b=>b.id===regionId&&b.kind==='taiga'):undefined;
    if(regionId&&!selected)throw new Error('Локальный биом тайги не найден');
    const inRegion=(x:number,z:number)=>!selected||Math.hypot(x-selected.center[0],z-selected.center[1])<selected.radius;
    const step=Math.min(16,selected?selected.radius/3:16),cells:{x:number;z:number}[]=[];
    for(let z=-SIZE/2+step/2;z<SIZE/2;z+=step)for(let x=-SIZE/2+step/2;x<SIZE/2;x+=step){if(inRegion(x,z)&&taigaRegion(model.world,x,z).weight>.05&&terrain.getH(x,z)>model.state.water+.7)cells.push({x,z});}
    const counts={trees:0,rocks:0,bushes:0,canopy:0,understory:0,deadwood:0};
    if(!cells.length)return {objects,counts};
    const area=cells.length*step*step/(SIZE*SIZE),samples=cells.map(c=>habitat.sample(c.x,c.z)),mean=(key:'forestDensity'|'understoryDensity'|'shrubDensity'|'boulderDensity'|'deadwoodAmount')=>samples.reduce((n,e)=>n+e.t[key],0)/samples.length;
    const conifers=samples.reduce((n,e)=>n+e.t.coniferDensity*(1-e.t.deciduousRatio)+e.t.deciduousRatio,0)/samples.length;
    let serial=0;
    function place(asset:string,x:number,z:number,sx:number,sy:number,radius:number,tree=false){
        if(objects.length>=MAX_WORLD_OBJECTS)return false;
        const h=terrain.getH(x,z),template=getModel(asset),plant=template.category==='tree'||template.category==='shrub',angle=random()*Math.PI*2;
        if(plant&&model.world.waterBodies.some(b=>b.kind!=='ocean'&&waterSignedDistance(b,x,z).signed>-radius-.35))return false;
        const offset=plant?-.06:asset==='taiga-boulder'?-.3*sy:-.08;
        const item:WorldObject={id:'',asset,source:'scatter',position:[x,h+offset,z],rotation:tree?[(random()-.5)*.025,angle,(random()-.5)*.025]:[0,angle,0],
            scale:[sx,sy,sx*(.86+random()*.28)],groundOffset:offset,followTerrain:true,tint:.84+random()*.3};
        const footprint=tree?{x,z,radius,minY:h-.12,maxY:h+template.bounds.max.y*sy,item}:objectFootprint(item,terrain);
        if(ecology.pathClearance(x,z)<footprint.radius+.8||model.world.landmarks.some(p=>Math.hypot(x-p.position[0],z-p.position[1])<p.radius+footprint.radius)||occupied.overlaps(footprint,.45))return false;
        let id='taiga-'+serial++;while(ids.has(id))id='taiga-'+serial++;ids.add(id);item.id=id;
        objects.push(item);occupied.insert(footprint);if(tree){counts.trees++;canopy.add(item);}return true;
    }
    function pass(target:number,attempts:number,accept:(x:number,z:number,e:ReturnType<typeof habitat.sample>)=>boolean){
        let placed=0;for(let i=0;i<Math.ceil(target*attempts)&&placed<target&&objects.length<MAX_WORLD_OBJECTS;i++){
            const cell=cells[Math.floor(random()*cells.length)],x=cell.x+(random()-.5)*step,z=cell.z+(random()-.5)*step;
            if(!inRegion(x,z)||Math.abs(x)>511||Math.abs(z)>511)continue;
            const e=habitat.sample(x,z);if(e.weight<.05||!e.dry||e.ny<.84)continue;if(accept(x,z,e))placed++;
        }
    }
    pass(Math.round(10000*mean('forestDensity')*conifers*area),18,(x,z,e)=>{
        if(random()>e.density*(1-e.bog*.72))return false;
        const t=e.t,deciduousWeight=t.deciduousRatio*(.45+e.clearing*2+e.disturbance),deciduous=random()<deciduousWeight/Math.max(.0001,deciduousWeight+1-t.deciduousRatio),dry=e.drainage>.53;
        if(!deciduous&&random()>t.coniferDensity)return false;
        let asset:string;
        if(deciduous)asset=random()<.63?'taiga-birch':random()<.75?'taiga-aspen':'taiga-rowan';
        else if(t.variant==='larch'&&random()<.82)asset='taiga-larch';
        else if(t.variant==='pine'&&random()<.88||dry&&random()<.7)asset='taiga-pine';
        else if(e.bog>.3)asset=random()<.55?'taiga-pine':'taiga-siberian-spruce';
        else {const r=random();asset=r<.5?'taiga-spruce':r<.73?'taiga-siberian-spruce':r<.9?'taiga-fir':'taiga-cedar';}
        const dominant=!deciduous&&random()<t.treeAgeVariation*.035;
        let height=dominant?40+random()*5:25+(random()-.5)*20*t.treeHeightVariation+(random()-.5)*5*t.treeAgeVariation;
        height=Math.max(15,Math.min(35,height));if(dominant)height=40+random()*5;
        if(deciduous)height=asset==='taiga-rowan'?5+random()*5:14+random()*10;
        height*=1-e.bog*.52;
        if(!place(asset,x,z,(.8+random()*.45)*(1-e.bog*.25),height/taigaTreeHeight(asset),1.8,true))return false;
        counts.canopy++;return true;
    });
    pass(Math.round(3000*mean('understoryDensity')*area),18,(x,z,e)=>{
        const shade=canopy.sample(x,z).shade;
        if(e.t.forestDensity===0||random()>e.weight*(.12+(1-shade)*.58+e.clearing*.45)*(1-e.bog*.6)*(.35+e.detail*.65))return false;
        const asset=e.t.coniferDensity===0||random()<e.t.deciduousRatio*(.3+e.clearing)?'taiga-birch':e.t.variant==='pine'||e.drainage>.58?'taiga-young-pine':'taiga-young-spruce';
        const height=3+random()*(5+7*e.t.treeAgeVariation);
        if(!place(asset,x,z,.4+height/20,height/taigaTreeHeight(asset),.8,true))return false;counts.understory++;return true;
    });
    pass(Math.round(4300*mean('shrubDensity')*area),16,(x,z,e)=>{
        const shade=canopy.sample(x,z).shade;
        if(random()>e.weight*(.2+e.detail*.8)*(.3+(1-shade)*.5+e.bog*.35))return false;
        const asset=e.bog>.16?random()<.6?'taiga-bog-shrub':'taiga-bilberry':e.drainage>.5?random()<.75?'taiga-lingonberry':'taiga-juniper':'taiga-blueberry';
        const seasonal=e.t.season==='winter'?.45:1;
        if(!place(asset,x,z,.65+random()*.65,(.65+random()*.65)*seasonal,.5))return false;counts.bushes++;return true;
    });
    pass(Math.round(950*mean('boulderDensity')*area),20,(x,z,e)=>{
        if(random()>e.weight*(.2+e.drainage*.8))return false;
        if(!place('taiga-boulder',x,z,.45+random()**2*1.5,.4+random()*1.1,2))return false;counts.rocks++;return true;
    });
    pass(Math.round(850*mean('deadwoodAmount')*area),25,(x,z,e)=>{
        const shade=canopy.sample(x,z).shade;
        if(e.t.forestDensity===0||random()>e.weight*(.12+shade*.3+e.disturbance*.7))return false;
        const r=random(),asset=r<.45?'taiga-log':r<.68?'taiga-stump':r<.86?'taiga-dead-tree':'taiga-roots',tree=asset==='taiga-dead-tree';
        if(!place(asset,x,z,.65+random()*.6,.65+random()*.6,tree?1.1:2,tree))return false;counts.deadwood++;return true;
    });
    return {objects,counts};
}
