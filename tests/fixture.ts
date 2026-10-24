import { generateHeightmap } from '../src/terrain-compute';
import { recordOperation } from '../src/operations';
import type { JobRunner } from '../src/worker-jobs';
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { createModel } from '../src/state';
import { createMaterials } from '../src/materials';
import { createTerrain } from '../src/terrain';
import { createVegetation } from '../src/vegetation';
import { createBrush } from '../src/brushes';
import { createHistory } from '../src/history';
import { createGeneration } from '../src/generation';
import { createStorage } from '../src/storage';
import type { Feedback } from '../src/feedback';

import { createWorldEdits } from '../src/edits';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {createAssetVault,type AssetVault} from '../src/asset-vault';
export function editorFixture(jobs: JobRunner = {
  async run(job, progress) { return computeTerrainJob(job,progress); }, cancel() {},
},vault:AssetVault=createAssetVault()) {
  const model = createModel(); model.N = model.state.N = 32;
  const render = { scene: new Scene(), camera: new PerspectiveCamera(), controls: { target: new Vector3() } };
  const feedback: Feedback = { uiSync: {}, setStatus() {}, syncUI() {}, syncAllUI() {}, setProgress() {}, setBusy(busy) { model.busy = busy; }, updateUndoButtons() {}, bindHistory() {} };
  const materials = createMaterials(model, render);
  const terrain = createTerrain(model, render, materials);
  const vegetation = createVegetation(model, render, terrain, feedback);
  const brushes = createBrush(model, terrain, materials, vegetation);
  const history = createHistory(model, feedback, terrain, materials, vegetation, brushes);
  const generation = createGeneration(model, feedback, history, terrain, vegetation, jobs);
  const storage = createStorage(model, terrain, feedback, history, materials, vegetation, render, { generateAll() {}, applyAll() {} },vault);
  terrain.buildTerrain(); model.heights = generateHeightmap(model.state);
  const s = model.state; recordOperation(model, 'terrain', s.seed, { N: s.N, scale: s.scale, height: s.height, octaves: s.octaves, sharp: s.sharp, warp: s.warp, mountains: s.mountains, island: s.island });
  terrain.updateMeshAll();
  const edits = createWorldEdits(model, history, terrain, vegetation, feedback);
  return { model, render, materials, terrain, brushes, history, generation, storage, vegetation, feedback, edits,vault };
}

