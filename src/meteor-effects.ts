import * as T from 'three';
import { mulberry32 } from './noise';
import type { EditorModel } from './state';
import type { FireSite, MeteorImpact, MeteorPlan } from './meteor-impact';
import type { Vec3 } from './world';

function particlePool(capacity: number, additive: boolean) {
    const positions = new Float32Array(capacity * 3), colors = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity);
    const velocities = new Float32Array(capacity * 3), age = new Float32Array(capacity), life = new Float32Array(capacity), baseSize = new Float32Array(capacity), gravity = new Float32Array(capacity);
    const geometry = new T.BufferGeometry();
    for (const [name, data, width] of [['position', positions, 3], ['aColor', colors, 3], ['aSize', sizes, 1], ['aAlpha', alphas, 1]] as const)
        geometry.setAttribute(name, new T.BufferAttribute(data, width).setUsage(T.DynamicDrawUsage));
    const material = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { uViewport: { value: 600 } },
        vertexShader: `attribute vec3 aColor; attribute float aSize,aAlpha; uniform float uViewport; varying vec3 vColor; varying float vAlpha;
            void main(){vColor=aColor;vAlpha=aAlpha;vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
            gl_PointSize=clamp(aSize*uViewport/max(1.0,-p.z),0.0,160.0);}`,
        fragmentShader: `varying vec3 vColor;varying float vAlpha;
            void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0||vAlpha<.002)discard;
            float soft=pow(1.0-r*r,2.0);gl_FragColor=vec4(vColor,vAlpha*soft);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            }`,
    });
    const mesh = new T.Points(geometry, material); mesh.frustumCulled = false; mesh.name = additive ? 'Meteor fire and sparks' : 'Meteor smoke';
    mesh.renderOrder = additive ? 5 : 4;
    let cursor = 0, active = 0;
    return {
        mesh,
        emit(p: Vec3, v: Vec3, size: number, seconds: number, color: Vec3, pull: number) {
            const i = cursor++ % capacity, k = i * 3;
            positions.set(p, k); velocities.set(v, k); colors.set(color, k); age[i] = 0; life[i] = seconds; baseSize[i] = size; gravity[i] = pull;
        },
        update(dt: number, windX: number, windZ: number, viewport: number) {
            active = 0; material.uniforms.uViewport.value = viewport;
            for (let i = 0; i < capacity; i++) {
                age[i] += dt;
                if (age[i] >= life[i]) { sizes[i] = alphas[i] = 0; continue; }
                active++; const k = i * 3, t = age[i] / life[i];
                velocities[k + 1] += gravity[i] * dt;
                positions[k] += (velocities[k] + windX * (additive ? .1 : 1)) * dt;
                positions[k + 1] += velocities[k + 1] * dt; positions[k + 2] += (velocities[k + 2] + windZ * (additive ? .1 : 1)) * dt;
                sizes[i] = baseSize[i] * (additive ? 1 - t * .5 : .65 + t * 2.5);
                alphas[i] = Math.min(1, age[i] * 12) * (1 - t) * (additive ? .95 : .65);
            }
            for (const attribute of Object.values(geometry.attributes)) (attribute as T.BufferAttribute).needsUpdate = true;
            mesh.visible = active > 0;
        },
        clear() { life.fill(0); alphas.fill(0); sizes.fill(0); active = 0; mesh.visible = false; },
        get active() { return active; },
        dispose() { geometry.dispose(); material.dispose(); },
    };
}
export function createMeteorEffects(model: EditorModel, scene: T.Scene,particleBudget?:number) {
    // Allocate only during a scenario, then reuse bounded buffers for every effect.
    const budget = particleBudget??{ low: 180, balanced: 420, high: 760 }[model.state.quality];
    const smoke = particlePool(budget, false), sparks = particlePool(budget, true);
    const group = new T.Group(); group.name = 'Walk scenario: meteor'; group.userData.noWaterReflection=true;group.add(smoke.mesh, sparks.mesh); scene.add(group);
    const rock = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ color: 0x33211b, emissive: 0xff5510, emissiveIntensity: 2, roughness: .95 }));
    const halo = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: 0xffa226, transparent: true, opacity: .3, depthWrite: false, blending: T.AdditiveBlending }));
    const wave = new T.Mesh(new T.RingGeometry(.92, 1, 64), new T.MeshBasicMaterial({ color: 0xf7c29b, side: T.DoubleSide, transparent: true, depthWrite: false, opacity: .6 }));
    wave.material.forceSinglePass=true;
    wave.rotation.x = -Math.PI / 2;
    const flash = new T.Mesh(new T.SphereGeometry(1, 16, 10), new T.MeshBasicMaterial({ color: 0xffdf9c, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    // Effects report illumination to one permanent scene light. Adding/removing a
    // PointLight per meteor recompiles every lit material for each pool size.
    const light = {position:new T.Vector3(),intensity:0,distance:180}; group.add(rock, halo, wave, flash);
    let random = mulberry32(1), trailTime = 0, fireTime = 0;
    let plan: MeteorPlan, impact: MeteorImpact | undefined;
    const position = new T.Vector3(),target=new T.Vector3();
    function start(next: MeteorPlan) {
        group.visible=true;
        plan = next; random = mulberry32(plan.seed ^ 0x74be); impact = undefined; trailTime = fireTime = 0;
        rock.visible = halo.visible = true; flash.visible = wave.visible = false;
        rock.scale.setScalar(plan.radius); halo.scale.setScalar(plan.radius * 1.9); smoke.clear(); sparks.clear();
        fly(0, 0);
    }
    function fly(t: number, dt: number) {
        position.fromArray(plan.start).lerp(target.fromArray(plan.target), t);
        rock.position.copy(position); rock.rotation.x += dt * 1.3; rock.rotation.z += dt * .8;
        halo.position.copy(position); light.position.copy(position); light.intensity = 140 * plan.radius; light.distance = 60 + plan.radius * 15;
        trailTime += dt;
        while (trailTime >= 1 / 30) {
            trailTime -= 1 / 30;
            const s = Math.max(0, t - trailTime / plan.duration), p = plan.start.map((v, i) => v + (plan.target[i] - v) * s) as Vec3;
            smoke.emit(p, [(random() - .5) * 3, 2 + random() * 3, (random() - .5) * 3], plan.radius * 2.5, 4 + random() * 2, [.19, .17, .16], .6);
            sparks.emit(p, [(random() - .5) * 8, random() * 3, (random() - .5) * 8], plan.radius * 1.5, .45, [2, .55, .08], -3);
        }
    }
    function hit(result: MeteorImpact) {
        impact = result; rock.visible = halo.visible = false; flash.visible = wave.visible = true;
        const p = plan.target; flash.position.fromArray(p); wave.position.set(p[0], p[1] + .5, p[2]); wave.material.color.set(result.underwater ? 0xbcecff : 0xf7c29b);
        light.position.set(p[0], p[1] + 6, p[2]);
        const count = Math.min(budget / 2, 50 + plan.radius * 14);
        for (let i = 0; i < count; i++) {
            const a = random() * Math.PI * 2, speed = 8 + random() * result.craterRadius;
            sparks.emit([...p], [Math.cos(a) * speed, 12 + random() * 28, Math.sin(a) * speed], result.underwater ? 2 + random() * 3 : .4 + random(), 1.2 + random() * 2, result.underwater ? [.5, .8, 1.1] : [2, .8, .13], -18);
            if (i % 2 === 0) smoke.emit([...p], [Math.cos(a) * speed * .35, 3 + random() * 10, Math.sin(a) * speed * .35], 5 + plan.radius, 4 + random() * 5, result.underwater ? [.65, .75, .8] : [.25, .20, .16], .5);
        }
    }
    function aftermath(time: number, dt: number, sites: FireSite[], fade: number) {
        if (!impact) return;
        flash.visible = time < .55; flash.scale.setScalar(2 + time * impact.craterRadius * 2); flash.material.opacity = Math.max(0, 1 - time / .55);
        wave.visible = time < 2; wave.scale.setScalar(1 + time * impact.craterRadius * 2); wave.material.opacity = Math.max(0, .5 - time * .25);
        light.intensity = time < 1 ? (1 - time) * 1400 * plan.radius : sites.length ? 160 * fade : 0;
        light.distance = Math.min(600,impact.heatRadius * 2);
        fireTime += dt;
        if (fireTime >= .08) {
            fireTime %= .08;
            for (const site of sites) {
                const spread = site.size * .5, p: Vec3 = [site.position[0] + (random() - .5) * spread, site.position[1], site.position[2] + (random() - .5) * spread];
                sparks.emit(p, [(random() - .5) * .7, 1 + site.size * .8, (random() - .5) * .7], site.size * fade * (1 + random()), .7 + random() * .6, [2, .65 + random() * .3, .06], .4);
                smoke.emit(p, [0, 1 + site.size * .3, 0], site.size * .8 * fade, 3 + random() * 2, [.12, .12, .13], .3);
            }
        }
    }
    return {
        start, fly, hit, aftermath, illumination:light,root:group,
        hide(){group.visible=false;smoke.clear();sparks.clear();light.intensity=0;},
        update(dt: number, viewport: number) {
            const angle = model.state.windDir * Math.PI / 180;
            smoke.update(dt, Math.cos(angle) * model.state.windSpeed * 2, Math.sin(angle) * model.state.windSpeed * 2, viewport);
            sparks.update(dt, 0, 0, viewport);
        },
        get statistics() { return { particles: smoke.active + sparks.active, capacity: budget * 2 }; },
        dispose() { group.removeFromParent(); smoke.dispose(); sparks.dispose(); for (const mesh of [rock, halo, wave, flash]) { mesh.geometry.dispose(); mesh.material.dispose(); } },
    };
}
