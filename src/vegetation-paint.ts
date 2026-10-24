import type {EditorModel} from './state';
import {HALF} from './state';
import {MAX_WORLD_OBJECTS,type WorldObject} from './world';
import type {TerrainSystem} from './terrain';
import type {HistorySystem,HistoryTransaction} from './history';
import type {VegetationSystem} from './vegetation';
import {FootprintIndex,objectFootprint,routeClearance} from './ecology';
import {getModel,modelEntries} from './model-library';
import {worldId} from './composition';
import {mulberry32} from './noise';
import {waterLevelAt} from './water-math';
import {recordOperation} from './operations';

export interface VegetationBrushSettings {
    assets:string[];radius:number;density:number;spacing:number;minScale:number;maxScale:number;
    maxSlope:number;preservePaths:boolean;randomRotation:boolean;erase:boolean;
}
export const DEFAULT_VEGETATION_BRUSH:VegetationBrushSettings={assets:['grass'],radius:12,density:.6,spacing:.8,minScale:.8,maxScale:1.25,maxSlope:35,preservePaths:true,randomRotation:true,erase:false};
export const MAX_STROKE_OBJECTS=2000;
/** One transaction per stroke; spatial cells make overlapping dabs independent of event frequency. */
export function createVegetationPainter(model:EditorModel,terrain:TerrainSystem,vegetation:Pick<VegetationSystem,'rebuild'>,history:HistorySystem){
    let edit:HistoryTransaction|undefined,settings:VegetationBrushSettings,seed=0,changed=0,added=0,samples=0;
    let index=new FootprintIndex(),visited=new Set<string>(),nextId:ReturnType<typeof worldId>;
    const statistics={changed:0,limited:false,erasing:false};
    function begin(draft:VegetationBrushSettings){
        end();
        if(model.busy)return false;
        const available=new Set(modelEntries(model.world).map(a=>a.id));
        if(!draft.assets.length||draft.assets.some(id=>!available.has(id)))throw new Error('Выберите объекты кисти из библиотеки этого мира');
        for(const [key,min,max]of [['radius',1,80],['density',0,1],['spacing',.3,20],['minScale',.05,10],['maxScale',.05,10],['maxSlope',0,65]] as const){
            if(!Number.isFinite(draft[key])||draft[key]<min||draft[key]>max)throw new Error('Некорректный параметр кисти: '+key);
        }
        if(draft.minScale>draft.maxScale)throw new Error('Минимальный размер должен быть не больше максимального');
        settings=structuredClone(draft);edit=history.begin(settings.erase?'Ластик объектов':'Кисть растительности');if(!edit)return false;
        seed=(model.seeds.brush^Math.imul(model.operations.length+1,0x9e3779b1))>>>0;
        nextId=worldId(model.world);visited=new Set();index=new FootprintIndex();changed=added=samples=statistics.changed=0;statistics.limited=false;statistics.erasing=settings.erase;
        for(const item of model.world.objects)index.insert(objectFootprint(item,terrain,false));
        return true;
    }
    function dab(points:readonly {x:number;z:number}[]){
        if(!edit?.active||model.busy)return 0;
        let count=0;
        for(const point of points){
            if(!Number.isFinite(point.x)||!Number.isFinite(point.z))continue;
            samples++;
            if(settings.erase){
                const removed=new Set(model.world.objects.filter(item=>settings.assets.includes(item.asset)&&Math.hypot(item.position[0]-point.x,item.position[2]-point.z)<=settings.radius).map(o=>o.id));
                if(removed.size){
                    model.world.objects=model.world.objects.filter(o=>!removed.has(o.id));
                    model.world.groups=model.world.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>!removed.has(id))})).filter(g=>g.objectIds.length>=2);
                    count+=removed.size;
                }
                continue;
            }
            if(!settings.density)continue;
            const cell=settings.spacing,r=settings.radius,x0=Math.floor((point.x-r)/cell),z0=Math.floor((point.z-r)/cell);
            const width=Math.ceil(2*r/cell)+2,total=width*width,items:WorldObject[]=[];
            // Walk a permutation, so bounded dense dabs still fill the whole disc rather than one edge.
            let stride=1031;const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
            while(gcd(stride,total)!==1)stride+=2;
            for(let attempt=0;attempt<Math.min(total,6000);attempt++){
                if(items.length>=400||added>=MAX_STROKE_OBJECTS||model.world.objects.length+items.length>=MAX_WORLD_OBJECTS){statistics.limited=true;break;}
                const offset=(seed%total+attempt*stride)%total,ix=x0+offset%width,iz=z0+Math.floor(offset/width),key=ix+','+iz;
                if(visited.has(key))continue;
                const random=mulberry32((seed^Math.imul(ix,73856093)^Math.imul(iz,19349663))>>>0);
                const x=(ix+.15+random()*.7)*cell,z=(iz+.15+random()*.7)*cell;
                if(Math.hypot(x-point.x,z-point.z)>r)continue;visited.add(key);
                if(random()>settings.density||Math.abs(x)>HALF-1||Math.abs(z)>HALF-1)continue;
                const asset=settings.assets[Math.floor(random()*settings.assets.length)],scale=settings.minScale+random()*(settings.maxScale-settings.minScale),yaw=settings.randomRotation?random()*Math.PI*2:0;
                const y=terrain.getH(x,z);
                if(y<=waterLevelAt(model.state.water,model.world.waterBodies,x,z)+.4||terrain.getNormalY(x,z)<Math.cos(settings.maxSlope*Math.PI/180))continue;
                const item:WorldObject={id:'pending',asset,source:'manual',position:[x,y,z],rotation:[0,yaw,0],scale:[scale,scale,scale],followTerrain:true,groundOffset:0,tint:.9+random()*.15};
                const footprint=objectFootprint(item,terrain,getModel(asset).category==='tree');
                if(settings.preservePaths&&routeClearance(model.world.routes,x,z)<footprint.radius+.3)continue;
                if(index.query(x,z,footprint.radius+cell).some(p=>Math.hypot(x-p.x,z-p.z)<Math.max(cell*.7,footprint.radius+p.radius)&&footprint.maxY>p.minY&&footprint.minY<p.maxY))continue;
                item.id=nextId('paint');items.push(item);index.insert(footprint);added++;
            }
            if(items.length){model.world.objects=[...model.world.objects,...items];count+=items.length;}
        }
        if(count){changed+=count;statistics.changed=changed;vegetation.rebuild();}
        return count;
    }
    function end(){
        const transaction=edit;edit=undefined;if(!transaction?.active)return;
        if(changed){recordOperation(model,'scatter',seed,{manualBrush:true,erase:settings.erase,radius:settings.radius,density:settings.density,spacing:settings.spacing,minScale:settings.minScale,maxScale:settings.maxScale,maxSlope:settings.maxSlope,preservePaths:settings.preservePaths,randomRotation:settings.randomRotation,samples,count:changed},4);transaction.commit();}
        else transaction.discard();
    }
    function rollback(){const transaction=edit;edit=undefined;transaction?.rollback();statistics.changed=0;}
    return {begin,dab,end,rollback,statistics,get painting(){return !!edit?.active;}};
}
