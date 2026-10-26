import {MIN_AREA_SIZE} from './territory-size';
import {ironPuddles} from './iron-terrain';
import {ironDefaults,validateIron,ironClimate,ironTerrainKey,type IronSettings} from './iron-settings';
import {WORLD_PRESETS,isWorldPreset} from './world-recipes';
import {createWorld,deriveSeeds,type WorldPresetId,type WorldRecipe} from './world';
import {SIZE,RESOLUTIONS,type EditorState,type EditorModel} from './state';
import {validateWorld} from './project';
import {recordOperation} from './operations';
import {paintTrails} from './trail-earthworks';
import {worldPaths} from './world-paths';
import {OperationCancelled,type JobRunner} from './worker-jobs';
import type {Feedback} from './feedback';
import type {HistorySystem} from './history';
import type {TerrainSystem} from './terrain';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import {scatterObjects} from './scatter';
import {jungleDefaults,validateJungle,type JungleSettings} from './jungle-settings';
import {jungleWaterBodies} from './jungle-terrain';
import {taigaDefaults,validateTaiga,taigaClimate,type TaigaSettings} from './taiga-settings';
import {taigaWaterBodies} from './taiga-terrain';
import {WORLD_TERRAIN_ALGORITHM} from './generation-settings';

export interface WorldRequest {preset:WorldPresetId;seed:number;N:number;areaSize:number;erosion:0|1|2;plants:boolean;routes:boolean;iron?:IronSettings;jungle?:JungleSettings;taiga?:TaigaSettings;terrain?:Partial<Pick<EditorState,'height'|'scale'|'sharp'|'mountains'|'warp'>>;}
export const defaultWorldRequest=():WorldRequest=>({preset:'archipelago',seed:1337,N:256,areaSize:1,erosion:1,plants:true,routes:true});
export function worldSettings(base:EditorState,request:WorldRequest):EditorState{
    const iron=request.preset==='iron-islands'?validateIron(request.iron??ironDefaults()):undefined;
    const jungle=request.preset==='jungle'?validateJungle(request.jungle??jungleDefaults()):undefined;
    const taiga=request.preset==='taiga'?validateTaiga(request.taiga??taigaDefaults()):undefined;
    if(!isWorldPreset(request.preset)||!Number.isInteger(request.seed)||request.seed<0||request.seed>0xffffffff||!RESOLUTIONS.includes(request.N as typeof RESOLUTIONS[number])||!Number.isFinite(request.areaSize)||request.areaSize<MIN_AREA_SIZE||request.areaSize>1||![0,1,2].includes(request.erosion)||typeof request.plants!=='boolean'||typeof request.routes!=='boolean')throw new Error('Проверьте тип мира, сид, размер и качество рельефа');
    const limits={height:[0,400],scale:[.3,3],sharp:[0,5],mountains:[0,1],warp:[0,2]} as const;
    for(const [key,value]of Object.entries(request.terrain??{})){
        const range=limits[key as keyof typeof limits];if(!Object.hasOwn(limits,key)||!Number.isFinite(value)||value<range[0]||value>range[1])throw new Error('Некорректная настройка рельефа: '+key);
    }
    return {...base,...WORLD_PRESETS[request.preset].settings,...request.terrain,...(jungle?{soilMoisture:jungle.moisture,clearingAmount:jungle.clearings,fog:jungle.atmosphere?.04+jungle.haze*.2:0,lowFog:jungle.atmosphere?jungle.haze*.8:0}:{}),...(taiga?taigaClimate(taiga):{}),...(iron?ironClimate(iron):{}),seed:request.seed,N:request.N,areaSize:request.areaSize,showScatter:request.plants,showFoliage:request.plants};
}
export function createWorldGeneration(model:EditorModel,terrain:TerrainSystem,materials:MaterialsSystem,vegetation:VegetationSystem,history:HistorySystem,feedback:Feedback,jobs:JobRunner,beforeStart=()=>{},previewJobs:JobRunner=jobs){
    const cache=new Map<string,Float32Array>();let cancelled=false,previewing=false;
    async function compute(request:WorldRequest,preview:boolean,onProgress:(p:number)=>void){
        const settings=worldSettings(model.state,{...request,N:preview?64:request.N}),erosion=preview?0:request.erosion;
        const jungle=request.preset==='jungle'?request.jungle??jungleDefaults():undefined;
        const taiga=request.preset==='taiga'?request.taiga??taigaDefaults():undefined;
        const iron=request.preset==='iron-islands'?validateIron(request.iron??ironDefaults()):undefined;
        const key=JSON.stringify([WORLD_TERRAIN_ALGORITHM,request.preset,settings.N,settings.seed,settings.areaSize,settings.scale,settings.height,settings.octaves,settings.sharp,settings.warp,settings.mountains,settings.island,settings.water,erosion,iron?ironTerrainKey(iron):null,jungle?[jungle.microrelief,jungle.streams,jungle.variant==='river']:null,taiga?[taiga.terrainVariation,taiga.bogFrequency,taiga.water,taiga.moisture>.4]:null]);
        const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);onProgress(1);return cached.slice();}
        const heights=await (preview?previewJobs:jobs).run({kind:'terrain',settings,seed:request.seed,preset:request.preset,worldErosion:erosion,jungle,taiga,iron},onProgress);
        cache.set(key,heights.slice());while(cache.size>4)cache.delete(cache.keys().next().value!);return heights;
    }
    const yieldUI=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
    return {
        async preview(request:WorldRequest,onProgress:(p:number)=>void=()=>{}){
            if(model.busy||previewing)throw new Error('Дождитесь завершения текущей операции');previewing=true;
            try{return await compute(request,true,onProgress);}finally{previewing=false;}
        },
        async generate(request:WorldRequest,skipUndo=false){
            if(model.busy||previewing)return false;
            const settings=worldSettings(model.state,request);beforeStart();const edit=history.begin('Создать мир: '+WORLD_PRESETS[request.preset].name,false,true);if(!edit)return false;
            cancelled=false;feedback.setBusy(true);feedback.setProgress(0);const started=performance.now();
            try{
                const heights=await compute(request,false,p=>{feedback.setProgress(p*.75);feedback.setStatus(p<.7?'Создание рельефа…':'Естественная эрозия…');});
                await yieldUI();if(cancelled)throw new OperationCancelled();
                Object.assign(model.state,settings);model.N=settings.N;model.n=settings.N+1;model.cell=SIZE/settings.N;model.heights=new Float32Array(heights);
                model.seeds=deriveSeeds(request.seed);model.operations=[];model.world=createWorld();model.world.preset=request.preset;
                model.world.recipe={version:1,seed:request.seed,erosion:request.erosion,plants:request.plants,routes:request.routes,...(request.preset==='iron-islands'?{iron:validateIron(request.iron??ironDefaults())}:{}),...(request.preset==='jungle'?{jungle:validateJungle(request.jungle??jungleDefaults())}:{}),...(request.preset==='taiga'?{taiga:validateTaiga(request.taiga??taigaDefaults())}:{})} satisfies WorldRecipe;
                model.world.waterBodies[0]={...model.world.waterBodies[0],level:settings.water,wave:settings.wave,opacity:settings.waterOpacity,...(request.preset==='iron-islands'?{clarity:3}: {})};
                if(request.preset==='iron-islands')model.world.waterBodies.push(...ironPuddles(settings,model.world.recipe.iron!));
                if(request.preset==='jungle')model.world.waterBodies.push(...jungleWaterBodies(settings,model.world.recipe.jungle!));
                if(request.preset==='taiga')model.world.waterBodies.push(...taigaWaterBodies(settings,model.world.recipe.taiga!));
                model.world.biomes=[{id:'world-biome',name:WORLD_PRESETS[request.preset].name,kind:WORLD_PRESETS[request.preset].biome,center:[0,0],radius:SIZE}];
                model.splat.fill(0);model.splatDetail.fill(0);feedback.setStatus('Маршруты и видовые точки…');feedback.setProgress(.78);
                Object.assign(model.world,worldPaths(model,request.routes));paintTrails(model,model.world.routes);
                terrain.buildTerrain();terrain.updateMeshAll();materials.splatTex.needsUpdate=materials.detailTex.needsUpdate=true;
                feedback.setStatus('Растения и окружение…');feedback.setProgress(.85);await yieldUI();if(cancelled)throw new OperationCancelled();
                if(request.plants){
                    model.world.objects=scatterObjects(model,terrain).objects.filter(o=>model.world.landmarks.every(p=>Math.hypot(o.position[0]-p.position[0],o.position[2]-p.position[1])>p.radius+2));
                    recordOperation(model,'scatter',model.seeds.scatter,{recipeVersion:1},6);
                }
                model.world=validateWorld(model.world,model.state);
                vegetation.rebuild();
                recordOperation(model,'preset',request.seed,{preset:['archipelago','desert','taiga','iron-islands','fjords','jungle'].indexOf(request.preset),recipeVersion:1,N:request.N,areaSize:request.areaSize,erosion:request.erosion,plants:request.plants,routes:request.routes},WORLD_TERRAIN_ALGORITHM);
                history.refreshCurrent();if(skipUndo)edit.discard();else edit.commit();feedback.setProgress(1);
                feedback.setStatus(WORLD_PRESETS[request.preset].name+' готов · '+((performance.now()-started)/1000).toFixed(1)+' с');return true;
            }catch(error){edit.rollback();feedback.setProgress(0);if(error instanceof OperationCancelled){feedback.setStatus('Создание мира отменено');return false;}throw error;}
            finally{feedback.setBusy(false);feedback.syncAllUI();}
        },
        cancel(){cancelled=true;jobs.cancel();if(previewJobs!==jobs)previewJobs.cancel();},get previewing(){return previewing;},get cacheSize(){return cache.size;},
    };
}
export type WorldGeneration=ReturnType<typeof createWorldGeneration>;
