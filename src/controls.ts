import { createWalkStart, type StartAssessment } from './walk-start';
import * as THREE from 'three';
import type { BrushSystem } from './brushes';
import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import type { MaterialsSystem } from './materials';
import { clamp } from './noise';
import { createWalkSimulation, WALK_STEP_HEIGHT, WALK_GROUND_SNAP, type WalkMotion, type WalkAnalogInput } from './physics';
import type { ProjectView } from './project';
import type { RenderingSystem } from './rendering';
import { TOOLS, type EditorActions, type EditorModel, type ToolId } from './state';
import type { TerrainSystem } from './terrain';
import {waterLevelAt} from './water-math';
import type {WaterQuery} from './water-surface';
export interface TerrainTool {
    readonly active:boolean;
    pointerDown(point:THREE.Vector3,ray:THREE.Ray):void;
    pointerMove(point:THREE.Vector3|null):void;
    pointerUp():void;
    keyDown(event:KeyboardEvent):boolean;
    cancel():void;
    pointerRayDown?(event:PointerEvent,ray:THREE.Ray,point:THREE.Vector3|null):boolean;
}
export interface WalkVehicle {readonly seated:boolean;readonly pointerUI?:boolean;lockView?():void;keyDown(event:KeyboardEvent):boolean;keyUp(event:KeyboardEvent):void;render(alpha:number):void;leaveWalk():void;}
export function createControls(model: EditorModel, terrain: TerrainSystem, render: RenderingSystem, materials: MaterialsSystem, brushes: BrushSystem, feedback: Feedback, history: HistorySystem, actions: EditorActions, setTool: (id: ToolId) => void, motion?: WalkMotion,waterQuery?:WaterQuery) {
    const starts = createWalkStart(model, terrain.getH);
    const simulation = createWalkSimulation(model, terrain.getSurfaceH, (x, z) => {
        if (!motion) return starts.assess(x, z).safe;
        const support = motion.ground(x, z, simulation.walk.feet.y);
        const rise=support-simulation.walk.feet.y;
        return support > waterLevelAt(model.state.water,model.world.waterBodies,x,z) + 0.3 && rise<WALK_STEP_HEIGHT+.1 && rise>-(WALK_GROUND_SNAP+.1);
    }, motion,waterQuery);
    const picking = { on: false, assessment: null as StartAssessment | null };
    const walkPanel = { open: false };
    const inventory = { open: false };
    const photoMode={on:false};
    const xrMode={on:false};
    let xrAnalog:WalkAnalogInput|undefined;
    let walkToolKey: ((event: KeyboardEvent) => boolean) | undefined;
    let vehicle:WalkVehicle|undefined;
    let terrainTool:TerrainTool|undefined;
    let objectSelector:(id:string)=>void=()=>{};
    let synchronizePresentation = () => {};
    const notify = () => { feedback.syncUI('walkBtn'); synchronizePresentation(); };
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.3, 32), new THREE.MeshBasicMaterial({ color: 0x73f7a1, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    marker.rotation.x = -Math.PI / 2; marker.renderOrder = 10; marker.visible = false; render.scene.add(marker);
    const { walk, keys } = simulation;
    const _wf = new THREE.Vector3();
    function findLand(x: number, z: number) { const result = starts.nearest(x, z); return result ? [result.point[0], result.point[2]] : null; }
    function cancelPick() { picking.on = false; picking.assessment = null; marker.visible = false; notify(); }
    function chooseStart() {
        if (model.busy) return;
        terrainTool?.cancel();
        if (walk.on) setWalk(false);
        brushes.endStroke(); simulation.clearKeys(); picking.on = true; picking.assessment = null; notify();
        feedback.setStatus('Выберите старт на местности: зелёный маркер — свободная площадка; Esc — отмена');
    }
    function previewStart() {
        if (!picking.on || model.busy || !brushes.interaction.mouseInside) { marker.visible = false; return; }
        brushes.raycaster.setFromCamera(brushes.mouse, render.camera);
        const hit = terrain.raycastTerrain(brushes.raycaster.ray);
        marker.visible = !!hit;
        if (!hit) { picking.assessment = null; notify(); return; }
        picking.assessment = starts.assess(hit.x, hit.z);
        marker.position.set(hit.x, hit.y + 0.15, hit.z);
        marker.material.color.set(picking.assessment.safe ? 0x73f7a1 : 0xff736f);
        notify();
    }
    function setPaused(paused: boolean) {
        if (walkPanel.open) history.flush();
        walkPanel.open = false;
        inventory.open = false;
        walk.paused = paused; simulation.clearKeys();
        if (paused && document.pointerLockElement) document.exitPointerLock();
        notify();
        if (!paused) render.renderer.domElement.focus({ preventScroll: true });
    }
    function setWalkPanel(open: boolean) {
        if (!walk.on || model.busy || open === walkPanel.open) return;
        brushes.endStroke(); history.flush();
        walkPanel.open = open;
        inventory.open = false;
        walk.paused = open;
        simulation.clearKeys();
        if (open && document.pointerLockElement) document.exitPointerLock();
        notify();
        if (!open) render.renderer.domElement.focus({ preventScroll: true });
    }
    function toggleWalkPanel() { setWalkPanel(!walkPanel.open); }
    function setInventory(open: boolean) {
        if (!walk.on || model.busy || inventory.open === open) return;
        brushes.endStroke(); history.flush(); walkPanel.open = false;
        inventory.open = open; walk.paused = open; simulation.clearKeys();
        if (open && document.pointerLockElement) document.exitPointerLock();
        notify(); if (!open) render.renderer.domElement.focus({ preventScroll: true });
    }
    function setFlight(on:boolean){
        if(!walk.on||walk.paused||model.busy||vehicle?.seated)return;
        simulation.setFlying(on);notify();
        feedback.setStatus(on?'Полёт: WASD — движение · Пробел — вверх · Shift — вниз · Ctrl — ускорение · G — гравитация':'Полёт выключен: гравитация включена');
        render.renderer.domElement.focus({preventScroll:true});
    }
    function toggleFlight(){setFlight(!walk.flying);}
    function toggleAutoWalk() {
        if (!walk.on || walk.paused || walk.flying || model.busy||vehicle?.seated) return;
        walk.autoWalking = !walk.autoWalking;
        if (walk.autoWalking && !starts.assess(walk.feet.x, walk.feet.z).safe) {
            walk.autoWalking = false; feedback.setStatus('Автопрогулка доступна на свободной сухой площадке');
        }
        notify();
    }
    function setWalk(on: boolean, point?: [number, number]) {
        if (on === walk.on)
            return;
        if (on && model.busy) return false;
        if(!on)vehicle?.leaveWalk();
        const start = on ? point ? starts.assess(...point) : starts.nearest(walk.start?.x ?? render.controls.target.x, walk.start?.z ?? render.controls.target.z) : null;
        if (on && !start?.safe) { feedback.setStatus(start?.reason ?? 'Безопасная площадка не найдена. Выберите другое место или измените рельеф.'); return false; }
        terrainTool?.cancel();
        brushes.endStroke(); history.flush(); cancelPick();
        simulation.clearKeys(); walk.paused = false; walkPanel.open = false; inventory.open = false;
        walk.on = on;walk.flying=false;
        if (on) {
            walk.saved = { pos: render.camera.position.clone(), target: render.controls.target.clone(), near: render.camera.near };
            walk.start = new THREE.Vector3(...start!.point);
            walk.feet.copy(walk.start);
            walk.vy = 0;
            walk.grounded = true;
            walk.swim = false;
            walk.bob = 0;
            simulation.synchronize();
            render.camera.getWorldDirection(_wf);
            walk.yaw = Math.atan2(-_wf.x, -_wf.z);
            walk.pitch = 0;
            render.controls.enabled = false;
            render.camera.near = 0.1;
            render.camera.updateProjectionMatrix();
            materials.terrainUniforms.uBrushOn.value = 0;
            brushes.interaction.hoverHit = null;
            brushes.endStroke();
            requestLock();
            feedback.setStatus('Прогулка: WASD — идти · E — панель · R — автопрогулка · Esc — меню · P — редактор');
        }
        else {
            if (document.pointerLockElement)
                document.exitPointerLock();
            render.camera.near = walk.saved ? walk.saved.near : 0.5;
            render.camera.updateProjectionMatrix();
            render.camera.up.set(0, 1, 0);
            if (walk.saved) {
                render.camera.position.copy(walk.saved.pos);
                render.controls.target.copy(walk.saved.target);
            }
            render.controls.enabled = true;
            render.controls.update();
            feedback.setStatus('Режим редактора');
        }
        syncCamera(); notify();
        render.renderer.domElement.focus({ preventScroll: true });
        return true;
    }
    function syncCamera() {
        if(photoMode.on||xrMode.on)return;
        const fov = walk.on ? model.walkSettings.fov : 55;
        if (render.camera.fov !== fov) { render.camera.fov = fov; render.camera.updateProjectionMatrix(); }
    }
    function requestLock() {
        if(xrMode.on)return;
        try {
            const r = render.renderer.domElement.requestPointerLock();
            if (r && r.catch)
                r.catch(() => { });
        }
        catch (e) { /* без pointer lock: обзор перетаскиванием */ }
    }
    function walkLook(dx: number, dy: number) {
        walk.yaw -= dx * model.walkSettings.sensitivity;
        walk.pitch = clamp(walk.pitch - dy * model.walkSettings.sensitivity, -1.55, 1.55);
    }
    document.addEventListener('mousemove', e => {
        if (xrMode.on || photoMode.on || !walk.on || walk.paused || model.busy)
            return;
        if (document.pointerLockElement === render.renderer.domElement)
            walkLook(e.movementX, e.movementY);
        else if (walk.dragging) {
            walkLook(e.clientX - walk.lastX, e.clientY - walk.lastY);
            walk.lastX = e.clientX;
            walk.lastY = e.clientY;
        }
    });
    window.addEventListener('mouseup', () => { walk.dragging = false; });
    function walkUpdate(dt: number) {
        if(vehicle?.seated)return;
        const automatic = walk.autoWalking;
        simulation.step(dt,xrMode.on?xrAnalog:undefined);
        if (automatic && !walk.autoWalking) { feedback.setStatus('Автопрогулка остановлена: впереди небезопасный участок'); notify(); }
    }
    function renderWalk(alpha: number) {
        if(xrMode.on)return;
        syncCamera();
        if(vehicle?.seated){vehicle.render(walk.paused?1:alpha);return;}
        render.camera.position.copy(simulation.eyePosition(alpha));
        render.camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
        document.getElementById('coord')!.textContent = `x ${walk.feet.x.toFixed(0)}  z ${walk.feet.z.toFixed(0)}  h ${walk.feet.y.toFixed(1)} м${walk.swim ? ' · плывёте' : ''}`;
    }
    function captureView(): ProjectView {
        return { camera: { pos: render.camera.position.toArray() as [
                    number,
                    number,
                    number
                ], target: render.controls.target.toArray() as [
                    number,
                    number,
                    number
                ],
                rotation: [render.camera.rotation.x, render.camera.rotation.y, render.camera.rotation.z], near: render.camera.near }, walk: simulation.capture() };
    }
    function restoreView(view: ProjectView) {
        terrainTool?.cancel();
        walkPanel.open = false;
        inventory.open = false;
        cancelPick();
        if (document.pointerLockElement)
            document.exitPointerLock();
        render.camera.position.fromArray(view.camera.pos);
        render.controls.target.fromArray(view.camera.target);
        render.camera.near = view.camera.near;
        render.camera.updateProjectionMatrix();
        render.camera.rotation.set(...view.camera.rotation, view.walk?.on ? 'YXZ' : 'XYZ');
        if (view.walk)
            simulation.restore(view.walk);
        else {
            walk.on = false;
            walk.saved = null;
            simulation.clearKeys();
            simulation.synchronize();
        }
        render.controls.enabled = !walk.on;
        if (walk.on)
            renderWalk(1);
        else
            render.controls.update();
        syncCamera(); notify();
    }
    const help = document.getElementById('help')!;
    let helpReturnFocus: HTMLElement | null = null;
    const toggleHelp = (v: boolean) => {
        if (walk.on && v) setPaused(true);
        if (v && !help.classList.contains('show')) helpReturnFocus = document.activeElement as HTMLElement;
        help.classList.toggle('show', v);
        simulation.clearKeys();
        if (v) document.getElementById('helpClose')!.focus();
        else if (help.contains(document.activeElement)) helpReturnFocus?.focus();
    };
    document.getElementById('helpBtn')!.onclick = () => toggleHelp(true);
    document.getElementById('helpClose')!.onclick = () => toggleHelp(false);
    help.addEventListener('click', (e) => {
        if (e.target === help)
            toggleHelp(false);
    });
    // =====================================================================
    //  Ввод
    // =====================================================================
    const canvas = render.renderer.domElement;
    canvas.tabIndex = 0;
    document.addEventListener('pointerlockchange', () => {
        if (!xrMode.on && !photoMode.on && walk.on && !walk.paused && !vehicle?.pointerUI && document.pointerLockElement !== canvas) setPaused(true);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    function setMouse(e: PointerEvent) { const r = canvas.getBoundingClientRect(); brushes.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; brushes.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1; }
    canvas.addEventListener('pointermove', e => {
        setMouse(e); brushes.interaction.mouseInside = true;
        if(terrainTool?.active&&!walk.on&&!model.busy){brushes.raycaster.setFromCamera(brushes.mouse,render.camera);terrainTool.pointerMove(terrain.raycastTerrain(brushes.raycaster.ray));}
    });
    canvas.addEventListener('pointerleave', () => { brushes.interaction.mouseInside = false; });
    // capture-фаза: срабатывает раньше OrbitControls, поэтому Alt+ЛКМ может включить вращение
    canvas.addEventListener('pointerdown', e => {
        if(photoMode.on||xrMode.on)return;
        if (e.button !== 0)
            return;
        if (walk.on) {
            if (walk.paused || model.busy) return;
            e.stopPropagation();
            e.preventDefault();
            if (!document.pointerLockElement) {
                vehicle?.lockView?.();
                requestLock();
                walk.dragging = true;
                walk.lastX = e.clientX;
                walk.lastY = e.clientY;
            }
            return;
        }
        if (picking.on) {
            e.preventDefault(); e.stopImmediatePropagation();
            if (model.busy) return;
            setMouse(e); previewStart();
            const result = picking.assessment;
            if (result?.safe) setWalk(true, [result.point[0], result.point[2]]);
            else feedback.setStatus(result?.reason ?? 'Кликните по местности');
            return;
        }
        if(terrainTool?.active&&!e.altKey){
            if(model.busy)return;
            setMouse(e);brushes.raycaster.setFromCamera(brushes.mouse,render.camera);const hit=terrain.raycastTerrain(brushes.raycaster.ray);
            if(terrainTool.pointerRayDown?.(e,brushes.raycaster.ray,hit))return;
            e.preventDefault();e.stopImmediatePropagation();
            if(hit){terrainTool.pointerDown(hit,brushes.raycaster.ray);canvas.setPointerCapture(e.pointerId);}return;
        }
        if (e.altKey || model.state.tool === 'camera') {
            render.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
            return;
        }
        render.setLeftButton();
        if (model.busy)
            return;
        setMouse(e);
        brushes.interaction.mouseInside = true;
        brushes.raycaster.setFromCamera(brushes.mouse, render.camera);
        const hit = terrain.raycastTerrain(brushes.raycaster.ray);
        if (!hit)
            return;
        history.begin('Кисть: ' + (TOOLS.find(([id]) => id === model.state.tool)?.[1] ?? model.state.tool));
        brushes.interaction.painting = true;
        brushes.interaction.flattenH = hit.y;
        brushes.interaction.hoverHit = hit;
    }, { capture: true });
    window.addEventListener('pointerup', e => {
        if (e.button === 0) {
            terrainTool?.pointerUp();
            brushes.endStroke();
            render.setLeftButton();
        }
    });
    window.addEventListener('keydown', e => {
        if(xrMode.on)return;
        if (document.querySelector('dialog[open]')) return;
        if (help.classList.contains('show')) {
            if (e.key === 'Escape' || e.code === 'KeyH' || e.key === 'F1') { e.preventDefault(); toggleHelp(false); }
            else if (e.key === 'Tab') { e.preventDefault(); document.getElementById('helpClose')!.focus(); }
            return;
        }
        const t = e.target as HTMLInputElement | null;
        const tag = (t && t.tagName) || '';
        const panelHistoryShortcut = tag === 'SELECT' && walkPanel.open && (e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY');
        if (((tag === 'INPUT' && t?.type !== 'range' && t?.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') && e.key !== 'Escape' && e.key !== 'F1' && !panelHistoryShortcut)
            return;
        if(photoMode.on){if(/^(Key[WASDQE]|Shift)/.test(e.code))keys[e.code]=true;return;}
        if (tag === 'BUTTON' && (e.code === 'Space' || e.key === 'Enter')) return;
        if(terrainTool?.active&&!walk.on&&terrainTool.keyDown(e))return;
        if(walk.on&&walk.flying&&!walk.paused&&!model.busy&&!e.metaKey&&/^(Space|Shift|Control|Key[WASD]|Arrow)/.test(e.code)){
            e.preventDefault();keys[e.code]=true;return;
        }
        if ((walk.on && !walkPanel.open || picking.on) && (e.ctrlKey || e.metaKey)) return;
        if (e.ctrlKey || e.metaKey) {
            if (e.code === 'KeyZ' && !e.shiftKey) {
                e.preventDefault();
                history.undo();
                return;
            }
            if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
                e.preventDefault();
                history.redo();
                return;
            }
            return;
        }
        if (e.code === 'KeyH' || e.key === 'F1') {
            e.preventDefault();
            toggleHelp(!help.classList.contains('show'));
            return;
        }
        if (e.key === 'Escape') {
            toggleHelp(false);
            if (picking.on) cancelPick();
            else if (inventory.open) { e.preventDefault(); setInventory(false); }
            else if (walkPanel.open) { e.preventDefault(); setWalkPanel(false); }
            else if (walk.on) setPaused(!walk.paused);
            return;
        }
        if (e.code === 'KeyP' && !e.repeat) {
            setWalk(!walk.on);
            return;
        }
        if (walk.on && e.code === 'KeyE' && !e.repeat) { e.preventDefault(); toggleWalkPanel(); return; }
        if(walk.on&&e.code==='KeyG'&&!e.repeat){e.preventDefault();toggleFlight();return;}
        if(walk.on&&!walk.paused&&!model.busy&&vehicle?.keyDown(e)){e.preventDefault();return;}
        if (walk.on && !e.repeat && walkToolKey?.(e)) { e.preventDefault(); return; }
        if (walk.on && e.code === 'KeyR' && !e.repeat) { e.preventDefault(); toggleAutoWalk(); return; }
        if (walk.on && walk.paused) return;
        if (walk.on && /^(Key[WASD]|Arrow)/.test(e.code)) { walk.autoWalking = false; notify(); }
        if (walk.on && e.code === 'Space' && !e.repeat && !keys.Space)
            walk.jumpReq = true;
        if (walk.on && (e.code === 'Space' || e.code.startsWith('Arrow')))
            e.preventDefault();
        if ((walk.on || picking.on) && !/^(Key[WASD]|Arrow|Shift|Space)/.test(e.code)) return;
        if (e.code === 'KeyG') {
            Promise.resolve(actions.generateAll()).catch(error => feedback.setStatus('Ошибка: ' + String(error)));
            return;
        }
        if (/^Digit[1-7]$/.test(e.code)) {
            setTool(TOOLS[+e.code.slice(5) - 1][0]);
            return;
        }
        if (e.code === 'BracketLeft') {
            model.state.radius = Math.max(2, Math.round(model.state.radius / 1.15));
            feedback.syncUI('radius');
            materials.terrainUniforms.uBrushRadius.value = model.state.radius;
            return;
        }
        if (e.code === 'BracketRight') {
            model.state.radius = Math.min(200, Math.round(model.state.radius * 1.15 + 1));
            feedback.syncUI('radius');
            materials.terrainUniforms.uBrushRadius.value = model.state.radius;
            return;
        }
        keys[e.code] = true;
    });
    window.addEventListener('keyup', e => { keys[e.code] = false;vehicle?.keyUp(e); });
    window.addEventListener('blur', () => { simulation.clearKeys(); brushes.endStroke(); notify(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { simulation.clearKeys(); notify(); } });
    window.addEventListener('resize', render.resizeViewport);
    const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _mv = new THREE.Vector3();
    function flyUpdate(dt: number) {
        if (!photoMode.on && !model.state.fly)
            return;
        _mv.set(0, 0, 0);
        render.camera.getWorldDirection(_fwd);
        _fwd.y = 0;
        if (_fwd.lengthSq() < 1e-6)
            _fwd.set(0, 0, -1);
        _fwd.normalize();
        _right.crossVectors(_fwd, render.camera.up).normalize();
        if (keys.KeyW)
            _mv.add(_fwd);
        if (keys.KeyS)
            _mv.sub(_fwd);
        if (keys.KeyD)
            _mv.add(_right);
        if (keys.KeyA)
            _mv.sub(_right);
        if (keys.KeyE)
            _mv.y += 1;
        if (keys.KeyQ)
            _mv.y -= 1;
        if (_mv.lengthSq() === 0)
            return;
        const dist = render.camera.position.distanceTo(render.controls.target);
        const speed = (photoMode.on?Math.max(2,Math.min(40,dist*.12)):clamp(dist * 0.8, 40, 600)) * ((keys.ShiftLeft || keys.ShiftRight) ? 3 : 1);
        _mv.normalize().multiplyScalar(speed * dt);
        render.camera.position.add(_mv);
        render.controls.target.add(_mv);
        const g = terrain.getH(render.camera.position.x, render.camera.position.z) + 3;
        if (render.camera.position.y < g) {
            const dy = g - render.camera.position.y;
            render.camera.position.y += dy;
            render.controls.target.y += dy;
        }
    }
    function resetCamera() { render.camera.position.set(-330, 260, 600); render.controls.target.set(0, 30, 0); render.controls.update(); }
    function setPhotoMode(on:boolean){photoMode.on=on;simulation.clearKeys();if(on){terrainTool?.cancel();brushes.endStroke();cancelPick();walk.paused=true;if(document.pointerLockElement)document.exitPointerLock();render.controls.enabled=true;materials.terrainUniforms.uBrushOn.value=0;brushes.interaction.hoverHit=null;}else render.controls.enabled=!walk.on;}
    return { photoMode,setPhotoMode, xrMode,
        setXRMode(on:boolean){xrMode.on=on;xrAnalog=undefined;simulation.clearKeys();if(on&&document.pointerLockElement)document.exitPointerLock();},
        setXRInput(value:WalkAnalogInput){xrAnalog=value;},
        moveXRRoomscale(delta:THREE.Vector3){if(!xrMode.on||walk.paused||model.busy)return;const p=motion?motion.resolve(walk.feet,delta,1/120,walk.flying).position:walk.feet.clone().add(delta);walk.feet.copy(p);simulation.synchronize();},
        teleportXR(point:THREE.Vector3){if(!xrMode.on||walk.paused||model.busy)return;walk.feet.copy(point);walk.vy=0;walk.grounded=true;simulation.synchronize();},
        walk, walkPanel, inventory, picking, starts, findLand, setWalk, chooseStart, cancelPick, previewStart, setPaused, setWalkPanel, setInventory, toggleWalkPanel, toggleAutoWalk,setFlight,toggleFlight,
        get terrainToolActive(){return !!terrainTool?.active;},
        bindWalkToolKeys(callback: (event: KeyboardEvent) => boolean) { walkToolKey = callback; },
        bindVehicle(next:WalkVehicle){vehicle=next;},
        bindTerrainTool(tool:TerrainTool){if(terrainTool!==tool)terrainTool?.cancel();terrainTool=tool;},cancelTerrainTool:()=>terrainTool?.cancel(),
        bindObjectSelector(callback:(id:string)=>void){objectSelector=callback;},selectObject(id:string){objectSelector(id);},
        bindPresentation(callback: () => void) { synchronizePresentation = callback; feedback.uiSync.walkPresentation = () => { syncCamera(); notify(); }; notify(); }, walkUpdate, renderWalk, captureView, restoreView, flyUpdate, resetCamera, synchronize: simulation.synchronize, clearKeys: simulation.clearKeys };
}
export type ControlsSystem = ReturnType<typeof createControls>;
