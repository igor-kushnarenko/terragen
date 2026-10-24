import {plantGeometry,FINE_PLANT_IDS} from './plant-geometry';
import * as T from 'three';
import { mulberry32 } from './noise';
import { HALF, SIZE, SPLAT_RES, type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import { createEcology, FootprintIndex, objectFootprint, type EcologySystem } from './ecology';
import { qualityProfile } from './quality';
import type {EnvironmentMaterials} from './environment-materials';
import {createJungleHabitat,CanopyIndex} from './jungle-habitat';
export const FOLIAGE_CHUNK = 12;
export const MAX_FOLIAGE_INSTANCES = 20000;
export function foliageSeed(seed: number, x: number, z: number) { return (seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ 0x5ac39e71) >>> 0; }
export function jungleGroundContext(model:EditorModel,terrain:Pick<TerrainSystem,'getH'|'getNormalY'>){const canopy=new CanopyIndex();for(const o of model.world.objects)if(o.source!=='scatter'||model.state.showScatter)canopy.add(o);return {canopy,habitat:createJungleHabitat(model,terrain)};}
export function foliagePoints(model: EditorModel, terrain: Pick<TerrainSystem, 'getH' | 'getNormalY'>, cx: number, cz: number, ecology: EcologySystem = createEcology(model,terrain), occupied?: FootprintIndex,jungle?:ReturnType<typeof jungleGroundContext>) {
    const random = mulberry32(foliageSeed(model.seeds.scatter, cx, cz));
    const result: { x: number; y: number; z: number; yaw: number; scale: number; kind: number }[] = [];
    const tropical=model.world.preset==='jungle'&&!!model.world.recipe?.jungle||model.world.biomes.some(b=>b.kind==='jungle');
    if(tropical)jungle??=jungleGroundContext(model,terrain);
    for (let i = 0; i < Math.round(128 * model.state.foliageDensity * qualityProfile(model).foliageDensity); i++) {
        const x = (cx + random()) * FOLIAGE_CHUNK, z = (cz + random()) * FOLIAGE_CHUNK, h = terrain.getH(x, z);
        const yaw = random() * Math.PI * 2, scale = 0.65 + random() * 0.8, choice = random();
        if (Math.abs(x) >= HALF - 1 || Math.abs(z) >= HALF - 1 || h < model.state.water + 0.8 || h > model.state.snowLine - 4 || terrain.getNormalY(x, z) < 0.78) continue;
        const painted=(Math.floor((z+HALF)/SIZE*SPLAT_RES)*SPLAT_RES+Math.floor((x+HALF)/SIZE*SPLAT_RES))*4;
        if(model.splatDetail[painted+1]+model.splatDetail[painted+2]>160)continue;
        const e = ecology.sample(x,z);
        if (!e.dry || ecology.pathClearance(x,z)<0.45 || occupied?.query(x,z).some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+0.15 && h+0.5>p.minY && h<p.maxY)) continue;
        if(tropical&&jungle){
            const j=jungle.habitat.sample(x,z);if(j.weight>.05){
                const shade=jungle.canopy.sample(x,z).shade;
                if(random()>(.14+(1-shade)*.70+j.shore*.2)*(.4+j.j.understory*.6))continue;
                const moss=j.moisture*shade*.15,fungi=j.moisture*shade*.055,fern=.28+j.moisture*.22+j.shore*.15;
                const kind=choice<moss?3:choice<moss+fungi?5:choice<moss+fungi+fern?(random()<.5?2:7):choice>.92?6:4;
                result.push({x,y:h,z,yaw,scale:scale*(kind===2||kind===7?1.6:1),kind});continue;
            }
        }
        const flower = e.kind==='meadow'||e.kind==='valley'?0.24:e.kind==='coast'?0.04:0.09, fern=e.moisture*e.forest*(model.world.preset==='jungle'?.75:.32),moss=e.moisture*e.forest*0.2;
        result.push({ x, y: h, z, yaw, scale, kind: choice < moss ? 3 : choice < moss+fern ? 2 : choice < moss+fern+flower ? 1 : 0 });
    }
    return result;
}
export function createFineFoliage(model: EditorModel, terrain: TerrainSystem, scene: T.Scene,environment?:EnvironmentMaterials) {
    const geometries = FINE_PLANT_IDS.map((_,i)=>plantGeometry(i)), range = { value: model.state.foliageDistance };
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, side: T.DoubleSide });
    material.onBeforeCompile = shader => {
        shader.uniforms.uFoliageRange = range;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPlantWorld;')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\n vPlantWorld = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFoliageRange; varying vec3 vPlantWorld;')
            .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
              float density = 1.0 - smoothstep(uFoliageRange * 0.65, uFoliageRange, length(cameraPosition - vPlantWorld));
              if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233))) * 43758.5453) > density) discard;`);
    };
    environment?.decorate(material,2);
    const chunks = new Map<string, T.InstancedMesh[]>(); let signature = '';
    const ecology=createEcology(model,terrain);let occupied=new FootprintIndex();
    let jungle:ReturnType<typeof jungleGroundContext>|undefined;
    let objects=model.world.objects,biomes=model.world.biomes,routes=model.world.routes,bodies=model.world.waterBodies;
    const settingsKey=()=>`${model.seeds.scatter}/${model.state.foliageDensity}/${model.state.water}/${model.state.snowLine}/${model.state.quality}/${model.state.soilMoisture}/${model.state.clearingAmount}/${model.state.showScatter}/${JSON.stringify(model.world.recipe?.jungle?['variant','canopy','emergents','understory','vines','moisture','clearings'].map(k=>model.world.recipe!.jungle![k as keyof import('./jungle-settings').JungleSettings]):null)}`;
    let configuration='';
    function remove(key: string) { const meshes = chunks.get(key); meshes?.forEach(mesh => { scene.remove(mesh); mesh.dispose(); }); chunks.delete(key); }
    function clear() { for (const key of [...chunks.keys()]) remove(key); }
    function indexObjects(){occupied=new FootprintIndex();for(const item of model.world.objects)if(item.source!=='scatter'||model.state.showScatter)occupied.insert(objectFootprint(item,terrain,false));objects=model.world.objects;jungle=model.world.recipe?.jungle||model.world.biomes.some(b=>b.kind==='jungle')?jungleGroundContext(model,terrain):undefined;}
    function invalidateRegions(rects:readonly (readonly [number,number,number,number])[]){
        if(configuration!==settingsKey()||biomes!==model.world.biomes||routes!==model.world.routes||bodies!==model.world.waterBodies)return;
        const ranges=rects.map(([i0,j0,i1,j1])=>[-HALF+(i0-1)*model.cell,-HALF+(j0-1)*model.cell,-HALF+(i1+1)*model.cell,-HALF+(j1+1)*model.cell]);
        const current=new Set(model.world.objects.map(o=>o.id));for(const item of objects)if(!current.has(item.id)){const p=objectFootprint(item,terrain,false),r=p.radius+1;ranges.push([p.x-r,p.z-r,p.x+r,p.z+r]);}
        for(const key of chunks.keys()){const [x,z]=key.split(',').map(Number);if(ranges.some(([x0,z0,x1,z1])=>x*FOLIAGE_CHUNK<=x1&&(x+1)*FOLIAGE_CHUNK>=x0&&z*FOLIAGE_CHUNK<=z1&&(z+1)*FOLIAGE_CHUNK>=z0))remove(key);}
        signature=`${model.terrainRevision}/${configuration}`;indexObjects();
    }
    function update(camera: T.Camera, dt: number) {
        void dt;range.value = Math.min(model.state.foliageDistance,qualityProfile(model).foliageDistance);
        const current = `${model.terrainRevision}/${settingsKey()}`;
        if (current !== signature || objects!==model.world.objects || biomes!==model.world.biomes || routes!==model.world.routes || bodies!==model.world.waterBodies) {
            clear();signature=current;configuration=settingsKey();biomes=model.world.biomes;routes=model.world.routes;bodies=model.world.waterBodies;indexObjects();
        }
        if (!model.state.showFoliage || model.state.foliageDensity === 0 || Math.abs(camera.position.x) > HALF || Math.abs(camera.position.z) > HALF || camera.position.y - terrain.getH(camera.position.x, camera.position.z) > 35) { clear(); return; }
        const radius = range.value, cx = Math.floor(camera.position.x / FOLIAGE_CHUNK), cz = Math.floor(camera.position.z / FOLIAGE_CHUNK), span = Math.ceil(radius / FOLIAGE_CHUNK);
        const wanted = new Set<string>(), candidates: { x: number; z: number; distance: number }[] = [];
        for (let z = cz - span; z <= cz + span; z++) for (let x = cx - span; x <= cx + span; x++) {
            const distance = Math.hypot((x + 0.5) * FOLIAGE_CHUNK - camera.position.x, (z + 0.5) * FOLIAGE_CHUNK - camera.position.z);
            if (distance < radius + FOLIAGE_CHUNK) candidates.push({ x, z, distance });
        }
        candidates.sort((a, b) => a.distance - b.distance); let budget = MAX_FOLIAGE_INSTANCES,built=0;const started=performance.now();
        for (const candidate of candidates) {
            const key = `${candidate.x},${candidate.z}`, existing = chunks.get(key);
            if (budget <= 0) break;
            wanted.add(key);
            if (existing) {
                const count = existing.reduce((sum, mesh) => sum + mesh.count, 0);
                if (count <= budget) { budget -= count; continue; }
                remove(key);
            }
            // Spread regeneration over frames instead of recreating the entire
            // camera neighbourhood in the frame that receives an impact.
            if(built>=6||built>0&&performance.now()-started>3)continue;built++;
            const points = foliagePoints(model, terrain, candidate.x, candidate.z,ecology,occupied,jungle).slice(0, budget), meshes: T.InstancedMesh[] = [];
            for (let kind = 0; kind < geometries.length; kind++) {
                const data = points.filter(point => point.kind === kind); if (!data.length) continue;
                const mesh = new T.InstancedMesh(geometries[kind], material, data.length), matrix = new T.Matrix4(); mesh.receiveShadow = true;
                data.forEach((point, i) => {
                    matrix.compose(new T.Vector3(point.x, point.y + 0.015, point.z), new T.Quaternion().setFromEuler(new T.Euler(0, point.yaw, 0)), new T.Vector3(point.scale, point.scale, point.scale)); mesh.setMatrixAt(i, matrix);
                });
                mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh); meshes.push(mesh);
            }
            chunks.set(key, meshes); budget -= points.length;
        }
        for (const key of [...chunks.keys()]) if (!wanted.has(key)) remove(key);
    }
    return { update, clear, invalidateRegions, dispose() { clear(); material.dispose(); geometries.forEach(geometry => geometry.dispose()); },
        get statistics() { return { chunks: chunks.size, instances: [...chunks.values()].flat().reduce((sum, mesh) => sum + mesh.count, 0) }; } };
}
