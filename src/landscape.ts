import { LANDSCAPE_PRESETS } from './presets';
import { compositionRoutes, planComposition, worldId } from './composition';
import { pathObstacles, checkRoutes, paintTrails, clearTrailObjects } from './trail-earthworks';
import { trailCurve, routeLength } from './trail-math';
import { createWorld, type LegacyPresetId, type OperationRecord, type Vec2, type WorldRoute } from './world';
import { validateWorld } from './project';
import { recordOperation } from './operations';
import {TERRAIN_ALGORITHM} from './generation-settings';
import { SIZE, type EditorModel } from './state';
import { OperationCancelled, type JobRunner } from './worker-jobs';
import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import type { MaterialsSystem } from './materials';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
export interface TrailDraft { name:string; controls:Vec2[]; width:number; surface:NonNullable<WorldRoute['surface']>; maxGrade:number; }
export function createLandscape(model:EditorModel,terrain:TerrainSystem,materials:MaterialsSystem,vegetation:VegetationSystem,history:HistorySystem,feedback:Feedback,jobs:JobRunner,beforeStart:(kind:OperationRecord['kind'])=>void=()=>{}){
    async function execute(kind:'preset'|'composition'|'trail',work:()=>Promise<void>){
        if(model.busy)return false;
        beforeStart(kind);const edit=history.begin(kind==='preset'?'Мир по пресету':kind==='composition'?'Композиция ландшафта':'Тропа по кривой');if(!edit)return false;
        feedback.setBusy(true);feedback.setProgress(0);feedback.setStatus('Создание ландшафта…');
        try{
            await work();model.world=validateWorld(model.world,model.state);
            terrain.buildTerrain();terrain.updateMeshAll();materials.splatTex.needsUpdate=materials.detailTex.needsUpdate=true;
            vegetation.rebuild();history.refreshCurrent();edit.commit();feedback.setProgress(1);feedback.setStatus(kind==='trail'?'Тропа построена: уклон проверен, покрытие нанесено, путь расчищен':'Композиция готова: '+model.world.landmarks.length+' мест · '+model.world.routes.length+' маршрутов');return true;
        }catch(error){edit.rollback();feedback.setProgress(0);if(error instanceof OperationCancelled){feedback.setStatus('Создание ландшафта отменено');return false;}throw error;}
        finally{feedback.setBusy(false);feedback.syncAllUI();}
    }
    async function compose(startProgress=0){
        model.world={...model.world,landmarks:[],objects:model.world.objects.filter(o=>o.source!=='composition'),routes:model.world.routes.filter(r=>r.source!=='composition'),biomes:model.world.biomes.filter(b=>b.source!=='composition')};
        const plan=planComposition(model.state,model.heights,model.seeds.composition,model.world,pathObstacles(model,true));
        model.heights=new Float32Array(await jobs.run({kind:'shape',settings:model.state,seed:model.seeds.composition,heights:model.heights,features:plan.features,waterBodies:model.world.waterBodies},p=>feedback.setProgress(startProgress+(0.4-startProgress)*p)));
        model.world={...model.world,landmarks:plan.landmarks,biomes:[...model.world.biomes,...plan.biomes],objects:[...model.world.objects,...plan.objects]};
        const routes=compositionRoutes(model.state,model.heights,model.world,plan,pathObstacles(model,true));checkRoutes(model,routes,model.heights,false,true);
        const network=[...model.world.routes.filter(r=>r.maxGrade!==undefined),...routes];
        model.heights=new Float32Array(await jobs.run({kind:'shape',settings:model.state,seed:model.seeds.composition,heights:model.heights,routes:network,waterBodies:model.world.waterBodies},p=>feedback.setProgress(0.4+p*0.48)));
        checkRoutes(model,network,model.heights,true,true);model.world.routes=[...model.world.routes,...routes];paintTrails(model,routes);clearTrailObjects(model,network,true);
        terrain.updateMeshAll();vegetation.scatter();feedback.setProgress(0.98);
        recordOperation(model,'composition',model.seeds.composition,{places:plan.landmarks.length,routes:routes.length,preset:model.world.preset?Object.keys(LANDSCAPE_PRESETS).indexOf(model.world.preset):-1,areaSize:model.state.areaSize},2);
    }
    return {
        generatePreset(preset:LegacyPresetId){return execute('preset',async()=>{
            const recipe=LANDSCAPE_PRESETS[preset];if(!recipe)throw new Error('Неизвестный пресет');
            const old=model.world;Object.assign(model.state,recipe.settings,{dayCycle:false});model.world=createWorld();model.world.assets=old.assets;model.world.objects=old.objects.filter(o=>o.source==='manual');model.world.preset=preset;
            model.world.groups=old.groups.filter(g=>g.objectIds.every(id=>model.world.objects.some(o=>o.id===id)));model.world.viewpoints=old.viewpoints;
            if(model.state.areaSize<1)model.state.height=Math.max(20,model.state.height*model.state.areaSize);
            model.world.waterBodies[0]={...model.world.waterBodies[0],level:model.state.water,opacity:model.state.waterOpacity,wave:model.state.wave};
            model.world.biomes=[{id:worldId(model.world)('preset-biome'),name:recipe.name,kind:preset,center:[0,0],radius:SIZE}];
            model.splat.fill(0);model.splatDetail.fill(0);
            model.heights=new Float32Array(await jobs.run({kind:'terrain',settings:model.state,seed:model.seeds.terrain},p=>feedback.setProgress(p*0.2)));
            recordOperation(model,'preset',model.seeds.terrain,{preset:Object.keys(LANDSCAPE_PRESETS).indexOf(preset),N:model.N,areaSize:model.state.areaSize,terrainAlgorithm:TERRAIN_ALGORITHM},4);
            await compose(0.2);
        });},
        compose:()=>execute('composition',()=>compose()),
        buildTrail(draft:TrailDraft){return execute('trail',async()=>{
            if(!draft.name.trim()||draft.name.length>128||!Number.isFinite(draft.width)||draft.width<2||draft.width>32||!Number.isFinite(draft.maxGrade)||draft.maxGrade<0.05||draft.maxGrade>0.7||!['soil','gravel','sand'].includes(draft.surface))throw new Error('Проверьте название, ширину и уклон тропы');
            const points=trailCurve(draft.controls,Math.max(1,SIZE/model.N/2));if(points.length<2||routeLength(points)<3)throw new Error('Добавьте хотя бы две разные точки тропы');
            if(routeLength(points)>4000)throw new Error('Тропа длиннее 4 км — разделите её на несколько маршрутов');
            const route:WorldRoute={id:worldId(model.world)('trail'),name:draft.name.trim(),kind:'trail',points,controlPoints:structuredClone(draft.controls),curve:'centripetal',width:draft.width,maxGrade:draft.maxGrade,surface:draft.surface,source:'manual'};
            checkRoutes(model,[route]);
            const network=[...model.world.routes.filter(r=>r.maxGrade!==undefined),route];
            model.heights=new Float32Array(await jobs.run({kind:'shape',settings:model.state,seed:model.seeds.composition,heights:model.heights,routes:network,waterBodies:model.world.waterBodies},p=>feedback.setProgress(p*0.9)));
            checkRoutes(model,network,model.heights,true);model.world.routes=[...model.world.routes,route];paintTrails(model,[route]);const cleared=clearTrailObjects(model,network);
            recordOperation(model,'trail',model.seeds.composition,{width:route.width,maxGrade:route.maxGrade!,surface:['soil','gravel','sand'].indexOf(route.surface!),points:draft.controls.length,cleared});
        });},
        cancel:jobs.cancel,
    };
}
export type LandscapeSystem=ReturnType<typeof createLandscape>;
