import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import {taigaDefaults,validateTaiga,taigaClimate,type TaigaSettings} from './taiga-settings';
import {scatterTaiga} from './taiga-scatter';
import {taigaRegion} from './taiga-habitat';
import {isTaigaPlant} from './taiga-models';
import {validateWorld} from './project';
import {recordOperation} from './operations';

/** Replant the chosen habitat only; surfaces, snow and seasons preserve authored terrain and transforms. */
export function applyTaigaSettings(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,next:TaigaSettings,scope='world'){
    const settings=validateTaiga(next),region=scope==='world'?undefined:model.world.biomes.find(b=>b.id===scope&&b.kind==='taiga');
    if(scope==='world'&&model.world.preset!=='taiga'||scope!=='world'&&!region)throw new Error('Создайте мир «Тайга» или добавьте локальный биом «Тайга».');
    const previous=region?.taiga??model.world.recipe?.taiga??taigaDefaults();
    if(previous.terrainVariation!==settings.terrainVariation||previous.water!==settings.water)throw new Error('Рельеф и водоёмы задаются при создании нового мира.');
    const inScope=(x:number,z:number)=>region?Math.hypot(x-region.center[0],z-region.center[1])<region.radius:taigaRegion(model.world,x,z).weight>.05;
    const plantsChanged=(['variant','forestDensity','coniferDensity','deciduousRatio','treeHeightVariation','treeAgeVariation','understoryDensity','shrubDensity','deadwoodAmount','boulderDensity','moisture','bogFrequency','clearingFrequency'] as const).some(k=>previous[k]!==settings[k])||!model.world.objects.some(o=>o.source==='scatter'&&isTaigaPlant(o.asset)&&inScope(o.position[0],o.position[2]));
    const changed=history.transaction('Настроить тайгу',()=>{
        if(region)model.world={...model.world,biomes:model.world.biomes.map(b=>b.id===scope?{...b,taiga:settings}:b)};
        else model.world={...model.world,recipe:{version:1,seed:model.state.seed,erosion:1,plants:true,routes:true,...model.world.recipe,taiga:settings}};
        if(!region)Object.assign(model.state,taigaClimate(settings));
        if(plantsChanged){
            model.state.showScatter=model.state.showFoliage=true;
            const outside=model.world.objects.filter(o=>o.source!=='scatter'||!inScope(o.position[0],o.position[2]));
            model.world.objects=scatterTaiga(model,terrain,outside,region?.id).objects;
            const ids=new Set(model.world.objects.map(o=>o.id));model.world.groups=model.world.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>ids.has(id))})).filter(g=>g.objectIds.length>1);
            validateWorld(model.world,model.state);
            if(region){const r=region.radius+25,c=model.cell;vegetation.refreshRegions([[Math.floor((region.center[0]-r+512)/c),Math.floor((region.center[1]-r+512)/c),Math.ceil((region.center[0]+r+512)/c),Math.ceil((region.center[1]+r+512)/c)]]);}else vegetation.rebuild();
            recordOperation(model,'scatter',model.seeds.scatter,{taigaVersion:1,density:settings.forestDensity,moisture:settings.moisture},6);
        }else {validateWorld(model.world,model.state);vegetation.updateTaigaClimate();}
        materials.updateBiomes();materials.updateForestCover();history.refreshCurrent();
    });
    return {changed,plantsChanged};
}
