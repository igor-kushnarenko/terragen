import './style.css';
import { REVISION } from 'three';
import { BACKENDS, BENCHMARK, LABELS, comparePixels, measure, type BackendId } from './benchmark';
import { createEngine, type LabEngine } from './engine';
import { LOADS, type LoadId } from './scene';

function element<T extends HTMLElement>(id: string) { const found = document.getElementById(id); if (!found) throw new Error(id); return found as T; }
const viewport = element('viewport'), status = element('status'), active = element('active-backend');
const backend = element<HTMLSelectElement>('backend'), load = element<HTMLSelectElement>('load');
const wet = element<HTMLInputElement>('wet'), wind = element<HTMLInputElement>('wind');
const compare = element<HTMLButtonElement>('compare'), cancel = element<HTMLButtonElement>('cancel'), exportButton = element<HTMLButtonElement>('export');
const animation = element<HTMLButtonElement>('animation'), reset = element<HTMLButtonElement>('reset');
const progress = element<HTMLProgressElement>('progress'), rows = element('results'), shots = element('shots');
const capability = element('capability'), live = element('live'), difference = element('difference');
const editor = element<HTMLAnchorElement>('editor');
if (location.protocol === 'file:') editor.href = './terrain_editor_standalone.html';
capability.textContent = `Three.js r${REVISION} · ${window.isSecureContext ? 'защищённый контекст' : 'незащищённый контекст'} · navigator.gpu: ${'gpu' in navigator ? 'есть (адаптер проверяется при запуске)' : 'нет'}`;

