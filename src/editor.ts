import { createCollisions, initializeRapier } from './collisions';
import { initializeModelLibrary } from './model-library';
import { createFineFoliage } from './fine-foliage';
import { createContactShading } from './contact-shading';
import { createNatureAudio } from './nature-audio';
import { createLandscape } from './landscape';
import { createTrailTool } from './trail-tool';
import { createLandscapeInterface } from './landscape-ui';
import { createLandscapeView } from './landscape-view';
import { createAutosave } from './autosave';
import { createWalkInterface } from './walk-ui';
import { createWalkLights } from './walk-lights';
import { createWalkScenarios } from './walk-scenarios';
import {createBalloonScenario} from './balloon-scenario';
import {createBalloonInterface} from './balloon-ui';
import {createWaterSurface} from './water-surface';
import {createWaterInteractions} from './water-interactions';
import {createWaterRendering} from './water-rendering';
import {createWaterEdits} from './water-edits';
import {createWaterEditor} from './water-editor';
import {createObjectEditor} from './object-editor';
import {createVegetationBrush} from './vegetation-brush';
import {createEnvironment} from './environment';
import {createPhotoMode} from './photo-mode';
import {createVR} from './vr';
import { createLibraryInterface } from './library-ui';
import { createWorldPreviewCache } from './preview';
import { openWorldRepository, type WorldRepository } from './world-library';
import {createAssetVault} from './asset-vault';
import { createTerrainJobs } from './worker-client';
import * as THREE from 'three';
import { createBrush } from './brushes';
import { createControls } from './controls';
import { createWorldEdits } from './edits';
import { createFeedback } from './feedback';
import { createGeneration } from './generation';
import { createHistory } from './history';
import { createLighting } from './lighting';
import { createMaterials } from './materials';
import { countSceneObjects, FrameMeter, type FrameSample, type FrameCounters } from './performance';
import { FixedStepClock } from './physics';
import { createRendering } from './rendering';
import { createModel, HALF, type EditorActions } from './state';
import { createStorage } from './storage';
import './styles.css';
import { createTerrain } from './terrain';
import { createInterface } from './ui';
import { createVegetation } from './vegetation';
import { createWeather } from './weather';
import {createWorldGeneration,defaultWorldRequest} from './world-generation';
import {createWorldStudio,type WorldStudio} from './world-studio';
import {WORLD_PRESETS,isWorldPreset} from './world-recipes';
import {createWorkspace} from './workspace';
import {createJungleInterface} from './jungle-ui';
import {createTaigaInterface} from './taiga-ui';
import type {LandscapePresetId} from './world';
export interface EditorOptions {
    repository?: () => Promise<WorldRepository>;
    beforePhysics?: (dt:number) => void;
    onFrame?: (timestampMs:number, elapsed:number, counters:FrameCounters, cpuMs:number) => void;
}
export function createEditor(options:EditorOptions = {}) {
    let repositoryConnection:Promise<WorldRepository>|undefined;
    const repository=()=>repositoryConnection??=(options.repository??(()=>openWorldRepository()))();
    const assetVault=createAssetVault(repository);
    const model = createModel();
    const physicsClock = new FixedStepClock();
    let lastFrame: number | undefined,environmentUITime=0;
    const feedback = createFeedback(model);
    const render = createRendering(model);
    const materials = createMaterials(model, render);
    const terrain = createTerrain(model, render, materials);
    const vegetation = createVegetation(model, render, terrain, feedback,materials.environment);
    const brushes = createBrush(model, terrain, materials, vegetation);
    const history = createHistory(model, feedback, terrain, materials, vegetation, brushes);
    const lighting = createLighting(model, render, materials);
    const weather = createWeather(model, render, feedback, materials, lighting);
    const environment=createEnvironment(model,terrain,render,materials.environment);
    const waterSurface=createWaterSurface(model,terrain.getH);
    const waterRendering=createWaterRendering(model,render,materials,waterSurface,terrain.getH);
    const jobs=createTerrainJobs();
    const generation = createGeneration(model, feedback, history, terrain, vegetation, jobs, brushes.endStroke);
    // These callbacks are invoked only after all systems and the UI are ready.
    const actions: EditorActions = {
        generateAll(skipUndo = false, prepare) {
            input.cancelTerrainTool();
            return generation.runGeneration(() => {
                terrain.buildTerrain();
                model.splat.fill(0); model.splatDetail.fill(0);
                materials.splatTex.needsUpdate = true; materials.detailTex.needsUpdate = true;
                materials.updateWater();
                terrain.updateMeshAll();
                if (model.world.objects.some(item => item.source === 'scatter')) vegetation.scatter();
                else vegetation.snapScatter();
                feedback.syncAllUI();
            }, skipUndo, prepare);
        },
        applyAll() {
            materials.updateBiomes();
            lighting.updateSun(true);
            lighting.updateFog();
            materials.updateWater();
            materials.updateMaterial();
            lighting.updateShadows();
            render.setLeftButton();
            ui.refreshTools();
            materials.terrainUniforms.uBrushRadius.value = model.state.radius;
            materials.terrainUniforms.uBrushFalloff.value = model.state.falloff;
            vegetation.setVisibilityScatter();
            weather.setWeather(model.state.weather, true);
        },
    };
    const storage = createStorage(model, terrain, feedback, history, materials, vegetation, render, actions,assetVault);
    const collisions = createCollisions(model, terrain);
    const waterInteractions=createWaterInteractions(model,waterSurface,collisions,render);
    let floatMode=false;
    const foliage = createFineFoliage(model, terrain, render.scene,materials.environment);
    const contacts=createContactShading(model,terrain,materials.terrainUniforms.uContactMap);
    const audio=createNatureAudio(model,terrain,collisions.surfaceAt);
    vegetation.bindChange(materials.updateForestCover);
    const input = createControls(model, terrain, render, materials, brushes, feedback, history, actions, id => ui.setTool(id), collisions.motion,waterSurface.sample);
    const edits = createWorldEdits(model, history, terrain, vegetation, feedback);
    const ui = createInterface(model, feedback, actions, history, generation, materials, render, brushes, lighting, vegetation, storage, input, weather, edits,audio);
    const landscape=createLandscape(model,terrain,materials,vegetation,history,feedback,jobs,kind=>{
        brushes.endStroke();input.clearKeys();if(kind!=='trail')input.cancelTerrainTool();if(input.walk.on)input.setWalkPanel(true);
    });
    const worldGeneration=createWorldGeneration(model,terrain,materials,vegetation,history,feedback,jobs,()=>{
        vr.stop();
        brushes.endStroke();input.cancelTerrainTool();input.clearKeys();scenarios.stop();balloon.stop();photo.exit();input.setWalk(false);
    },createTerrainJobs());
    let worldStudio:WorldStudio|undefined;
    const trailTool=createTrailTool(model,render,terrain,input,feedback,landscape,()=>ui.setTool('camera'));
    const landscapeView=createLandscapeView(model,terrain,render.scene);
    createLandscapeInterface(model,landscape,trailTool,input,render,terrain,feedback,edits);
    const waterEdits=createWaterEdits(model,terrain,vegetation,materials,history,feedback,jobs);
    createWaterEditor(model,render,terrain,input,feedback,waterEdits,()=>ui.setTool('camera'));
    const objectEditor=createObjectEditor(model,render,terrain,vegetation,input,edits,history,feedback,()=>ui.setTool('camera'));
    createVegetationBrush(model,render,terrain,vegetation,input,history,feedback,()=>ui.setTool('camera'));
    const scenarios=createWalkScenarios(model,render,terrain,vegetation,materials,history,input,audio,feedback,rects=>{foliage.invalidateRegions(rects);contacts.invalidateRegions(rects);});
    createWalkInterface(model, input, edits, feedback,audio,scenarios);
    const walkLights=createWalkLights(model,render.scene,render.camera);
    const photo=createPhotoMode(model,render,input,edits,history,feedback,()=>{waterRendering.update(Infinity);waterRendering.draw();});
    const balloon=createBalloonScenario(model,terrain,render,input,collisions,audio,feedback,()=>autosave.markDirty(),()=>{scenarios.stop();photo.exit();history.flush();});
    createBalloonInterface(balloon,input);
    scenarios.bindBeforeStart(()=>balloon.stop());
    audio.bindStatus(()=>feedback.syncUI('audioState'));
    brushes.bindEndStroke(() => history.flush());
    storage.bindView(photo.persistentView, view => { vr.stop();scenarios.stop();photo.exit();input.restoreView(view);audio.reset();balloon.synchronize();waterInteractions.reset(); physicsClock.reset(); lastFrame = undefined; });
    history.bindRefresh(() => { scenarios.stop();actions.applyAll(); feedback.syncAllUI(); input.synchronize();audio.reset();balloon.synchronize();waterInteractions.reset(); physicsClock.reset(); lastFrame = undefined; });
    feedback.bindHistory(() => history.undoDepth, () => history.redoDepth, () => history.undoLabel, () => history.redoLabel);
    terrain.buildTerrain(); terrain.updateMeshAll(); actions.applyAll(); lighting.updateEnv();
    const preview=createWorldPreviewCache(model);
    const autosave = createAutosave({ model, history, storage, repository,
        preview: preview.get, viewKey: () => JSON.stringify([photo.persistentView(),Math.floor(model.state.dayTime*60),Math.round(model.state.wetness*20)]),
        newWorld: async () => {
            const generated=await worldGeneration.generate(worldStudio?.request()??defaultWorldRequest());
            if(generated)input.resetCamera();
            return generated;
        },
    });
    createLibraryInterface(autosave, model, feedback,()=>worldStudio?.selectNew());
    worldStudio=createWorldStudio(model,worldGeneration,feedback,async()=>{
        const request=worldStudio!.request(),previousId=autosave.status.id;
        if(autosave.status.available){await autosave.newWorld();if(previousId!==autosave.status.id)autosave.rename(WORLD_PRESETS[request.preset].name+' · '+request.seed);}
        else await worldGeneration.generate(request);
    });
    createJungleInterface(model,terrain,history,vegetation,materials,feedback,settings=>worldStudio!.selectJungle(settings));
    createTaigaInterface(model,terrain,history,vegetation,materials,feedback,settings=>worldStudio!.selectTaiga(settings));
    createWorkspace(model,feedback,ui,input,render,autosave);
    const vr=createVR(model,render,input,collisions,vegetation,edits,history,feedback,()=>autosave.saveNow(true),()=>{photo.exit();balloon.stop();scenarios.stop();history.flush();});
    const cancelGeneration=()=>{generation.cancelOperation();worldGeneration.cancel();};
    document.getElementById('btnCancelOperation')!.addEventListener('click', cancelGeneration);
    window.addEventListener('keydown', event => { if ((model.busy||worldGeneration.previewing) && event.key === 'Escape') cancelGeneration(); });
    feedback.setBusy(true);
    const ready = (async () => {
        await Promise.all([initializeRapier(), initializeModelLibrary()]);
        const restored = await autosave.initialize();
        feedback.setBusy(false);
        if (!restored) {
            await worldGeneration.generate(defaultWorldRequest(),true);
            autosave.markDirty();
        }
        if(restored)vegetation.rebuild(); materials.updateForestCover();
        ui.setTool('camera');
        feedback.syncAllUI(); feedback.updateUndoButtons();
        feedback.setStatus(restored ? 'Последняя сессия восстановлена' : 'Готово. ЛКМ — кисть, ПКМ — вращение, H — справка');
    })().catch(error => { feedback.setBusy(false); feedback.setStatus('Ошибка: ' + String(error)); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { history.flush(); autosave.markDirty(); void autosave.saveNow().catch(() => {}); } });
    window.addEventListener('pagehide', () => { history.flush(); autosave.markDirty(); void autosave.saveNow().catch(() => {}); });
    const meter = new FrameMeter();
    let statistics: FrameSample = { fps: 0, frameTimeMs: 0, calls: 0, triangles: 0, objects: 0 };
    const coord = document.getElementById('coord')!;
    render.renderer.info.autoReset = false;
    const resetClock = () => { meter.reset(); physicsClock.reset(); lastFrame = undefined; input.clearKeys(); };
    document.addEventListener('visibilitychange', resetClock);
    window.addEventListener('blur', resetClock);
    function animate(timestamp: number,frame?:XRFrame) {
        const cpuStart=performance.now();
        const elapsed = lastFrame === undefined ? 0 : (timestamp - lastFrame) / 1000;
        lastFrame = timestamp;
        const dt = Math.max(0, Math.min(elapsed, 1));
        vr.beforeFrame(frame);
        balloon.update(dt,photo.active);
        render.renderer.info.reset();
        const alpha = physicsClock.advance(dt, step => { options.beforePhysics?.(step);
            if(!model.busy&&!photo.frozen){waterInteractions.step(step,input.walk,weather.soundWeather.rain);
                if(input.walk.on&&!input.walk.paused&&!photo.active){if(!floatMode){collisions.rebuild();floatMode=true;}collisions.stepWater(step,waterSurface.sample);}
                else if(!input.walk.on&&floatMode){collisions.rebuild();floatMode=false;}}
            if(photo.active){input.flyUpdate(step);return;}if (input.walk.on) {
            input.walkUpdate(step);if(!balloon.seated)audio.physicsStep(step,input.walk);
        }
        else
            input.flyUpdate(step); });
        if (input.walk.on&&!photo.active)
            input.renderWalk(alpha);
        else
            render.controls.update(dt);
        vr.renderFrame(alpha);
        const interaction = brushes.interaction;
        if (input.walk.on||photo.active) {
            if (!interaction.painting)
                interaction.hoverHit = null;
        }
        else if (input.picking.on) {
            interaction.hoverHit = null; input.previewStart();
        }
        else if(trailTool.state.active){interaction.hoverHit=null;}
        else if (interaction.mouseInside && model.state.tool !== 'camera' && !model.busy) {
            brushes.raycaster.setFromCamera(brushes.mouse, render.camera);
            const hit = terrain.raycastTerrain(brushes.raycaster.ray);
            if (hit || !interaction.painting)
                interaction.hoverHit = hit;
        }
        else if (!interaction.painting)
            interaction.hoverHit = null;
        const hit = interaction.hoverHit;
        if (hit) {
            materials.terrainUniforms.uBrushPos.value.copy(hit);
            materials.terrainUniforms.uBrushOn.value = 1;
            if (!input.walk.on)
                coord.textContent = `x ${hit.x.toFixed(0)}  z ${hit.z.toFixed(0)}  h ${hit.y.toFixed(1)} м`;
            if (interaction.painting) {
                brushes.applyBrush(hit, dt);
                interaction.texTimer += dt;
                if (interaction.texTimer > 0.12 && interaction.strokeDirty) {
                    terrain.updateHeightTex();
                    interaction.texTimer = 0;
                }
            }
        }
        else
            materials.terrainUniforms.uBrushOn.value = 0;
        const environmentDt=photo.frozen?0:dt;

        lighting.update(environmentDt);weather.atmosUpdate(environmentDt);environment.update(environmentDt,weather.soundWeather.rain);
        environmentUITime+=dt;if(environmentUITime>=1){environmentUITime=0;feedback.syncUI('environmentStatus');if(model.state.dayCycle){feedback.syncUI('dayTime');feedback.syncUI('sunEl');feedback.syncUI('sunAz');}}
        lighting.updateView(terrain,input.walk.on);
        photo.update(dt);
        scenarios.update(dt,weather.soundWeather.rain,photo.active);
        balloon.render(alpha,photo.active);
        vegetation.renderFloating(input.walk.on?collisions.floating:null,input.walk.paused||photo.active?1:alpha);
        vegetation.updateAnimations(model.busy||input.walk.on&&input.walk.paused||photo.frozen?0:dt);
        terrain.updateView(render.camera,input.walk.on?null:hit,render.renderer.domElement.clientHeight);vegetation.updateView(render.camera);
        landscapeView.update(dt,input.walk.on||photo.active);
        objectEditor.update();
        if (!model.busy) { foliage.update(render.camera, dt);contacts.update(dt); }
        audio.update(dt,render.camera,input.walk,weather.soundWeather);
        walkLights.update(dt,input.walk.on,input.walk.paused);
        if(photo.active||balloon.state?.options.external&&balloon.seated)walkLights.held.visible=false;
        waterInteractions.update();waterRendering.update(dt);
        waterRendering.draw();
        const counters={ calls: render.renderer.info.render.calls, triangles: render.renderer.info.render.triangles, objects: countSceneObjects(render.scene) };
        options.onFrame?.(timestamp,elapsed,counters,performance.now()-cpuStart);
        const sample = meter.record(timestamp,counters);
        if (sample) {
            statistics = sample;
            document.getElementById('fps')!.textContent = sample.fps.toFixed(0);
            document.getElementById('frameTime')!.textContent = sample.frameTimeMs.toFixed(1);
            document.getElementById('calls')!.textContent = sample.calls.toLocaleString('ru-RU');
            document.getElementById('objects')!.textContent = sample.objects.toLocaleString('ru-RU');
            document.getElementById('tris')!.textContent = sample.triangles.toLocaleString('ru-RU');
            document.getElementById('chunks')!.textContent = `${terrain.statistics?.visible??0}/${terrain.statistics?.total??0} · лес ${vegetation.statistics.visible}/${vegetation.statistics.total}`;
        }
    }
    render.renderer.setAnimationLoop(animate);
    return {
        ready, autosave, vr, state: model.state, ...actions, ...generation,
        scatter: () => history.transaction('Расстановка объектов', () => vegetation.scatter()),
        clearScatter: () => history.transaction('Убрать расстановку', vegetation.clearScatter),
        undo: history.undo, redo: history.redo, setTool: ui.setTool, getH: terrain.getH,
        worldActions: edits,
        waterActions:waterEdits,
        generatePreset:(preset:LandscapePresetId)=>isWorldPreset(preset)?worldGeneration.generate({...defaultWorldRequest(),preset,seed:model.state.seed,N:model.state.N,areaSize:model.state.areaSize}):landscape.generatePreset(preset),composeLandscape:landscape.compose,buildTrail:landscape.buildTrail,
        generateWorld:worldGeneration.generate,previewWorld:worldGeneration.preview,cancelWorldGeneration:worldGeneration.cancel,
        get world() { return structuredClone(model.world); }, get seeds() { return { ...model.seeds }; },
        get operations() { return structuredClone(model.operations); }, get walkSettings() { return { ...model.walkSettings }; },
        get redoDepth() { return history.redoDepth; },
        buildOBJ: storage.buildOBJ, encodePNG16: storage.encodePNG16, decodePNG: storage.decodePNG,
        projectJSON: storage.projectJSON, loadProjectText: storage.loadProjectText,loadProjectFile:storage.loadProjectFile,buildProjectBlob:storage.buildProjectBlob,importModel:storage.importModel,
        get busy() { return model.busy; }, get undoDepth() { return history.undoDepth; }, get maxH() { return model.maxH; },
        photo,environment,scenarios,balloon,waterSurface,get statistics() { return { ...statistics, programs:render.renderer.info.programs?.length??0, scenarios:scenarios.statistics,balloon:balloon.statistics, preview:{...preview.statistics},foliage: foliage.statistics, terrain:terrain.statistics,vegetation:vegetation.statistics,water:{...waterRendering.statistics,...waterInteractions.statistics,floating:collisions.floating.size},audio:audio.statistics, colliders: collisions.colliderCount,collisionUpdates:collisions.statistics,contacts:contacts.statistics }; }, revision: THREE.REVISION,
        applyBrushAt(x: number, z: number, dt = 0.1) {
            const hit = new THREE.Vector3(x, terrain.getH(x, z), z);
            brushes.interaction.flattenH = hit.y;
            if (model.busy) return;
            history.transaction('Кисть: ' + model.state.tool, () => {
                brushes.applyBrush(hit, dt);
                terrain.recomputeRange();
                terrain.updateHeightTex();
                vegetation.snapScatter();
            });
        },
        setView(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
            render.camera.position.set(px, py, pz);
            render.controls.target.set(tx, ty, tz);
            render.controls.update();
        },
        syncAllUI: feedback.syncAllUI, setWalk: input.setWalk, chooseWalkStart: input.chooseStart, toggleAutoWalk: input.toggleAutoWalk, setWeather: weather.setWeather, walk: input.walk,
        updateSun: lighting.updateSun, syncUI: feedback.syncUI,
        atmos: { wCur: weather.wCur, starMat: weather.starMat, clouds: weather.clouds, rain: weather.rain, snow: weather.snow },
        setWalkView(x: number, z: number, yawDeg: number, pitchDeg = 0) {
            if(balloon.seated)balloon.stop();
            const spot = input.findLand(x, z);
            if (!spot) return false;
            const [lx, lz] = spot;
            if (!input.walk.on && !input.setWalk(true, [lx, lz])) return false;
            input.walk.feet.set(lx, terrain.getH(lx, lz), lz);
            input.walk.start = input.walk.feet.clone();
            input.walk.yaw = THREE.MathUtils.degToRad(yawDeg);
            input.walk.pitch = THREE.MathUtils.degToRad(pitchDeg);
            input.synchronize();
            return true;
        },
        findWalkSpot() {
            let best: [
                number,
                number,
                number
            ] | null = null;
            for (let z = -HALF + 40; z < HALF - 40; z += 8)
                for (let x = -HALF + 40; x < HALF - 40; x += 8) {
                    const h = terrain.getH(x, z);
                    if (h < model.state.water + 3 || h > model.state.water + 25 || !input.starts.assess(x, z).safe)
                        continue;
                    const score = Math.abs(terrain.getH(x + 4, z) - terrain.getH(x - 4, z)) + Math.abs(terrain.getH(x, z + 4) - terrain.getH(x, z - 4)) + Math.hypot(x, z) * 0.002;
                    if (!best || score < best[2])
                        best = [x, z, score];
                }
            return best;
        },
    };
}
