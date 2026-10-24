import { Box3, Frustum, Matrix4, Vector3, type Camera } from 'three';
export const OBJECT_CHUNK_SIZE = 128;
export const TERRAIN_CHUNK_SEGMENTS = 64;
/** Coarse interiors keep every original edge vertex, including between different LODs. */
export function terrainChunkIndices(segments: number, step: number) {
    const n = segments + 1, indices: number[] = [], at = (x: number, z: number) => z * n + x;
    for (let z = 0; z < segments; z += step) for (let x = 0; x < segments; x += step) {
        const s = Math.min(step, segments - x, segments - z), a = at(x,z), b = at(x,z+s), c = at(x+s,z), d = at(x+s,z+s);
        if (s === 1 || x > 0 && z > 0 && x + s < segments && z + s < segments) { indices.push(a,b,c,b,d,c); continue; }
        const perimeter = [a];
        if (x === 0) for (let k = 1; k < s; k++) perimeter.push(at(x,z+k));
        perimeter.push(b);
        if (z + s === segments) for (let k = 1; k < s; k++) perimeter.push(at(x+k,z+s));
        perimeter.push(d);
        if (x + s === segments) for (let k = 1; k < s; k++) perimeter.push(at(x+s,z+s-k));
        perimeter.push(c);
        if (z === 0) for (let k = 1; k < s; k++) perimeter.push(at(x+s-k,z));
        const center = at(x+s/2,z+s/2);
        for (let k = 0; k < perimeter.length; k++) indices.push(center,perimeter[k],perimeter[(k+1)%perimeter.length]);
    }
    return Uint32Array.from(indices);
}
export function cameraFrustum(camera: Camera, frustum = new Frustum()) {
    camera.updateMatrixWorld(); return frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
}
export function boxDistance(box: Box3, point: Vector3) { return box.distanceToPoint(point); }
