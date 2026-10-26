import {createGraphicFilters} from './graphic-filters';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { type EditorModel } from './state';
import {VR_QUALITY_PROFILES} from './quality';
export function configureEditorOrbit(controls: OrbitControls) {
    controls.enableDamping=true;controls.dampingFactor=.12;
    controls.maxPolarAngle=Math.PI*.495;
    controls.minDistance=.75;controls.maxDistance=6000;
    controls.zoomSpeed=2.8;
    controls.zoomToCursor=true;
}
export function createRendering(model: EditorModel) {
    const container = document.getElementById('view')!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.55;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    createGraphicFilters(renderer,()=>model.state.graphicFilter);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.environmentIntensity = 0.65;
    const fog = new THREE.FogExp2(0xaabbcc, 0.0004);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);
    camera.position.set(-330, 260, 600);
    // Keep the world-space observer camera for LOD, sound and weather. Only this
    // separate camera is parented to the player rig and driven by the headset.
    const xrRig = new THREE.Group(); xrRig.name = 'VR player'; xrRig.visible = false;
    const xrCamera = new THREE.PerspectiveCamera(90, 1, .08, 40000);
    xrRig.add(xrCamera); scene.add(xrRig);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(VR_QUALITY_PROFILES[model.xrQuality].framebufferScale);
    renderer.xr.setFoveation(VR_QUALITY_PROFILES[model.xrQuality].foveation);
    const controls = new OrbitControls(camera, renderer.domElement);
    function resizeViewport() {
        const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
    new ResizeObserver(resizeViewport).observe(container);
    controls.target.set(0, 30, 0);
    configureEditorOrbit(controls);
    function setLeftButton() { controls.mouseButtons = { LEFT: model.state.tool === 'camera' ? THREE.MOUSE.ROTATE : undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }; }
    setLeftButton();
    // Небо
    const sky = new Sky();
    sky.scale.setScalar(30000);
    scene.add(sky);
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    // The sun already lights the scene directly; keep its disc out of the PMREM.
    envSky.material.uniforms.showSunDisc.value = false;
    const envScene = new THREE.Scene();
    envScene.add(envSky);
    for (const s of [sky, envSky]) {
        const u = s.material.uniforms;
        u.turbidity.value = 2.5;
        u.rayleigh.value = 3.0;
        u.mieCoefficient.value = 0.005;
        u.mieDirectionalG.value = 0.8;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    // Свет
    const sun = new THREE.DirectionalLight(0xffffff, 4.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -620;
    sc.right = 620;
    sc.top = 620;
    sc.bottom = -620;
    sc.near = 50;
    sc.far = 4000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);
    const hemi = new THREE.HemisphereLight(0xc2d0da, 0x75664e, 0.48);
    scene.add(hemi);
    const sunDir = new THREE.Vector3();
    const atmosBase = { sunInt: 4.2, hemiInt: 0.42, fogDensity: 0.0004, fogColor: new THREE.Color(0xaabbcc), skyZenith: new THREE.Color(), skyHorizon: new THREE.Color(), sunColor: new THREE.Color() };
    return { renderer, scene, fog, camera, xrRig, xrCamera, controls, sky, envSky, envScene, pmrem, sun, hemi, sunDir, atmosBase, setLeftButton, resizeViewport };
}
export type RenderingSystem = ReturnType<typeof createRendering>;
