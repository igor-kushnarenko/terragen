import * as T from 'three';
import { TERRAIN_CHUNK_SEGMENTS, boxDistance, cameraFrustum, terrainChunkIndices } from './chunk-grid';
import { chooseLOD, qualityProfile } from './quality';
import type { EditorModel } from './state';
export function createTerrainChunks(model: EditorModel, scene: T.Scene, material: T.Material, full: T.BufferGeometry) {
    const span = Math.min(TERRAIN_CHUNK_SEGMENTS, model.N), n = span + 1;
    const levels = [1,2,4].map(step => terrainChunkIndices(span,step));
    const starts = [0,levels[0].length,levels[0].length+levels[1].length];
    const all = Uint32Array.from(levels.flatMap(level => [...level]));
    const group = new T.Group(); group.name = 'Terrain chunks'; scene.add(group);
    const chunks: { i: number; j: number; mesh: T.Mesh; level: number; errors:number[] }[] = [];
    for (let j=0;j<model.N;j+=span) for(let i=0;i<model.N;i+=span) {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(n*n*3),3).setUsage(T.DynamicDrawUsage));
        geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(n*n*3),3).setUsage(T.DynamicDrawUsage));
        geometry.setIndex(new T.BufferAttribute(all.slice(),1)); geometry.setDrawRange(0,levels[0].length);
        const mesh = new T.Mesh(geometry,material); mesh.castShadow = mesh.receiveShadow = true; mesh.name = `Terrain ${i},${j}`;
        group.add(mesh); chunks.push({i,j,mesh,level:0,errors:[0,0,0]});
    }
    function update(i0=0,j0=0,i1=model.N,j1=model.N) {
        const sourcePos = full.attributes.position.array, sourceNormal = full.attributes.normal.array;
        for (const chunk of chunks) {
            if (chunk.i>i1 || chunk.j>j1 || chunk.i+span<i0 || chunk.j+span<j0) continue;
            const geometry = chunk.mesh.geometry, pos = geometry.attributes.position.array, normal = geometry.attributes.normal.array;
            for(let z=0;z<=span;z++) for(let x=0;x<=span;x++) {
                const from=((chunk.j+z)*model.n+chunk.i+x)*3,to=(z*n+x)*3;
                for(let k=0;k<3;k++) { pos[to+k]=sourcePos[from+k]; normal[to+k]=sourceNormal[from+k]; }
            }
            geometry.attributes.position.needsUpdate = geometry.attributes.normal.needsUpdate = true;
            geometry.computeBoundingBox(); geometry.computeBoundingSphere();
            chunk.errors=[0,...[2,4].map(step=>{
                let error=0;
                const height=(px:number,pz:number)=>pos[(pz*n+px)*3+1];
                for(let z=0;z<=span;z++)for(let x=0;x<=span;x++){
                    const x0=Math.min(Math.floor(x/step)*step,span-step),z0=Math.min(Math.floor(z/step)*step,span-step);
                    const tx=(x-x0)/step,tz=(z-z0)/step;
                    const a=height(x0,z0),b=height(x0+step,z0),c=height(x0,z0+step),d=height(x0+step,z0+step);
                    const coarse=tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
                    error=Math.max(error,Math.abs(height(x,z)-coarse));
                }
                return error;
            })];
        }
    }
    const frustum = new T.Frustum(); let visible=0; let triangles=0;
    function updateView(camera: T.Camera, brush: T.Vector3 | null = null,viewportHeight=720) {
        cameraFrustum(camera,frustum); visible=0; triangles=0;
        const distances = qualityProfile(model).terrainDistances;
        for(const chunk of chunks) {
            const geometry = chunk.mesh.geometry, box = geometry.boundingBox!;
            const editing = brush && box.distanceToPoint(brush)<model.state.radius+model.cell*2;
            const distance=boxDistance(box,camera.position);
            chunk.level = editing ? 0 : chooseLOD(distance,chunk.level,distances);
            // Distance alone flattened small islands and turned distant rounded
            // ridges into polygons. Keep detail while its loss is visible on screen.
            if(camera instanceof T.PerspectiveCamera){
                const projection=viewportHeight*camera.projectionMatrix.elements[5]/(2*Math.max(1,distance));
                const tolerance={low:5,balanced:2.5,high:1.25}[model.state.quality];
                while(chunk.level>0&&chunk.errors[chunk.level]*projection>tolerance)chunk.level--;
            }
            geometry.setDrawRange(starts[chunk.level],levels[chunk.level].length);
            // Renderer performs its own frustum check for the camera and shadow camera separately.
            if(frustum.intersectsBox(box)) { visible++; triangles+=levels[chunk.level].length/3; }
        }
    }
    update();
    return { update,updateView,chunks,dispose(){ scene.remove(group); chunks.forEach(chunk=>chunk.mesh.geometry.dispose()); },
        get statistics(){ return { total:chunks.length,visible,triangles,levels:chunks.reduce((counts,chunk)=>{counts[chunk.level]++;return counts;},[0,0,0]) }; } };
}
export type TerrainChunks = ReturnType<typeof createTerrainChunks>;
