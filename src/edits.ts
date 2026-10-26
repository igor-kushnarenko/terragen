import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import { validateSeeds, validateWalkSettings, validateWorld,validateState } from './project';
import type { EditorModel,EditorState } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
import { deriveSeeds, type OperationSeeds, type WalkSettings, type WorldData, type WorldObject } from './world';
import {worldId} from './composition';
import {expandSelection} from './object-transforms';
import {getModel,modelEntries} from './model-library';
export function createWorldEdits(model: EditorModel, history: HistorySystem, terrain: TerrainSystem, vegetation: VegetationSystem, feedback: Feedback) {
    function replaceWorld(patch: Partial<WorldData>, label = 'Мир') {
        const state = { ...model.state }, candidate = { ...structuredClone(model.world), ...structuredClone(patch) };
        const ocean = candidate.waterBodies.find(body => body.kind === 'ocean');
        if (ocean) {
            state.water = ocean.level;
            state.waterOpacity = ocean.opacity;
            state.wave = ocean.wave;
        }
        const validated = validateWorld(candidate, state,false,false,false);
        modelEntries(validated);
        const changed = history.transaction(label, () => {
            Object.assign(model.state, state);
            model.world = validated;
            vegetation.rebuild();
            history.refreshCurrent();
            feedback.syncAllUI();
        });
        if (changed)
            feedback.setStatus(label);
    }
    function addObject(asset: WorldObject['asset'], x: number, z: number) {
        if (model.busy)
            return;
        const item: WorldObject = { id: worldId(model.world)('manual'), asset, source: 'manual', position: [x, terrain.getH(x, z), z],
            rotation: [0, 0, 0], scale: [1, 1, 1], groundOffset: 0, followTerrain: true, tint: 1,
            ...(getModel(asset).rig?{animation:{clip:getModel(asset).rig!.clips.length?0:-1,playing:!!getModel(asset).rig!.clips.length,speed:1,loop:'repeat',time:0}}:{}) };
        replaceWorld({ objects: [...model.world.objects, item] }, 'Добавить объект');
        return item.id;
    }
    function updateObject(id: string, patch: Partial<Omit<WorldObject, 'id'>>) {
        if (!model.world.objects.some(item => item.id === id))
            throw new Error('Объект не найден');
        replaceWorld({ objects: model.world.objects.map(item => item.id === id ? { ...item, ...structuredClone(patch),source:'manual' } : item) }, 'Изменить объект');
    }
    function removeObject(id: string) {
        removeObjects([id]);
    }
    function removeObjects(ids:string[]){const selected=new Set(expandSelection(model.world,ids));replaceWorld({objects:model.world.objects.filter(o=>!selected.has(o.id)),groups:model.world.groups.filter(g=>!g.objectIds.some(id=>selected.has(id)))},'Удалить объекты');}
    function duplicateObjects(ids:string[]){
        const selected=new Set(expandSelection(model.world,ids)),id=worldId(model.world),mapping=new Map<string,string>();
        const copies=model.world.objects.filter(o=>selected.has(o.id)).map(o=>{const copy=structuredClone(o);copy.id=id('copy');mapping.set(o.id,copy.id);copy.source='manual';copy.position[0]+=4;copy.position[2]+=4;return copy;});
        const groups=model.world.groups.filter(g=>g.objectIds.every(id=>selected.has(id))).map(g=>({id:id('group'),name:g.name+' — копия',objectIds:g.objectIds.map(id=>mapping.get(id)!)}));
        replaceWorld({objects:[...model.world.objects,...copies],groups:[...model.world.groups,...groups]},'Копировать объекты');return copies.map(o=>o.id);
    }
    function groupObjects(ids:string[],name='Группа моделей'){
        const selected=new Set(expandSelection(model.world,ids));if(selected.size<2)throw new Error('Выберите хотя бы две модели через Shift+клик');
        const group={id:worldId(model.world)('group'),name,objectIds:[...selected]};
        replaceWorld({objects:model.world.objects.map(o=>selected.has(o.id)?{...o,source:'manual'}:o),groups:[...model.world.groups.filter(g=>!g.objectIds.some(id=>selected.has(id))),group]},'Сгруппировать модели');return group.id;
    }
    function ungroupObjects(ids:string[]){const selected=new Set(ids);replaceWorld({groups:model.world.groups.filter(g=>!g.objectIds.some(id=>selected.has(id)))},'Разгруппировать модели');}
    function setSeeds(patch: Partial<OperationSeeds>, derive = false) {
        const seeds = validateSeeds({ ...(derive && patch.terrain !== undefined ? deriveSeeds(patch.terrain) : model.seeds), ...patch });
        history.transaction('Сиды генерации', () => { model.seeds = seeds; model.state.seed = seeds.terrain; feedback.syncAllUI(); });
    }
    function setWalkSettings(patch: Partial<WalkSettings>) {
        const settings = validateWalkSettings({ ...model.walkSettings, ...patch });
        history.transaction('Настройки прогулки', () => { Object.assign(model.walkSettings, settings); feedback.syncAllUI(); });
    }
    function setPreferences(patch:Partial<Pick<EditorState,'graphicFilter'|'waterReflections'|'quality'|'exposure'|'contactAO'|'soundEnabled'|'soundVolume'|'ambienceVolume'|'footstepVolume'|'soilMoisture'|'clearingAmount'>>) {
        const validated=validateState({...model.state,...patch});history.transaction('Настройки окружения',()=>{Object.assign(model.state,validated);feedback.syncAllUI();});
    }
    return { addObject, updateObject, removeObject, removeObjects, duplicateObjects, groupObjects, ungroupObjects, replaceWorld, setSeeds, setWalkSettings,setPreferences };
}
export type WorldEdits = ReturnType<typeof createWorldEdits>;
