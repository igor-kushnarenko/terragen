import { writeFile } from 'node:fs/promises';
import { createWalkWorld } from './walk-world';
const world=createWalkWorld();
await writeFile(new URL('../examples/forest-lake-viewpoint.json',import.meta.url),world.project);
console.log(`Walk scenario: ${world.model.world.objects.length} models, ${world.model.world.routes[0].points.length} path points, format 8`);
