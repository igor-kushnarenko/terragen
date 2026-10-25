import type {EditorModel} from './state';
import type {WaterBody} from './world';
import type {TerrainSystem} from './terrain';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import type {HistorySystem} from './history';
import type {Feedback} from './feedback';
import {OperationCancelled,type JobRunner} from './worker-jobs';
import {validateWorld} from './project';
import {paintWaterBanks} from './water-compute';
import {recordOperation} from './operations';

export function createWaterEdits(model:EditorModel,terrain:TerrainSystem,vegetation:VegetationSystem,materials:MaterialsSystem,history:HistorySystem,feedback:Feedback,jobs:JobRunner) {
    async function upsert(body:WaterBody){
        if(model.busy)return false;
        if(body.kind==='ocean')throw new Error('Для моря используйте раздел «Вода»');
        const exists=model.world.waterBodies.some(b=>b.id===body.id);
        const candidate=validateWorld({...model.world,waterBodies:exists?model.world.waterBodies.map(b=>b.id===body.id?body:b):[...model.world.waterBodies,body]},model.state);
        if(candidate.waterBodies.length>33)throw new Error('Не больше 32 отдельных водоёмов');
        const previous=model.world.waterBodies.find(b=>b.id===body.id),earthwork=(b:WaterBody)=>[b.kind,b.points,b.level,b.endLevel,b.pointLevels,b.outlet,b.width,b.depth,b.bankWidth,b.bankSurface];
        if(previous&&JSON.stringify(earthwork(previous))===JSON.stringify(earthwork(body))){
            history.transaction('Параметры водоёма',()=>{model.world=candidate;materials.updateWater();history.refreshCurrent();});feedback.syncAllUI();feedback.setStatus('Параметры воды обновлены');return true;
        }
        const edit=history.begin(exists?'Изменить водоём':'Создать водоём');if(!edit)return false;
        feedback.setBusy(true);feedback.setProgress(0);
        try{
            const heights=await jobs.run({kind:'water',settings:{...model.state},seed:model.seeds.terrain,heights:model.heights,waterBodies:[body]},feedback.setProgress);
            model.heights=new Float32Array(heights);model.world=candidate;paintWaterBanks(model,[body]);
            terrain.updateMeshAll();vegetation.snapScatter();materials.splatTex.needsUpdate=materials.detailTex.needsUpdate=true;
            recordOperation(model,'water',model.seeds.terrain,{level:body.level,endLevel:body.endLevel??body.level,depth:body.depth??4,width:body.width,flowSpeed:body.flowSpeed??0,flowDirection:body.flowDirection??1,points:body.points.length});
            history.refreshCurrent();edit.commit();feedback.setStatus('Водоём готов: русло, уровень воды и берега обновлены');return true;
        }catch(error){edit.rollback();if(error instanceof OperationCancelled){feedback.setStatus('Создание водоёма отменено');return false;}throw error;}
        finally{feedback.setBusy(false);feedback.syncAllUI();}
    }
    function remove(id:string){if(model.busy)return;const body=model.world.waterBodies.find(b=>b.id===id);if(!body||body.kind==='ocean')return;
        history.transaction('Удалить водоём',()=>{model.world={...model.world,waterBodies:model.world.waterBodies.filter(b=>b.id!==id)};vegetation.snapScatter();history.refreshCurrent();});
        feedback.setStatus('Водная поверхность удалена; рельеф русла сохранён');
    }
    return {upsert,remove};
}
export type WaterEdits=ReturnType<typeof createWaterEdits>;
