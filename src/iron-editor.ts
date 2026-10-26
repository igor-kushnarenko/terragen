import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import {validateWorld} from './project';
import {ironDefaults,validateIron,ironClimate,IRON_TERRAIN_KEYS,IRON_PLANT_KEYS,type IronSettings} from './iron-settings';
import {scatterIron} from './iron-scatter';

/** Appearance edits never touch the height buffer, collider terrain or manual objects. */
export function applyIronSettings(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,next:IronSettings){
    if(model.world.preset!=='iron-islands')throw new Error('Сначала создайте мир «Железные острова».');
    const settings=validateIron(next),previous=model.world.recipe?.iron??ironDefaults();
    if(IRON_TERRAIN_KEYS.some(k=>settings[k]!==previous[k]))throw new Error('Геология задаётся при создании мира. Откройте «Новый архипелаг» для нового рельефа.');
    const plantsChanged=IRON_PLANT_KEYS.some(k=>previous[k]!==settings[k]);
    const changed=history.transaction('Настроить Железные острова',()=>{
        model.world={...model.world,recipe:{version:1,seed:model.state.seed,erosion:0,plants:true,routes:false,...model.world.recipe,iron:settings}};
        Object.assign(model.state,ironClimate(settings));
        if(plantsChanged&&model.world.recipe!.plants){
            model.world.objects=scatterIron(model,terrain,'plants').objects;
            const ids=new Set(model.world.objects.map(o=>o.id));model.world.groups=model.world.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>ids.has(id))})).filter(g=>g.objectIds.length>1);
            vegetation.rebuild();
        }
        validateWorld(model.world,model.state);materials.updateBiomes();materials.updateWater();materials.updateForestCover();history.refreshCurrent();
    });
    return {changed,plantsChanged};
}
