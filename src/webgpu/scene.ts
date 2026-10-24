import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BENCHMARK } from './benchmark';

export type LoadId = 'small' | 'dense';
export const LOADS: Record<LoadId, { trees: number; grass: number; segments: number }> = {
    small: { trees: 180, grass: 1400, segments: 128 }, dense: { trees: 1100, grass: 12000, segments: 256 },
};
export function seeded(seed: number) {
    let n = seed >>> 0;
    return () => { n = (n + 0x6D2B79F5) >>> 0; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function height(x: number, z: number) {
    return 3 + Math.sin(x * .075) * Math.cos(z * .065) * 4 + Math.sin(z * .12 + x * .04) * 1.3
        - 8 * Math.exp(-((x - 5) ** 2 / 210 + (z + 5) ** 2 / 150));
}
export function placements(count: number, seed: number, radius: number) {
    const random = seeded(seed), points: { x: number; y: number; z: number; phase: number }[] = [];
    for (let i = 0; i < count * 8 && points.length < count; i++) {
        const x = (random() * 2 - 1) * radius, z = (random() * 2 - 1) * radius, y = height(x, z);
        const phase = random() * Math.PI * 2;
        if (y > 1.1 && Math.hypot(x - 22, z - 30) > 8) points.push({ x, y, z, phase });
    }
    if (points.length !== count) throw new Error('Не удалось разместить тестовую растительность');
    return points;
}
export interface LabMaterials { ground: THREE.Material; plant: THREE.Material; water: THREE.Material }
function colored(geometry: THREE.BufferGeometry, color: number) {
    const c = new THREE.Color(color), colors: number[] = [], weights: number[] = [];
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) { colors.push(c.r, c.g, c.b); weights.push(Math.pow(Math.max(0, p.getY(i) / 8), 1.7) * .38); }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aWeight', new THREE.Float32BufferAttribute(weights, 1));
    return geometry;
}
function pine() {
    const parts = [colored(new THREE.CylinderGeometry(.16, .3, 5, 6).translate(0, 2.5, 0), 0x69503a)];
    for (let i = 0; i < 4; i++) parts.push(colored(new THREE.ConeGeometry(2.3 - i * .42, 3, 7).translate(0, 3.4 + i * 1.25, 0), i % 2 ? 0x31734d : 0x286747));
    const result = mergeGeometries(parts); parts.forEach(g => g.dispose()); return result;
}
function grass() {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) parts.push(colored(new THREE.ConeGeometry(.24, .9, 3, 1, true).translate(0, .45, 0).rotateY(i * 1.04), 0x80a447));
    const result = mergeGeometries(parts); parts.forEach(g => g.dispose()); return result;
}
export function createLabScene(materials: LabMaterials, load: LoadId) {
    const settings = LOADS[load], scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9bfce);
    const camera = new THREE.PerspectiveCamera(55, BENCHMARK.width / BENCHMARK.height, .2, 400);
    camera.position.set(29, 14, 35); camera.lookAt(0, 2, -6);
    scene.add(new THREE.HemisphereLight(0xd5e9ff, 0x65603c, 1.1));
    const sun = new THREE.DirectionalLight(0xffe6b7, 3); sun.position.set(-25, 50, 20); scene.add(sun);
    const ground = new THREE.PlaneGeometry(140, 140, settings.segments, settings.segments).rotateX(-Math.PI / 2);
    const positions = ground.getAttribute('position'), uv = ground.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
        positions.setY(i, height(positions.getX(i), positions.getZ(i)));
        uv.setXY(i, positions.getX(i) * .18, positions.getZ(i) * .18);
    }
    ground.computeVertexNormals();
    const normal = ground.getAttribute('normal'), blend: number[] = [];
    for (let i = 0; i < positions.count; i++) blend.push(THREE.MathUtils.smoothstep(1 - normal.getY(i), .04, .22), .5 + .4 * Math.sin(positions.getX(i) * .11) * Math.cos(positions.getZ(i) * .13));
    ground.setAttribute('aBlend', new THREE.Float32BufferAttribute(blend, 2));
    scene.add(new THREE.Mesh(ground, materials.ground));
    const plantMeshes: THREE.InstancedMesh[] = [];
    for (const [count, seed, geometry] of [[settings.trees, BENCHMARK.seed, pine()], [settings.grass, BENCHMARK.seed + 1, grass()]] as const) {
        const points = placements(count, seed, 65), mesh = new THREE.InstancedMesh(geometry, materials.plant, count), phases: number[] = [];
        for (let i = 0; i < count; i++) { const p = points[i]; mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)); phases.push(p.phase); }
        geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases), 1));
        mesh.computeBoundingSphere(); mesh.boundingSphere!.radius += 2; scene.add(mesh); plantMeshes.push(mesh);
    }
    const waterGeometry = new THREE.CircleGeometry(18, 96).rotateX(-Math.PI / 2);
    // Terrain occludes the submerged part; identical opaque shallow-water model in both pipelines.
    const water = new THREE.Mesh(waterGeometry, materials.water); water.position.set(5, .7, -5); water.scale.z = .85; scene.add(water);
    let objects = 0; scene.traverse(o => { if (o instanceof THREE.Mesh) objects++; });
    return { scene, camera, objects, instances: settings.trees + settings.grass, plantMeshes,
        dispose(disposeMaterials = true) { scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); if (disposeMaterials) Object.values(materials).forEach(m => m.dispose()); },
    };
}
