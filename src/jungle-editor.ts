import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import {validateWorld} from './project';
import {jungleDefaults,validateJungle,type JungleSettings} from './jungle-settings';
import {scatterJungle} from './jungle-scatter';
import {recordOperation} from './operations';

/** Replant only the selected jungle; appearance-only edits preserve all object identities and heights. */
export function applyJungleSettings(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,next:JungleSettings,scope='world') {
    const settings=validateJungle(next),region=scope==='world'?undefined:model.world.biomes.find(b=>b.id===scope&&b.kind==='jungle');
    if(scope==='world'&&model.world.preset!=='jungle'||scope!=='world'&&!region)throw new Error('Выберите созданные джунгли или добавьте локальный биом «Джунгли».');
    const previous=region?.jungle??model.world.recipe?.jungle??jungleDefaults();
    const plantsChanged=(['variant','canopy','emergents','understory','vines','moisture','clearings'] as const).some(key=>previous[key]!==settings[key])||!model.world.objects.some(o=>o.source==='scatter'&&o.asset.startsWith('jungle-')&&(!region||Math.hypot(o.position[0]-region.center[0],o.position[2]-region.center[1])<region.radius));
    const changed=history.transaction('Настроить джунгли',()=>{
        if(region)model.world={...model.world,biomes:model.world.biomes.map(b=>b.id===scope?{...b,jungle:settings}:b)};
        else model.world={...model.world,recipe:{...model.world.recipe!,jungle:settings}};
        if(!region){model.state.soilMoisture=settings.moisture;model.state.clearingAmount=settings.clearings;}
        model.state.fog=settings.atmosphere?.04+settings.haze*.2:0;model.state.lowFog=settings.atmosphere?settings.haze*.8:0;
        if(plantsChanged){
            model.state.showScatter=model.state.showFoliage=true;
            const outside=model.world.objects.filter(o=>o.source!=='scatter'||region&&Math.hypot(o.position[0]-region.center[0],o.position[2]-region.center[1])>=region.radius);
            model.world.objects=scatterJungle(model,terrain,outside,region?.id).objects;
            const ids=new Set(model.world.objects.map(o=>o.id));model.world.groups=model.world.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>ids.has(id))})).filter(g=>g.objectIds.length>1);
            validateWorld(model.world,model.state);
            if(region){const r=region.radius+20,c=model.cell;vegetation.refreshRegions([[Math.floor((region.center[0]-r+512)/c),Math.floor((region.center[1]-r+512)/c),Math.ceil((region.center[0]+r+512)/c),Math.ceil((region.center[1]+r+512)/c)]]);}else vegetation.rebuild();
            recordOperation(model,'scatter',model.seeds.scatter,{jungleVersion:1,canopy:settings.canopy,vines:settings.vines,understory:settings.understory},6);
        }else validateWorld(model.world,model.state);
        materials.updateBiomes();materials.updateForestCover();history.refreshCurrent();
    });
    return {changed,plantsChanged};
}
