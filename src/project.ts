import { readGLB, base64Binary, MAX_ASSET_TOTAL, MAX_ASSET_BYTES } from './asset-format';
import {validAssetKey} from './asset-vault';
import {validateBalloon,type BalloonState} from './balloon-state';
import { BUILTIN_INFO } from './model-shapes';
import {validWaterOutline} from './water-math';
import {validateJungle} from './jungle-settings';
import {validateTaiga} from './taiga-settings';
import type { WalkPose } from './physics';
import { createModel, RESOLUTIONS, SIZE, SPLAT_RES, type EditorModel, type EditorState } from './state';
import { DEFAULT_WALK_SETTINGS, MAX_WORLD_OBJECTS, MAX_ANIMATED_OBJECTS, WORLD_PRESET_IDS, deriveSeeds, type ObjectAnimation, type OperationRecord, type OperationSeeds, type Vec2, type Vec3, type WalkSettings, type WorldData } from './world';
export const PROJECT_VERSION = 11;
function validateObjectAnimation(value:unknown,path:string):ObjectAnimation {
    const a=object(value,path);return {clip:number(a.clip,path+'.clip',-1,127,true),playing:bool(a.playing,path+'.playing'),speed:number(a.speed,path+'.speed',.1,4),loop:choice(a.loop,['repeat','once'],path+'.loop'),time:number(a.time,path+'.time',0,86400),...(a.restart===undefined?{}:{restart:number(a.restart,path+'.restart',0,0xffffffff,true)})};
}
export interface ProjectView {
    camera: {
        pos: Vec3;
        target: Vec3;
        rotation: Vec3;
        near: number;
    };
    walk: WalkPose | null;
}
export interface DocumentSnapshot {
    state: EditorState;
    heights: Float32Array;
    splat: Uint8Array;
    splatDetail: Uint8Array;
    world: WorldData;
    seeds: OperationSeeds;
    operations: OperationRecord[];
    walkSettings: WalkSettings;
    balloon:BalloonState|null;
}
export interface DecodedProject extends DocumentSnapshot {
    version: 11;
    sourceVersion: number;
    embeddedAssets: {id:string;blob:Blob}[];
    view: ProjectView;
    legacyScatter: boolean;
}
export function captureDocument(model: EditorModel): DocumentSnapshot {
    return { state: { ...model.state }, heights: model.heights.slice(), splat: model.splat.slice(), splatDetail: model.splatDetail.slice(),
        world: structuredClone(model.world), seeds: { ...model.seeds }, operations: structuredClone(model.operations), walkSettings: { ...model.walkSettings },balloon:structuredClone(model.balloon) };
}
export function applyDocument(model: EditorModel, snapshot: DocumentSnapshot) {
    Object.assign(model.state, snapshot.state);
    model.N = snapshot.state.N;
    model.n = model.N + 1;
    model.cell = SIZE / model.N;
    model.heights = snapshot.heights.slice();
    // Keep the DataTexture's backing array identity.
    model.splat.set(snapshot.splat); model.splatDetail.set(snapshot.splatDetail);
    model.world = structuredClone(snapshot.world);
    model.seeds = { ...snapshot.seeds };
    model.operations = structuredClone(snapshot.operations);
    Object.assign(model.walkSettings, snapshot.walkSettings);
    model.balloon=structuredClone(snapshot.balloon);
}
export function bytesToBase64(bytes: Uint8Array) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}
function heightBytes(heights: Float32Array) {
    const bytes = new Uint8Array(heights.length * 4), view = new DataView(bytes.buffer);
    heights.forEach((height, i) => view.setFloat32(i * 4, height, true));
    return bytes;
}
export function encodeProject(model: EditorModel, view: ProjectView) {
    return JSON.stringify({ app: 'terrain-editor', version: PROJECT_VERSION, date: new Date().toISOString(), size: SIZE,
        state: model.state, heights: bytesToBase64(heightBytes(model.heights)), heightEncoding: 'float32-le',
        splatRes: SPLAT_RES, splat: bytesToBase64(model.splat), splatDetail: bytesToBase64(model.splatDetail), world: model.world,
        seeds: model.seeds, operations: model.operations, walkSettings: model.walkSettings,balloon:model.balloon, view });
}
function fail(path: string): never { throw new Error(`Неверный проект: ${path}`); }
function object(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(path);
    return value as Record<string, unknown>;
}
function number(value: unknown, path: string, min = -60000, max = 60000, integer = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value))
        fail(path);
    return value;
}
function bool(value: unknown, path: string): boolean { if (typeof value !== 'boolean')
    fail(path); return value; }
