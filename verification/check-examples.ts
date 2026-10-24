import { readFile } from 'node:fs/promises';
import { decodeProject } from '../src/project';

for (const name of ['forest', 'coast', 'mountains', 'valley']) {
    const project = decodeProject(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
    if (project.version !== 8 || project.world.preset !== name || project.world.landmarks.length !== 5)
        throw new Error(`Unexpected example: ${name}`);
    console.log(`${name}: format ${project.version}, ${project.world.landmarks.length} places, ${project.world.routes.length} routes`);
}
