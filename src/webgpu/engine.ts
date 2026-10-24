import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assertBackend, BENCHMARK, type BackendId } from './benchmark';
import { createLabScene, type LoadId } from './scene';
import { createLabMaterials } from './materials';

// These backend fields exist in r186 but are absent from @types/three; keep the bridge here.
interface BackendAccess {
    isWebGPUBackend?: boolean;
    gl?: WebGL2RenderingContext;
    device?: { queue: { onSubmittedWorkDone(): Promise<void> }; destroy(): void; adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string } };
}
export async function createEngine(id: BackendId, load: LoadId, host: HTMLElement) {
    let renderer: THREE.WebGLRenderer | WebGPURenderer | undefined;
    const materialSystem = createLabMaterials(id !== 'webgl');
    let world = createLabScene(materialSystem.materials, load), currentLoad = load;
    let controls: OrbitControls | undefined;
    try {
        if (id === 'webgl') renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
        else {
            if (id === 'webgpu' && !('gpu' in navigator)) throw new Error('В этом браузере нет navigator.gpu. Откройте лабораторию в браузере с WebGPU через localhost или HTTPS.');
            renderer = new WebGPURenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', forceWebGL: id === 'tsl-webgl', outputBufferType: THREE.UnsignedByteType });
            await renderer.init();
        }
        const current = renderer;
        current.info.autoReset = false;
        const backend = current instanceof WebGPURenderer ? current.backend as unknown as BackendAccess : undefined;
        const native = backend?.isWebGPUBackend === true;
        assertBackend(id, native);
        current.setPixelRatio(1); current.setSize(BENCHMARK.width, BENCHMARK.height, false);
        current.outputColorSpace = THREE.SRGBColorSpace; current.toneMapping = THREE.ACESFilmicToneMapping; current.toneMappingExposure = .8;
        current.domElement.setAttribute('aria-label', 'Тестовый пейзаж');
        host.replaceChildren(current.domElement);
        controls = new OrbitControls(world.camera, current.domElement); controls.target.set(0, 2, -6); controls.update(); controls.saveState();
        controls.enableDamping = false;
        const gl = current instanceof THREE.WebGLRenderer ? current.getContext() as WebGL2RenderingContext : backend?.gl;
        const device = backend?.device;
        let adapter = 'не предоставлен браузером';
        if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); if (ext) adapter = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); }
        if (device?.adapterInfo) { const info = device.adapterInfo; adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || adapter; }
        const finish = async () => {
            if (device) await device.queue.onSubmittedWorkDone();
            else if (gl) {
                if (gl.isContextLost()) throw new Error('Потерян графический контекст');
                const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                if (!fence) throw new Error('Не удалось создать GPU fence');
                gl.flush();
                const start = performance.now();
                try {
                    for (;;) {
                        const state = gl.clientWaitSync(fence, 0, 0);
                        if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) break;
                        if (state === gl.WAIT_FAILED || gl.isContextLost()) throw new Error('Ошибка ожидания GPU fence');
                        if (performance.now() - start > 15000) throw new Error('GPU не ответил за 15 секунд');
                        await new Promise(resolve => setTimeout(resolve, 1));
                    }
                } finally { gl.deleteSync(fence); }
            }
            else throw new Error('Нет способа дождаться завершения GPU');
        };
        let wetness = .35, wind = 1, failure: string | null = null, disposed = false;
        if (current instanceof WebGPURenderer) current.onDeviceLost = info => { failure = info.message; };
        current.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); failure = 'Потерян WebGL-контекст'; });
        const render = (time: number) => {
            if (failure) throw new Error(failure);
            current.info.reset(); materialSystem.set(time, wetness, wind); current.render(world.scene, world.camera);
        };
        materialSystem.set(BENCHMARK.time, wetness, wind);
        await current.compileAsync(world.scene, world.camera);
        render(BENCHMARK.time); await finish();
        return {
            id, adapter, actualBackend: native ? 'WebGPU' : 'WebGL2', renderer: current, controls,
            render, finish, resetCamera() { controls!.reset(); },
            setEnvironment(wet: number, strength: number) { wetness = wet; wind = strength; },
            async setLoad(next: LoadId) {
                if (currentLoad === next) return;
                await finish(); world.dispose(false); world = createLabScene(materialSystem.materials, next); currentLoad = next;
                controls!.object = world.camera; controls!.target.set(0, 2, -6); controls!.update(); controls!.saveState();
                await current.compileAsync(world.scene, world.camera);
                render(BENCHMARK.time); await finish();
            },
            getStats() {
                const info = current.info;
                const drawCalls = current instanceof THREE.WebGLRenderer ? current.info.render.calls : current.info.render.drawCalls;
                return { drawCalls, triangles: info.render.triangles, meshObjects: world.objects, instances: world.instances };
            },
            async snapshot() {
                render(BENCHMARK.time);
                const canvas = document.createElement('canvas'); canvas.width = BENCHMARK.width; canvas.height = BENCHMARK.height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) throw new Error('Canvas2D недоступен');
                context.drawImage(current.domElement, 0, 0); await finish();
                return { png: canvas.toDataURL('image/png'), pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
            },
            async dispose() {
                if (disposed) return; disposed = true;
                controls!.dispose();
                try { if (!failure) await finish(); } catch { /* A lost device still needs its resources released. */ }
                world.dispose(); materialSystem.disposeTextures(); await current.dispose();
                if (current instanceof THREE.WebGLRenderer) current.forceContextLoss();
                current.domElement.remove();
            },
        };
    } catch (error) {
        controls?.dispose(); world.dispose(); materialSystem.disposeTextures();
        if (renderer instanceof THREE.WebGLRenderer) { renderer.dispose(); renderer.forceContextLoss(); }
        else if (renderer?.hasInitialized()) await renderer.dispose();
        else if (renderer) {
            // r186 dispose() on an uninitialized renderer starts init() again via setAnimationLoop.
            // Release only resources that were actually created; preserve the original failure.
            const partial = renderer.backend as unknown as BackendAccess;
            partial.device?.destroy(); partial.gl?.getExtension('WEBGL_lose_context')?.loseContext();
        }
        throw error;
    }
}
export type LabEngine = Awaited<ReturnType<typeof createEngine>>;
