import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Ray, Raycaster } from 'three';
import { editorFixture } from './fixture';

test('physical terrain heights and editing rays match both mesh triangles on a non-planar cell',()=>{
  const f=editorFixture();f.model.heights.fill(0);
  const i=16,j=16;f.model.heights[(j+1)*f.model.n+i+1]=4;f.terrain.updateMeshAll();
  for(const [tx,tz]of [[.35,.3],[.8,.7],[.5,.5],[1,1],[0,0]]){
    const x=-512+(i+tx)*f.model.cell,z=-512+(j+tz)*f.model.cell;
    const ray=new Ray(new Vector3(x,20,z),new Vector3(0,-1,0));
    const caster=new Raycaster(ray.origin,ray.direction),hit=caster.intersectObject(f.terrain.terrain)[0];assert.ok(hit);
    assert.ok(Math.abs(f.terrain.getSurfaceH(x,z)-hit.point.y)<1e-6);
    assert.ok(Math.abs(f.terrain.raycastTerrain(ray)!.y-hit.point.y)<.001);
  }
  assert.ok(Math.abs(f.terrain.getH(8,8)-f.terrain.getSurfaceH(8,8))>.2,'fixture must expose bilinear/triangle disagreement');
});

test('generation is repeatable and updates mesh heights and normals', async () => {
  const { model, terrain, generation } = editorFixture();
  const original = model.heights.slice();
  await generation.runGeneration(() => terrain.updateMeshAll());
  assert.deepEqual(model.heights, original);
  for (let i = 0; i < original.length; i++) {
    assert.equal(terrain.geo.attributes.position.getY(i), original[i]);
    assert.ok(Number.isFinite(terrain.geo.attributes.normal.getY(i)));
  }
  model.state.seed++;
  await generation.runGeneration(() => terrain.updateMeshAll());
  assert.notDeepEqual(model.heights, original);
});

test('sculpt and texture strokes survive undo and redo', () => {
  const { model, terrain, brushes, history } = editorFixture();
  const center = new Vector3(0, terrain.getH(0, 0), 0);
  const original = model.heights.slice();
  history.pushUndo(); brushes.applyBrush(center, 0.25);
  const edited = model.heights.slice();
  assert.notDeepEqual(edited, original);
  history.undo(); assert.deepEqual(model.heights, original);
  history.redo(); assert.deepEqual(model.heights, edited);
  model.state.tool = 'paint';
  history.pushUndo(); brushes.applyBrush(center, 0.25);
  assert.ok(model.splat.some(v => v > 0));
  history.undo(); assert.ok(model.splat.every(v => v === 0));
  history.redo(); assert.ok(model.splat.some(v => v > 0));
});

test('erosion updates terrain, releases busy state and can be undone', async () => {
  const { model, terrain, generation, history } = editorFixture();
  model.state.droplets = 10; model.state.thermal = 2;
  const original = model.heights.slice();
  await generation.runErosion();
  assert.equal(model.busy, false);
  assert.notDeepEqual(model.heights, original);
  assert.ok(model.heights.every(Number.isFinite));
  assert.equal(terrain.geo.attributes.position.getY(0), model.heights[0]);
  history.undo(); assert.deepEqual(model.heights, original);
});

test('undo restores grid resolution and correct buffer sizes', () => {
  const { model, terrain, history } = editorFixture();
  const original = model.heights.slice(); history.pushUndo();
  model.N = model.state.N = 64; terrain.buildTerrain();
  history.undo();
  assert.equal(model.N, 32); assert.equal(model.n, 33);
  assert.deepEqual(model.heights, original);
  assert.equal(terrain.geo.attributes.position.count, 33 * 33);
});

test('16-bit PNG round-trips signed heights within quantization error', async () => {
  const { model, storage } = editorFixture();
  const blob = await storage.encodePNG16();
  const bytes = await blob.arrayBuffer();
  assert.equal(new Uint8Array(bytes)[24], 16);
  const decoded = await storage.decodePNG(bytes);
  assert.ok(decoded?.meta);
  assert.equal(decoded.w, model.n); assert.equal(decoded.h, model.n);
  const range = decoded.meta.maxH - decoded.meta.minH;
  for (let i = 0; i < model.heights.length; i++) {
    const height = decoded.meta.minH + decoded.vals[i] * range;
    assert.ok(Math.abs(height - model.heights[i]) <= range / 65535 + 1e-5);
  }
});

test('JSON projects restore heights, paint, settings and camera', async () => {
  const { model, render, storage } = editorFixture();
  model.splat[100] = 127; render.camera.position.set(1, 2, 3);
  const original = model.heights.slice(), json = storage.projectJSON();
  model.heights.fill(999); model.splat.fill(0); model.state.water = 100;
  render.camera.position.set(0, 0, 0);
  await storage.loadProjectText(json);
  assert.deepEqual(model.heights, original);
  assert.equal(model.splat[100], 127); assert.equal(model.state.water, 16);
  assert.deepEqual(render.camera.position.toArray(), [1, 2, 3]);
});

test('OBJ contains the expected vertices, normals, UVs and indexed faces', () => {
  const { model, storage } = editorFixture();
  const obj = storage.buildOBJ();
  assert.equal(obj.match(/^v /gm)?.length, model.n ** 2);
  assert.equal(obj.match(/^vn /gm)?.length, model.n ** 2);
  assert.equal(obj.match(/^vt /gm)?.length, model.n ** 2);
  assert.equal(obj.match(/^f /gm)?.length, model.N ** 2 * 2);
  assert.ok(!obj.includes('NaN') && !obj.includes('undefined'));
  for (const face of obj.match(/^f .*$/gm)!) {
    for (const vertex of face.slice(2).split(' ')) {
      const indices = vertex.split('/').map(Number);
      assert.ok(indices.every(i => i >= 1 && i <= model.n ** 2));
    }
  }
});