function text(value: unknown, path: string, max = 128): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail(path);
    return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
    if (!values.includes(value as T))
        fail(path);
    return value as T;
}
function list(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max)
        fail(path);
    return value;
}
function vec3(value: unknown, path: string, min = -60000, max = 60000): Vec3 {
    const values = list(value, path, 3);
    if (values.length !== 3)
        fail(path);
    return values.map((v, i) => number(v, `${path}[${i}]`, min, max)) as Vec3;
}
function vec2(value: unknown, path: string): Vec2 {
    const values = list(value, path, 2);
    if (values.length !== 2)
        fail(path);
    return values.map((v, i) => number(v, `${path}[${i}]`, -SIZE / 2, SIZE / 2)) as Vec2;
}
const ranges: Partial<Record<keyof EditorState, [
    number,
    number,
    boolean?
]>> = {
    N: [16, 512, true], seed: [0, 0xffffffff, true], scale: [0.05, 100], height: [0, 2000], octaves: [1, 12, true], sharp: [0, 20],
    warp: [0, 10], mountains: [0, 1], droplets: [0, 600, true], thermal: [0, 100, true], erosionStrength: [0, 1],
    areaSize: [0.125, 1], precipitation: [0, 2], fogIntensity: [0, 2],
    dayTime:[0,24],dayDuration:[2,120],lowFog:[0,2],wetness:[0,1],
    layer: [0, 8, true], radius: [0.1, 512], strength: [0, 1], falloff: [0, 1], snowLine: [-1000, 5000], rockSlope: [0, 1],
    water: [-1000, 5000], waterOpacity: [0, 1], wave: [0, 10], sunAz: [0, 360], sunEl: [-90, 90], fog: [0, 1],
    groundDetail: [0, 2], foliageDensity: [0, 1], foliageDistance: [10, 80],
    soilMoisture:[0,1],clearingAmount:[0,1],exposure:[0.2,2],contactAO:[0,0.6],soundVolume:[0,1],ambienceVolume:[0,1],footstepVolume:[0,1],
    treeDensity: [0, 1], rockDensity: [0, 1], windDir: [0, 360], windSpeed: [0, 10],
};
export function validateState(value: unknown, legacy = false, preV6 = true, preV8 = true): EditorState {
    const defaults = createModel().state, input = object(value, 'state');
    const result = {} as Record<keyof EditorState, unknown>;
    for (const key of Object.keys(defaults) as (keyof EditorState)[]) {
        const item = (legacy || preV8&&['dayTime','dayCycle','dayDuration','lowFog','wetness'].includes(key) || preV6 && ['areaSize','precipitation','fogIntensity'].includes(key) || ['waterReflections','groundDetail','foliageDensity','foliageDistance','showFoliage','soilMoisture','clearingAmount','quality','exposure','contactAO','soundEnabled','soundVolume','ambienceVolume','footstepVolume'].includes(key)) && input[key] === undefined ? defaults[key] : input[key];
        const range = ranges[key];
        if (range)
            result[key] = number(item, `state.${key}`, ...range);
        else if (typeof defaults[key] === 'boolean')
            result[key] = bool(item, `state.${key}`);
        else if (key === 'tool')
            result[key] = choice(item, ['camera', 'raise', 'lower', 'smooth', 'flatten', 'noise', 'paint'], 'state.tool');
        else if(key==='quality')result[key]=choice(item,['low','balanced','high'],'state.quality');
        else
            result[key] = choice(item, ['clear', 'partly', 'overcast', 'fog', 'rain', 'storm', 'snow'], 'state.weather');
    }
    if (!(RESOLUTIONS as readonly number[]).includes(result.N as number))
        fail('state.N');
    return result as unknown as EditorState;
}
export function validateSeeds(value: unknown, legacy = false): OperationSeeds {
    const input = object(value, 'seeds');
    return Object.fromEntries(['terrain', 'erosion', 'scatter', 'brush', 'composition'].map(key => [key, number(key === 'composition' && legacy && input[key] === undefined ? deriveSeeds(number(input.terrain, 'seeds.terrain', 0, 0xffffffff, true)).composition : input[key], `seeds.${key}`, 0, 0xffffffff, true)])) as unknown as OperationSeeds;
}
export function validateWalkSettings(value: unknown, preV6 = true): WalkSettings {
    const input = object(value, 'walkSettings');
    return { equippedLight: choice(preV6 && input.equippedLight === undefined ? DEFAULT_WALK_SETTINGS.equippedLight : input.equippedLight, ['none','flashlight','lantern'], 'walkSettings.equippedLight'),
        lightEnabled: bool(preV6 && input.lightEnabled === undefined ? DEFAULT_WALK_SETTINGS.lightEnabled : input.lightEnabled, 'walkSettings.lightEnabled'),
        speed: number(input.speed, 'walkSettings.speed', 0.1, 30), sprint: number(input.sprint, 'walkSettings.sprint', 1, 5),
        swimSpeed: number(input.swimSpeed, 'walkSettings.swimSpeed', 0.1, 15), eyeHeight: number(input.eyeHeight, 'walkSettings.eyeHeight', 0.5, 3),
        gravity: number(input.gravity, 'walkSettings.gravity', 0.1, 100), jumpSpeed: number(input.jumpSpeed, 'walkSettings.jumpSpeed', 0, 30),
        sensitivity: number(input.sensitivity, 'walkSettings.sensitivity', 0.0001, 0.02),
        fov: number(input.fov === undefined ? DEFAULT_WALK_SETTINGS.fov : input.fov, 'walkSettings.fov', 45, 110), bob: bool(input.bob, 'walkSettings.bob') };
}
export function validateWorld(value: unknown, state: EditorState, legacy = false, preV7 = true, preV8 = true): WorldData {
    const input = object(value, 'world');
    const ids = new Set<string>();
    function id(value: unknown, path: string) {
        const result = text(value, path, 64);
        if (!/^[a-zA-Z0-9_.-]+$/.test(result) || ids.has(result))
            fail(`${path}: повторный или неверный ID`);
        ids.add(result);
        return result;
    }
    const assetIds = new Set<string>(Object.keys(BUILTIN_INFO)),blobSizes=new Map<string,number>(); let total = 0;
    const assets = list(input.assets ?? [], 'world.assets', 20).map((item, i) => {
        const p = `world.assets[${i}]`, asset = object(item, p), assetId = text(asset.id, p + '.id', 64);
        if (!/^custom-[a-zA-Z0-9_.-]+$/.test(assetId) || assetIds.has(assetId)) fail(p + '.id');
        assetIds.add(assetId);
        const blob=text(asset.blob,p+'.blob',71);if(!validAssetKey(blob)||asset.glb!==undefined)fail(p+'.blob');
        const byteLength=number(asset.byteLength,p+'.byteLength',20,MAX_ASSET_BYTES,true),known=blobSizes.get(blob);
        if(known!==undefined&&known!==byteLength)fail(p+'.byteLength');
        if(known===undefined){blobSizes.set(blob,byteLength);total+=byteLength;}
        if (total > MAX_ASSET_TOTAL) fail('world.assets: не больше 512 МБ');
        return { id: assetId, name: text(asset.name, p + '.name'), blob,byteLength,
            ...(asset.normalize===undefined?{}:{normalize:bool(asset.normalize,p+'.normalize')}),
            category: choice(asset.category, ['tree', 'shrub', 'rock', 'wood', 'bridge', 'structure', 'animated'], p + '.category'),
            collider: choice(asset.collider, ['trunk', 'convex', 'mesh', 'none'], p + '.collider') };
    });
    const objects = list(input.objects, 'world.objects', MAX_WORLD_OBJECTS).map((item, i) => {
        const p = `world.objects[${i}]`, o = object(item, p);
        const position = vec3(o.position, `${p}.position`);
        if (Math.abs(position[0]) > SIZE / 2 || Math.abs(position[2]) > SIZE / 2)
            fail(`${p}.position`);
        return { id: id(o.id, `${p}.id`), asset: choice(o.asset, [...assetIds], `${p}.asset`), source: choice(o.source, ['manual', 'scatter', 'composition'], `${p}.source`),
            position, rotation: vec3(o.rotation, `${p}.rotation`, -1000, 1000), scale: vec3(o.scale, `${p}.scale`, 0.01, 100),
            groundOffset: number(o.groundOffset, `${p}.groundOffset`, -1000, 1000), followTerrain: bool(o.followTerrain, `${p}.followTerrain`), tint: number(o.tint, `${p}.tint`, 0.1, 3),
            ...(o.floating===undefined?{}:{floating:bool(o.floating,p+'.floating')}),...(o.density===undefined?{}:{density:number(o.density,p+'.density',.1,2)}),
            ...(o.animation===undefined?{}:{animation:validateObjectAnimation(o.animation,p+'.animation')}) };
    });
    if(objects.filter(o=>o.floating).length>64)fail('world.objects: не больше 64 плавающих предметов');
    const animatedAssets=new Set(assets.filter(a=>a.category==='animated').map(a=>a.id));
    if(objects.filter(o=>animatedAssets.has(o.asset)).length>MAX_ANIMATED_OBJECTS)fail('world.objects: не больше '+MAX_ANIMATED_OBJECTS+' анимированных объектов');
    for(const o of objects)if(o.floating&&(o.followTerrain||o.source==='scatter'))fail('world.objects: плавающий предмет не должен быть привязан к рельефу или расстановке');
    const grouped=new Set<string>(),objectIds=new Set(objects.map(o=>o.id));
    const groups=list(preV7&&input.groups===undefined?[]:input.groups,'world.groups',1000).map((item,i)=>{
        const p=`world.groups[${i}]`,g=object(item,p),members=list(g.objectIds,p+'.objectIds',MAX_WORLD_OBJECTS).map(v=>text(v,p+'.objectIds',64));
        if(members.length<2||members.some(v=>!objectIds.has(v)||grouped.has(v))||new Set(members).size!==members.length)fail(p+'.objectIds');
        members.forEach(v=>grouped.add(v));return {id:id(g.id,p+'.id'),name:text(g.name,p+'.name'),objectIds:members};
    });
    const biomes = list(input.biomes, 'world.biomes', 1000).map((item, i) => {
        const p = `world.biomes[${i}]`, b = object(item, p);
        const region = { id: id(b.id, `${p}.id`), name: text(b.name, `${p}.name`), kind: choice(b.kind, ['forest', 'coast', 'mountains', 'meadow', 'valley', 'jungle', 'taiga'], `${p}.kind`),
            center: vec2(b.center, `${p}.center`), radius: number(b.radius, `${p}.radius`, 0.1, SIZE) } as WorldData['biomes'][number];
        if(b.source!==undefined)region.source=choice(b.source,['composition'] as const,p+'.source');
        if(b.jungle!==undefined){try{region.jungle=validateJungle(b.jungle);}catch{fail(p+'.jungle');}}
        if(b.taiga!==undefined){try{region.taiga=validateTaiga(b.taiga);}catch{fail(p+'.taiga');}}
        return region;
    });
    const routes = list(input.routes, 'world.routes', 1000).map((item, i) => {
        const p = `world.routes[${i}]`, r = object(item, p), points = list(r.points, `${p}.points`, 1000).map((v, j) => vec2(v, `${p}.points[${j}]`));
        if (points.length < 2)
            fail(`${p}.points`);
        const route = { id: id(r.id, `${p}.id`), name: text(r.name, `${p}.name`), kind: choice(r.kind, ['trail', 'road'], `${p}.kind`), points, width: number(r.width, `${p}.width`, 0.1, 200) } as WorldData['routes'][number];
        if (r.controlPoints !== undefined) {
            route.controlPoints = list(r.controlPoints, p + '.controlPoints', 64).map((v,j) => vec2(v, `${p}.controlPoints[${j}]`));
            if (route.controlPoints.length < 2) fail(p + '.controlPoints');
            route.curve = choice(r.curve, ['centripetal'] as const, p + '.curve');
        } else if (r.curve !== undefined) fail(p + '.controlPoints');
        if (r.surface !== undefined) route.surface = choice(r.surface, ['soil', 'gravel', 'sand'] as const, p + '.surface');
        if (r.maxGrade !== undefined) route.maxGrade = number(r.maxGrade, p + '.maxGrade', 0.05, 0.7);
        if (r.source !== undefined) route.source = choice(r.source, ['manual', 'composition'] as const, p + '.source');
        return route;
    });
    const waterBodies = list(input.waterBodies, 'world.waterBodies', 33).map((item, i) => {
        const p = `world.waterBodies[${i}]`, w = object(item, p), kind = choice(w.kind, ['ocean', 'lake', 'river'], `${p}.kind`);
        const points = list(w.points, `${p}.points`, 1000).map((v, j) => vec2(v, `${p}.points[${j}]`));
        if (kind === 'lake' && points.length < 3 || kind === 'river' && points.length < 2 || kind === 'ocean' && points.length !== 0)
            fail(`${p}.points`);
        if(kind!=='ocean'&&!validWaterOutline(kind,points))fail(p+'.points: вырожденный или пересекающийся контур');
        const body:WorldData['waterBodies'][number]={ id: id(w.id, `${p}.id`), kind, points, level: number(w.level, `${p}.level`, -1000, 5000),
            opacity: number(w.opacity, `${p}.opacity`, 0, 1), wave: number(w.wave, `${p}.wave`, 0, 10), width: number(w.width, `${p}.width`, 0.1, 200) };
        if(w.name!==undefined)body.name=text(w.name,p+'.name');
        for(const [key,min,max]of [['endLevel',-1000,5000],['flowSpeed',0,3],['depth',.3,50],['bankWidth',1,40],['clarity',.2,40]] as const)if(w[key]!==undefined)body[key]=number(w[key],p+'.'+key,min,max);
        if(body.endLevel!==undefined&&body.endLevel>body.level)fail(p+'.endLevel: устье выше истока');
        if(w.flowDirection!==undefined){if(w.flowDirection!==1&&w.flowDirection!==-1)fail(p+'.flowDirection');body.flowDirection=w.flowDirection;}
        if(w.bankSurface!==undefined)body.bankSurface=choice(w.bankSurface,['sand','gravel'] as const,p+'.bankSurface');
        if(w.controlPoints!==undefined){body.controlPoints=list(w.controlPoints,p+'.controlPoints',64).map((v,j)=>vec2(v,p+`.controlPoints[${j}]`));if(body.controlPoints.length<(kind==='lake'?3:2))fail(p+'.controlPoints');}
        return body;
    });
    const oceans = waterBodies.filter(w => w.kind === 'ocean');
    if (oceans.length !== 1 || oceans[0].level !== state.water || oceans[0].opacity !== state.waterOpacity || oceans[0].wave !== state.wave)
        fail('world.waterBodies: параметры океана не совпадают');
    const preset = legacy && input.preset === undefined || input.preset === null ? null : choice(input.preset, ['forest','coast','mountains','valley',...WORLD_PRESET_IDS], 'world.preset');
    let recipe:WorldData['recipe'];
    if(input.recipe!==undefined){
        const r=object(input.recipe,'world.recipe');
        recipe={version:number(r.version,'world.recipe.version',1,1,true) as 1,seed:number(r.seed,'world.recipe.seed',0,0xffffffff,true),erosion:number(r.erosion,'world.recipe.erosion',0,2,true) as 0|1|2,plants:bool(r.plants,'world.recipe.plants'),routes:bool(r.routes,'world.recipe.routes')};
        if(r.jungle!==undefined){try{recipe.jungle=validateJungle(r.jungle);}catch{fail('world.recipe.jungle');}}
        if(r.taiga!==undefined){try{recipe.taiga=validateTaiga(r.taiga);}catch{fail('world.recipe.taiga');}}
    }
    if(preset&&WORLD_PRESET_IDS.includes(preset as typeof WORLD_PRESET_IDS[number])&&!recipe)fail('world.recipe');
    const landmarks = list(legacy && input.landmarks === undefined ? [] : input.landmarks, 'world.landmarks', 1000).map((item,i) => {
        const p = `world.landmarks[${i}]`, point = object(item,p);
        return { id: id(point.id,p+'.id'), name: text(point.name,p+'.name'), kind: choice(point.kind,['glade','valley','viewpoint','landmark'],p+'.kind'), position: vec2(point.position,p+'.position'), radius: number(point.radius,p+'.radius',1,512) };
    });
    if (routes.reduce((count, route) => count + route.points.length, 0) > 64000) fail('world.routes: слишком много точек');
    if(waterBodies.reduce((sum,b)=>sum+b.points.length,0)>16000)fail('world.waterBodies: слишком много точек');
    const viewpoints=list(preV8&&input.viewpoints===undefined?[]:input.viewpoints,'world.viewpoints',64).map((item,i)=>{
        const p=`world.viewpoints[${i}]`,v=object(item,p),position=vec3(v.position,p+'.position',-1e6,1e6),target=vec3(v.target,p+'.target',-1e6,1e6);
        if(Math.hypot(...position.map((n,i)=>n-target[i]))<.05)fail(p+'.target');
        return {id:id(v.id,p+'.id'),name:text(v.name,p+'.name'),position,target,fov:number(v.fov,p+'.fov',15,110),roll:number(v.roll,p+'.roll',-180,180),exposure:number(v.exposure,p+'.exposure',.2,2)};
    });
    return { preset, ...(recipe?{recipe}:{}),landmarks, assets, objects, groups, viewpoints, biomes, routes, waterBodies };
}
function validateOperations(value: unknown): OperationRecord[] {
    return list(value, 'operations', 10000).map((item, i) => {
        const p = `operations[${i}]`, op = object(item, p), parameters = object(op.parameters, `${p}.parameters`);
        if (![1,2,3,4,5,6,7].includes(op.algorithmVersion as number) || Object.keys(parameters).length > 64)
            fail(p);
        const normalized: Record<string, number | boolean> = {};
        for (const [key, value] of Object.entries(parameters)) {
            if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key))
                fail(`${p}.parameters`);
            normalized[key] = typeof value === 'boolean' ? value : number(value, `${p}.parameters.${key}`, -1e12, 1e12);
        }
        return { kind: choice(op.kind, ['terrain', 'erosion', 'scatter', 'noise', 'preset', 'composition', 'trail', 'water','meteor'], `${p}.kind`), seed: number(op.seed, `${p}.seed`, 0, 0xffffffff, true), algorithmVersion: op.algorithmVersion as OperationRecord['algorithmVersion'], parameters: normalized };
    });
}
function decodeBytes(value: unknown, byteLength: number, path: string) {
    if (typeof value !== 'string' || value.length !== Math.ceil(byteLength / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        fail(path);
    let raw: string;
    try {
        raw = atob(value);
    }
    catch {
        fail(path);
    }
    if (raw.length !== byteLength)
        fail(path);
    return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function validateView(value: unknown): ProjectView {
    const input = object(value, 'view'), camera = object(input.camera, 'view.camera');
    const result: ProjectView = { camera: { pos: vec3(camera.pos, 'view.camera.pos', -1e6, 1e6), target: vec3(camera.target, 'view.camera.target', -1e6, 1e6),
            rotation: vec3(camera.rotation, 'view.camera.rotation', -1e6, 1e6), near: number(camera.near, 'view.camera.near', 0.01, 10) }, walk: null };
    if (input.walk !== null) {
        const w = object(input.walk, 'view.walk'), feet = vec3(w.feet, 'view.walk.feet');
        if (Math.abs(feet[0]) > SIZE / 2 || Math.abs(feet[2]) > SIZE / 2)
            fail('view.walk.feet');
        const saved = w.saved === null ? null : object(w.saved, 'view.walk.saved');
        result.walk = { on: bool(w.on, 'view.walk.on'), feet, yaw: number(w.yaw, 'view.walk.yaw', -1e6, 1e6), pitch: number(w.pitch, 'view.walk.pitch', -1.55, 1.55),
            start: w.start === undefined || w.start === null ? null : vec3(w.start, 'view.walk.start'), autoWalking: w.autoWalking === undefined ? false : bool(w.autoWalking, 'view.walk.autoWalking'),
            vy: number(w.vy, 'view.walk.vy', -1000, 1000), grounded: bool(w.grounded, 'view.walk.grounded'), swim: bool(w.swim, 'view.walk.swim'), bob: number(w.bob, 'view.walk.bob', 0, 1e9),
            saved: saved ? { pos: vec3(saved.pos, 'view.walk.saved.pos', -1e6, 1e6), target: vec3(saved.target, 'view.walk.saved.target', -1e6, 1e6), near: number(saved.near, 'view.walk.saved.near', 0.01, 10) } : null };
        if (result.walk.on && !result.walk.saved)
            fail('view.walk.saved');
        if (result.walk.start && (Math.abs(result.walk.start[0]) > SIZE / 2 - 2 || Math.abs(result.walk.start[2]) > SIZE / 2 - 2)) fail('view.walk.start');
    }
    return result;
}
export function decodeProject(source: string): DecodedProject {
    if (source.length > 32 * 1024 * 1024)
        fail('файл больше 32 МБ');
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    }
    catch {
        fail('JSON');
    }
    const data = object(parsed, 'корень');
    if (data.app !== 'terrain-editor' || ![1,2,3,4,5,6,7,8,9,10,11].includes(data.version as number))
        fail('неподдерживаемая версия');
    if (data.size !== SIZE || data.splatRes !== SPLAT_RES)
        fail('размер территории или карты покраски');
    const legacy = data.version === 1, state = validateState(data.state, legacy, (data.version as number)<6,(data.version as number)<8);
    if (!legacy && data.heightEncoding !== 'float32-le')
        fail('heightEncoding');
    const hb = decodeBytes(data.heights, (state.N + 1) ** 2 * 4, 'heights'), heights = new Float32Array((state.N + 1) ** 2);
    const view = new DataView(hb.buffer);
    for (let i = 0; i < heights.length; i++)
        heights[i] = number(view.getFloat32(i * 4, true), `heights[${i}]`);
    const splat = decodeBytes(data.splat, SPLAT_RES ** 2 * 4, 'splat');
    const splatDetail = data.splatDetail === undefined ? new Uint8Array(SPLAT_RES ** 2 * 4) : decodeBytes(data.splatDetail, SPLAT_RES ** 2 * 4, 'splatDetail');
    if (legacy) {
        const model = createModel();
        const camera = data.camera === undefined ? { pos: [-330, 260, 600], target: [0, 30, 0] } : object(data.camera, 'camera');
        model.world.waterBodies[0] = { ...model.world.waterBodies[0], level: state.water, opacity: state.waterOpacity, wave: state.wave };
        return { version: 11,sourceVersion:1,embeddedAssets:[],balloon:null, state, heights, splat, splatDetail, world: model.world, seeds: { ...deriveSeeds(state.seed), brush: 9001 }, operations: [], walkSettings: { ...DEFAULT_WALK_SETTINGS },
            view: { camera: { pos: vec3(camera.pos, 'camera.pos', -1e6, 1e6), target: vec3(camera.target, 'camera.target', -1e6, 1e6), rotation: [0, 0, 0], near: 0.5 }, walk: null },
            legacyScatter: bool(data.scatter, 'scatter') };
    }
    const seeds = validateSeeds(data.seeds, (data.version as number) < 5);
    if (seeds.terrain !== state.seed)
        fail('seeds.terrain');
    const embeddedAssets:{id:string;blob:Blob}[]=[];
    if((data.version as number)<10){
        const world=object(data.world,'world');
        world.assets=list(world.assets??[],'world.assets',20).map((item,i)=>{
            const asset=object(item,`world.assets[${i}]`);
            if(asset.glb===undefined)return asset; // Reference-only test/migration documents are also accepted.
            const bytes=base64Binary(text(asset.glb,`world.assets[${i}].glb`,Math.ceil(MAX_ASSET_BYTES/3)*4));readGLB(bytes);
            const id=text(asset.id,`world.assets[${i}].id`,64);embeddedAssets.push({id,blob:new Blob([bytes],{type:'model/gltf-binary'})});
            const {glb:_,...metadata}=asset;
            // Temporary keys exist only in the decoded import, before async hashing.
            return {...metadata,blob:'sha256:'+i.toString(16).padStart(64,'0'),byteLength:bytes.byteLength};
        });
    }
    const balloon=(data.version as number)>=11?validateBalloon(data.balloon):null,projectView=validateView(data.view);
    if(balloon?.seated&&!projectView.walk?.on)fail('balloon.seated без режима прогулки');
    return { version: 11,sourceVersion:data.version as number,embeddedAssets,balloon, state, heights, splat, splatDetail, seeds, world: validateWorld(data.world, state, (data.version as number) < 5, (data.version as number)<7,(data.version as number)<8), operations: validateOperations(data.operations),
        walkSettings: validateWalkSettings(data.walkSettings, (data.version as number)<6), view:projectView, legacyScatter: false };
}
