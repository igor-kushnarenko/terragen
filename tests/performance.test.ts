import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, InstancedMesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { FrameMeter, countSceneObjects } from '../src/performance';

const counters = { calls: 8, triangles: 1000, objects: 40 };

test('FPS can fall below 20 and reports the actual frame interval', () => {
  const meter = new FrameMeter();
  meter.record(0, counters);
  const result = meter.record(1000, counters)!;
  assert.equal(result.fps, 1);
  assert.equal(result.frameTimeMs, 1000);
});

test('FPS and frame time use the same wall-time window', () => {
  const meter = new FrameMeter();
  let result;
  for (let i = 0; i <= 8; i++) result = meter.record(i * (1000 / 15), counters) ?? result;
  assert.ok(result);
  assert.ok(Math.abs(result.fps - 15) < 1e-6);
  assert.ok(Math.abs(result.frameTimeMs - 1000 / 15) < 1e-6);
  assert.equal(result.calls, 8);
});

test('draw counters are averaged across variable frame intervals', () => {
  const meter = new FrameMeter();
  meter.record(0, counters);
  meter.record(100, { ...counters, calls: 10 });
  const result = meter.record(500, { ...counters, calls: 20 })!;
  assert.equal(result.fps, 4);
  assert.equal(result.frameTimeMs, 250);
  assert.equal(result.calls, 15);
});

test('visibility reset excludes time spent in a background tab', () => {
  const meter = new FrameMeter();
  meter.record(0, counters); meter.record(100, counters); meter.reset();
  assert.equal(meter.record(10000, counters), undefined);
  const result = meter.record(10500, counters)!;
  assert.equal(result.fps, 2);
});

test('scene census counts instances and ignores hidden ancestors', () => {
  const scene = new Scene();
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  scene.add(new InstancedMesh(geometry, material, 123));
  const hidden = new Group(); hidden.visible = false;
  hidden.add(new Mesh(geometry, material)); scene.add(hidden);
  scene.add(new Mesh(geometry, material));
  assert.equal(countSceneObjects(scene), 124);
  geometry.dispose(); material.dispose();
});