type Result = { id: BackendId; status: string; adapter?: string; actualBackend?: string; medianMs?: number; p95Ms?: number; throughputFps?: number | null; samples?: number[]; drawCalls?: number; triangles?: number; meshObjects?: number; instances?: number; png?: string; difference?: ReturnType<typeof comparePixels> };
type Report = { format: 'terrain-webgpu-benchmark'; version: 1; createdAt: string; three: string; userAgent: string; visibility: string; settings: typeof BENCHMARK & { load: LoadId; wetness: number; wind: number; plants: typeof LOADS[LoadId] }; method: string; results: Result[] };
let engine: LabEngine | undefined, busy = false, animated = false, stopped = false, frame = 0, controller: AbortController | undefined;
// At most three contexts per page. Repeated comparisons must not churn contexts/device limits.
const engines = new Map<BackendId, LabEngine>();
let report: Report | undefined;
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function lock(value: boolean) {
    busy = value; for (const control of [backend, load, wet, wind, compare, animation, reset]) control.disabled = value;
    cancel.disabled = !value || !controller; exportButton.disabled = value || !report;
}
function environment() {
    element('wet-value').textContent = `${Math.round(+wet.value * 100)}%`;
    element('wind-value').textContent = `${Math.round(+wind.value * 100)}%`;
    engine?.setEnvironment(+wet.value, +wind.value);
}
async function switchEngine(id: BackendId) {
    engine?.renderer.domElement.remove(); engine = undefined; active.textContent = `Подготовка ${LABELS[id]}…`;
    let next = engines.get(id);
    if (!next) { next = await createEngine(id, load.value as LoadId, viewport); engines.set(id, next); }
    else { await next.setLoad(load.value as LoadId); viewport.replaceChildren(next.renderer.domElement); }
    if (stopped) { await next.dispose(); engines.delete(id); throw new DOMException('Страница закрыта', 'AbortError'); }
    next.controls.enabled = true;
    engine = next; backend.value = id; environment();
    active.textContent = `${LABELS[id]} · подтверждён ${next.actualBackend}`;
    live.textContent = `${next.adapter} · ${next.getStats().meshObjects} меша · ${next.getStats().instances.toLocaleString('ru')} экземпляров`;
    return next;
}
async function change() {
    lock(true); status.textContent = 'Подготовка материалов…';
    try { await switchEngine(backend.value as BackendId); status.textContent = 'Готово. Можно осмотреть сцену или запустить сравнение.'; }
    catch (error) { active.textContent = 'Рендер недоступен'; status.textContent = message(error); }
    finally { lock(false); }
}
function displayResults() {
    rows.replaceChildren(); shots.replaceChildren();
    element('result-settings').textContent = report ? `Замер: ${report.settings.load === 'small' ? 'поляна' : 'лес'} · влажность ${Math.round(report.settings.wetness * 100)}% · ветер ${Math.round(report.settings.wind * 100)}% · ${new Date(report.createdAt).toLocaleString('ru')}` : '';
    for (const result of report?.results ?? []) {
        const row = document.createElement('tr');
        for (const value of [LABELS[result.id], result.medianMs?.toFixed(2) ?? '—', result.p95Ms?.toFixed(2) ?? '—', result.throughputFps?.toFixed(1) ?? '—', result.drawCalls ?? '—', result.triangles?.toLocaleString('ru') ?? '—', result.status]) {
            const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
        }
        rows.append(row);
        if (result.png) {
            const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption'), download = document.createElement('a');
            image.src = result.png; image.alt = `Одинаковый ракурс · ${LABELS[result.id]}`;
            caption.textContent = LABELS[result.id] + (result.difference ? ` · MAE ${result.difference.mae255.toFixed(2)}, RMSE ${result.difference.rmse255.toFixed(2)} / 255` : result.id === 'webgl' ? ' · эталон GLSL' : ' · эталон GLSL недоступен');
            download.href = result.png; download.download = `landscape-${result.id}.png`; download.textContent = 'Скачать PNG';
            figure.append(image, caption, download); shots.append(figure);
        }
    }
}
async function runComparison() {
    controller = new AbortController(); const signal = controller.signal, restore = backend.value as BackendId;
    lock(true); animated = false; animation.textContent = 'Включить анимацию'; animation.setAttribute('aria-pressed', 'false');
    progress.value = 0; difference.textContent = '';
    report = { format: 'terrain-webgpu-benchmark', version: 1, createdAt: new Date().toISOString(), three: REVISION, userAgent: navigator.userAgent, visibility: document.visibilityState,
        settings: { ...BENCHMARK, load: load.value as LoadId, wetness: +wet.value, wind: +wind.value, plants: LOADS[load.value as LoadId] },
        method: 'Median/p95 of 24 GPU-completed batches of 4 frames after 24 warmup frames. WebGL: fenceSync+flush+clientWaitSync (1ms polling); WebGPU: queue.onSubmittedWorkDone. Includes CPU+driver+GPU+synchronization overhead, not GPU timestamp, not vsync FPS. 960x540 DPR1 RGBA8; no MSAA/shadows/reflections. Camera/time reset; same seed/geometry/textures/lights. PNG at t=12; RGB MAE/RMSE against GLSL; no alpha.', results: [] };
    let reference: Uint8ClampedArray | undefined, cancelled = false;
    try {
        for (let index = 0; index < BACKENDS.length; index++) {
            signal.throwIfAborted(); const id = BACKENDS[index];
            status.textContent = `${LABELS[id]}: подготовка и прогрев…`;
            try {
                const current = await switchEngine(id); signal.throwIfAborted(); current.controls.enabled = false; current.resetCamera();
                const measured = await measure(current, signal, (done, total) => { progress.value = (index + done / total) / BACKENDS.length * 100; status.textContent = `${LABELS[id]}: пакет ${done}/${total}`; });
                const snapshot = await current.snapshot();
                const result: Result = { id, status: 'Готово', actualBackend: current.actualBackend, adapter: current.adapter, ...measured, ...current.getStats(), png: snapshot.png };
                if (id === 'webgl') reference = snapshot.pixels;
                else if (reference) result.difference = comparePixels(reference, snapshot.pixels);
                report.results.push(result);
            } catch (error) {
                if (signal.aborted) throw error;
                report.results.push({ id, status: message(error) });
            }
            displayResults();
        }
        difference.textContent = 'MAE/RMSE сравнивают RGB снимков с GLSL при одинаковых камере, времени и настройках. Различия PBR-пайплайнов тоже входят в результат; порог автоматического «совпадения» не назначен.';
        progress.value = 100;
    } catch (error) { cancelled = signal.aborted; if (!cancelled) status.textContent = message(error); }
    finally {
        if (stopped) return;
        try { await switchEngine(restore); } catch { try { await switchEngine('webgl'); } catch (error) { status.textContent = message(error); } }
        displayResults(); lock(false); controller = undefined;
        const successful = report.results.filter(result => result.samples).length;
        status.textContent = cancelled ? `Сравнение отменено. Завершённых замеров: ${successful}.` : `Сравнение завершено. Доступных рендеров: ${successful}/3. Снимки и результаты можно скачать.`;
    }
}
backend.addEventListener('change', () => { void change(); }); load.addEventListener('change', () => { void change(); });
wet.addEventListener('input', environment); wind.addEventListener('input', environment);
reset.addEventListener('click', () => engine?.resetCamera());
animation.addEventListener('click', () => { animated = !animated; animation.textContent = animated ? 'Остановить анимацию' : 'Включить анимацию'; animation.setAttribute('aria-pressed', String(animated)); });
compare.addEventListener('click', () => { void runComparison(); }); cancel.addEventListener('click', () => controller?.abort());
document.addEventListener('visibilitychange', () => { if (document.hidden && controller) controller.abort(); });
exportButton.addEventListener('click', () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `webgpu-${report.settings.load}-${report.createdAt.replace(/[:.]/g, '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let intervalStart = performance.now(), frames = 0;
function animate(now: number) {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    if (!busy && engine && !document.hidden) {
        try { engine.render(animated ? BENCHMARK.time + now / 1000 : BENCHMARK.time); }
        catch (error) { status.textContent = message(error); engines.delete(engine.id); void engine.dispose(); engine = undefined; }
        frames++;
        if (now - intervalStart > 1200 && engine) { const stats = engine.getStats(); live.textContent = `${engine.adapter} · ${stats.meshObjects} меша · ${stats.instances.toLocaleString('ru')} экземпляров · ${stats.drawCalls} вызовов · просмотр ${(frames * 1000 / (now - intervalStart)).toFixed(1)} FPS (VSync)`; frames = 0; intervalStart = now; }
    } else { frames = 0; intervalStart = now; }
}
window.addEventListener('pagehide', () => { stopped = true; cancelAnimationFrame(frame); controller?.abort(); for (const cached of engines.values()) void cached.dispose(); engines.clear(); engine = undefined; });
void change(); frame = requestAnimationFrame(animate);
