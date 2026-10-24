import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, PerspectiveCamera, RepeatWrapping, LinearMipmapLinearFilter } from 'three';
import { BUILTIN_GLB } from '../src/builtin-models';
import { base64Binary, binaryBase64, readGLB, validateGLTF } from '../src/asset-format';
import { getModel, initializeModelLibrary, prepareModelAssets } from '../src/model-library';
import { createFineFoliage, foliagePoints, MAX_FOLIAGE_INSTANCES } from '../src/fine-foliage';
import { createSurfaceMaps, SURFACE_TILE } from '../src/surface-maps';
import { decodeProject } from '../src/project';
import { editorFixture } from './fixture';
import type { ModelAsset } from '../src/world';

test('local GLB pack loads all tree, shrub, stone and bridge variants', async () => {
    await initializeModelLibrary();
    for (const [id, text] of Object.entries(BUILTIN_GLB)) {
        assert.ok(readGLB(base64Binary(text))); const model = getModel(id); assert.ok(model.parts.length > 0); assert.equal(model.bounds.isEmpty(), false);
        assert.ok(model.parts.length <= 3, id + ' should merge repeated parts by material');
    }
    assert.equal(getModel('bridge').collider, 'mesh'); assert.equal(getModel('birch').category, 'tree');
});
test('imported self-contained GLB is normalized, persisted and participates in object history', async () => {
    class Reader { result: ArrayBuffer | string = ''; onloadend?: () => void; async readAsArrayBuffer(blob: Blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); } }
    Object.assign(globalThis, { FileReader: Reader });
    const f = editorFixture(),asset = await f.storage.importModel([new File([base64Binary(BUILTIN_GLB.boulder)], 'valley.glb')], 'rock', 'convex');
    assert.match(asset.id, /^custom-/); readGLB(await(await f.vault.resolve(asset)).arrayBuffer());
    f.edits.replaceWorld({ assets: [asset] }); const id = f.edits.addObject(asset.id, 0, 0)!;
    const data = decodeProject(f.storage.projectJSON()); assert.equal(data.world.assets[0].blob, asset.blob); assert.equal(data.world.objects[0].asset, asset.id);
    f.history.undo(); assert.equal(f.model.world.objects.length, 0); f.history.redo(); assert.equal(f.model.world.objects[0].id, id);
    const restored = editorFixture(); await restored.storage.loadProjectFile(await f.storage.buildProjectBlob()); assert.equal(restored.model.world.assets[0].name, 'valley');
});
test('bad GLB containers, external references and unknown model IDs are rejected before loading', async () => {
    assert.throws(() => readGLB(new ArrayBuffer(20)), /GLB/);
    const bytes = base64Binary(BUILTIN_GLB.rock); new DataView(bytes).setUint32(8, bytes.byteLength + 4, true); assert.throws(() => readGLB(bytes), /контейнер/);
    const f = editorFixture(), data = JSON.parse(f.storage.projectJSON()); data.world.objects = [{ id: 'bad', asset: 'missing', source: 'manual', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], followTerrain: true, groundOffset: 0, tint: 1 }];
    await assert.rejects(f.storage.loadProjectText(JSON.stringify(data)), /asset/); assert.equal(f.model.world.objects.length, 0);
    const invalid: ModelAsset = { id: 'custom-bad', name: 'Bad', category: 'rock', collider: 'convex', blob:'sha256:'+'0'.repeat(64),byteLength:32 };
    await assert.rejects(prepareModelAssets([invalid],f.vault,new Map([[invalid.blob,new Blob([new ArrayBuffer(32)])]])), /GLB/);
    for (const uri of ['https://example.com/texture.png', '//example.com/mesh.bin', 'file:///mesh.bin'])
        assert.throws(() => validateGLTF({ asset: { version: '2.0' }, buffers: [{ uri }] }, true), /сетевые URL/);
});
test('format 2 migrates detail layers, model library and foliage defaults without losing old paint', () => {
    const f = editorFixture(); f.model.splat[12] = 55; const data = JSON.parse(f.storage.projectJSON()); data.version = 2;
    delete data.splatDetail; delete data.world.assets;
    for (const key of ['groundDetail','foliageDensity','foliageDistance','showFoliage']) delete data.state[key];
    const project = decodeProject(JSON.stringify(data)); assert.equal(project.version,11); assert.equal(project.splat[12], 55);
    assert.equal(project.splatDetail.some(value => value !== 0), false); assert.deepEqual(project.world.assets, []); assert.equal(project.state.showFoliage, true);
    f.vegetation.scatter(); assert.equal(decodeProject(f.storage.projectJSON()).operations.at(-1)?.algorithmVersion, 5);
});
test('all new ground layers paint, erase and round-trip through history and project files', () => {
    const f = editorFixture(); f.model.state.tool = 'paint'; const hit = new Vector3(0, f.terrain.getH(0,0), 0);
    for (const layer of [5,6,7,8]) {
        f.model.state.layer = layer; f.history.transaction('Покраска', () => f.brushes.applyBrush(hit, 0.5));
        assert.ok(f.model.splatDetail.some((value, i) => i % 4 === layer - 5 && value > 0));
    }
    const painted = f.model.splatDetail.slice(); f.model.state.layer = 4; f.history.transaction('Ластик', () => f.brushes.applyBrush(hit, 0.5));
    assert.notDeepEqual(f.model.splatDetail, painted); f.history.undo(); assert.deepEqual(f.model.splatDetail, painted);
    assert.deepEqual(decodeProject(f.storage.projectJSON()).splatDetail, painted);
});
test('surface maps contain distinct color, height and roughness values and use mipmaps', () => {
    const maps = createSurfaceMaps(), data = maps.detail.image.data as Uint8Array;
    assert.ok(new Set(data.filter((_v, i) => i % 4 === 0)).size > 30); assert.ok(new Set(data.filter((_v, i) => i % 4 === 1)).size > 10);
    assert.equal(maps.albedo.generateMipmaps, true); maps.albedo.dispose(); maps.detail.dispose();
});
test('ground tiles wrap without a color or height discontinuity at repeated edges', () => {
    const maps = createSurfaceMaps(), side = SURFACE_TILE;
    for (const map of [maps.albedo, maps.detail]) {
        assert.equal(map.isDataArrayTexture, true); assert.equal(map.image.depth, 8);
        assert.equal(map.wrapS, RepeatWrapping); assert.equal(map.wrapT, RepeatWrapping);
        assert.equal(map.minFilter, LinearMipmapLinearFilter); assert.equal(map.generateMipmaps, true);
        const data = map.image.data as Uint8Array;
        for (let layer = 0; layer < 8; layer++) for (const channel of map === maps.albedo ? [0,1,2] : [0]) {
            const value = (x: number, y: number) => data[(layer * side * side + y * side + x) * 4 + channel];
            let edges = 0, interior = 0;
            for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
                if (x < side - 1) interior += Math.abs(value(x,y) - value(x+1,y));
                if (y < side - 1) interior += Math.abs(value(x,y) - value(x,y+1));
            }
            for (let p = 0; p < side; p++) edges += Math.abs(value(0,p) - value(side-1,p)) + Math.abs(value(p,0) - value(p,side-1));
            const edgeMean = edges / (side * 2), interiorMean = interior / (side * (side-1) * 2);
            assert.ok(edgeMean <= interiorMean * 1.3, `layer ${layer}, channel ${channel}: edge ${edgeMean}, interior ${interiorMean}`);
        }
        map.dispose();
    }
});
test('fine foliage is deterministic, bounded near the camera and releases departed chunks', () => {
    const f = editorFixture(); f.model.heights.fill(25); f.terrain.updateMeshAll();
    const first = foliagePoints(f.model, f.terrain, 0, 0); assert.deepEqual(foliagePoints(f.model, f.terrain, 0, 0), first);
    f.model.seeds.scatter++; assert.notDeepEqual(foliagePoints(f.model, f.terrain, 0, 0), first);
    const camera = new PerspectiveCamera(); camera.position.set(0, 27, 0);
    f.model.state.foliageDistance = 80; f.model.state.foliageDensity = 1;
    const foliage = createFineFoliage(f.model, f.terrain, f.render.scene); foliage.update(camera, 0.1);
    assert.ok(foliage.statistics.instances > 0); assert.ok(foliage.statistics.instances <= MAX_FOLIAGE_INSTANCES);
    const original=f.render.scene.children.filter(o=>(o as any).isInstancedMesh);camera.position.x = 450; foliage.update(camera, 0.1); assert.ok(foliage.statistics.instances <= MAX_FOLIAGE_INSTANCES);
    assert.ok(original.every(o=>!f.render.scene.children.includes(o))); f.model.state.showFoliage = false; foliage.update(camera, 0.1); assert.equal(foliage.statistics.chunks, 0); foliage.dispose();
});

test('foliage rebuild is spread over frames and remote impacts keep nearby buffers',()=>{
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.state.foliageDistance=50;f.model.state.foliageDensity=.4;
    const camera=new PerspectiveCamera();camera.position.set(0,32,0);const foliage=createFineFoliage(f.model,f.terrain,f.render.scene);
    foliage.update(camera,.1);assert.ok(foliage.statistics.chunks<=6);for(let i=0;i<70;i++)foliage.update(camera,.016);assert.ok(foliage.statistics.chunks>20);
    const meshes=[...f.render.scene.children],count=foliage.statistics.instances;
    f.model.heights[0]-=10;f.terrain.updateMeshRect(0,0,1,1);f.model.world.objects=[...f.model.world.objects];foliage.invalidateRegions([[0,0,1,1]]);foliage.update(camera,.016);
    assert.equal(foliage.statistics.instances,count);assert.deepEqual(f.render.scene.children,meshes);foliage.dispose();
});
