import { Vector3 } from 'three';
import { clamp } from './noise';
import type { EditorModel } from './state';
import { HALF } from './state';
import type { Vec3 } from './world';
import {waterAt} from './water-math';
import type {WaterQuery} from './water-surface';
export const PHYSICS_STEP = 1 / 120;
export const WALK_STEP_HEIGHT = .5;
export const WALK_GROUND_SNAP = .4;
export interface WalkMotion {
    resolve(feet: Vector3, movement: Vector3, dt: number, flying?:boolean): { position: Vector3; grounded: boolean };
    ground(x: number, z: number, y: number): number;
}
export interface WalkAnalogInput { forward:number; right:number; up:number; }
/** Catch up ordinary low-FPS frames; discard only pauses longer than one second. */
export class FixedStepClock {
    private accumulator = 0;
    reset() { this.accumulator = 0; }
    advance(elapsed: number, update: (dt: number) => void) {
        if (!Number.isFinite(elapsed) || elapsed < 0)
            return this.accumulator / PHYSICS_STEP;
        this.accumulator += Math.min(elapsed, 1);
        while (this.accumulator + 1e-12 >= PHYSICS_STEP) {
            update(PHYSICS_STEP);
            this.accumulator = Math.max(0, this.accumulator - PHYSICS_STEP);
        }
        return this.accumulator / PHYSICS_STEP;
    }
}
export interface WalkPose {
    on: boolean;
    feet: Vec3;
    yaw: number;
    pitch: number;
    vy: number;
    grounded: boolean;
    swim: boolean;
    flying?: boolean;
    bob: number;
    start?: Vec3 | null;
    autoWalking?: boolean;
    saved: {
        pos: Vec3;
        target: Vec3;
        near: number;
    } | null;
}
export function createWalkSimulation(model: EditorModel, getH: (x: number, z: number) => number, canAutoMove: (x: number, z: number) => boolean = () => true, motion?: WalkMotion,waterQuery?:WaterQuery) {
    const surface=waterQuery??((x:number,z:number)=>waterAt(model.state.water,model.world.waterBodies,x,z));
    const walk = {
        on: false, yaw: 0, pitch: 0, vy: 0, grounded: true, swim: false, flying:false,bob: 0,
        jumpReq: false, feet: new Vector3(), previousFeet: new Vector3(), previousBob: 0,
        saved: null as {
            pos: Vector3;
            target: Vector3;
            near: number;
        } | null,
        dragging: false, lastX: 0, lastY: 0,
        autoWalking: false, paused: false, start: null as Vector3 | null,
    };
    const keys: Record<string, boolean> = {};
    let automaticStall = 0;
    const forward = new Vector3(), right = new Vector3(), move = new Vector3(), eye = new Vector3();
    function synchronize() { walk.previousFeet.copy(walk.feet); walk.previousBob = walk.bob; }
    function clearKeys() { for (const key in keys)
        keys[key] = false; walk.jumpReq = false; walk.dragging = false; walk.autoWalking = false; automaticStall = 0; }
    function setFlying(on:boolean){walk.flying=on;walk.vy=0;walk.grounded=false;walk.swim=false;clearKeys();synchronize();}
    function step(dt: number, analog?:WalkAnalogInput) {
        const settings = model.walkSettings;
        synchronize();
        if (walk.paused) { automaticStall=0; return; }
        forward.set(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
        right.set(-forward.z, 0, forward.x);
        move.set(0, 0, 0);
        const manual = keys.KeyW || keys.ArrowUp || keys.KeyS || keys.ArrowDown || keys.KeyA || keys.ArrowLeft || keys.KeyD || keys.ArrowRight;
        if (keys.KeyW || keys.ArrowUp || walk.autoWalking && !manual)
            move.add(forward);
        if (keys.KeyS || keys.ArrowDown)
            move.sub(forward);
        if (keys.KeyD || keys.ArrowRight)
            move.add(right);
        if (keys.KeyA || keys.ArrowLeft)
            move.sub(right);
        if(analog){move.addScaledVector(forward,analog.forward).addScaledVector(right,analog.right);}
        if(walk.flying){
            walk.vy=0;walk.grounded=false;walk.swim=false;walk.jumpReq=false;
            move.y=(keys.Space?1:0)-(keys.ShiftLeft||keys.ShiftRight?1:0)+(analog?.up??0);
            if(move.lengthSq()>1)move.normalize();
            move.multiplyScalar(settings.speed*2.5*(keys.ControlLeft||keys.ControlRight?settings.sprint:1)*dt);
            move.x=clamp(walk.feet.x+move.x,-HALF+1,HALF-1)-walk.feet.x;
            move.z=clamp(walk.feet.z+move.z,-HALF+1,HALF-1)-walk.feet.z;
            move.y=clamp(walk.feet.y+move.y,-59999,59999)-walk.feet.y;
            if(motion)walk.feet.copy(motion.resolve(walk.feet,move,dt,true).position);
            else {walk.feet.add(move);walk.feet.y=Math.max(getH(walk.feet.x,walk.feet.z),walk.feet.y);}
            return;
        }
        const ground = motion ? motion.ground(walk.feet.x, walk.feet.z, walk.feet.y) : getH(walk.feet.x, walk.feet.z);
        const water=surface(walk.feet.x,walk.feet.z);
        const swimFloor = water.level - settings.eyeHeight + 0.25;
        walk.swim = ground < swimFloor && walk.feet.y <= swimFloor + 0.3;
        const speed = walk.swim ? settings.swimSpeed : settings.speed * (keys.ShiftLeft || keys.ShiftRight ? settings.sprint : 1);
        let moved = false;
        if (move.lengthSq() > 0) {
            if(move.lengthSq()>1)move.normalize();
            move.multiplyScalar(speed * dt);
            const x = clamp(walk.feet.x + move.x, -HALF + 1, HALF - 1), z = clamp(walk.feet.z + move.z, -HALF + 1, HALF - 1);
            const distance = Math.hypot(x - walk.feet.x, z - walk.feet.z) + 1e-6;
            const automatic = walk.autoWalking && !manual;
            if (automatic && (x === walk.feet.x && z === walk.feet.z || !canAutoMove(x, z))) walk.autoWalking = false;
            // The collider controller owns slope/step handling. Mixing a bilinear height
            // with triangle support here blocks small steps, especially at walking speed.
            else if (motion || walk.swim || !walk.grounded || (getH(x, z) - ground) / distance < 1.8) {
                moved = x !== walk.feet.x || z !== walk.feet.z;
                if (!motion) { walk.feet.x = x; walk.feet.z = z; }
            }
        }
        if(walk.swim&&(water.dx||water.dz)){move.x+=water.dx*dt;move.z+=water.dz*dt;moved=true;if(!motion){walk.feet.x=clamp(walk.feet.x+water.dx*dt,-HALF+1,HALF-1);walk.feet.z=clamp(walk.feet.z+water.dz*dt,-HALF+1,HALF-1);}}
        if (walk.jumpReq && (walk.grounded || walk.swim)) {
            walk.vy = walk.swim ? 2.5 : settings.jumpSpeed;
            walk.grounded = false;
        }
        walk.jumpReq = false;
        walk.vy = Math.max(-80,walk.vy-settings.gravity * dt * (walk.swim ? 0.2 : 1));
        if (motion) {
            if (!moved) move.set(0, 0, 0);
            move.y = walk.vy * dt;
            const result = motion.resolve(walk.feet, move, dt), beforeY = walk.feet.y;
            moved = Math.hypot(result.position.x - walk.feet.x, result.position.z - walk.feet.z) > 1e-6;
            if (walk.autoWalking && !manual && !moved && Math.hypot(move.x,move.z)>1e-6) {
                // A single zero-progress contact at a mesh seam is not a persistent obstacle.
                automaticStall += dt; if(automaticStall>=.25)walk.autoWalking=false;
            } else automaticStall=0;
            walk.feet.copy(result.position); walk.grounded = result.grounded;
            if (walk.grounded && walk.vy < 0 || walk.vy > 0 && walk.feet.y - beforeY < move.y - 0.001) walk.vy = 0;
            const destinationWater=surface(walk.feet.x,walk.feet.z).level-settings.eyeHeight+.25;
            if (getH(walk.feet.x,walk.feet.z) < destinationWater && walk.feet.y < destinationWater) { walk.feet.y = destinationWater; walk.vy = 0; walk.grounded = true; }
            if (moved && walk.grounded && !walk.swim) walk.bob += dt * speed * 1.6;
            return;
        }
        walk.feet.y += walk.vy * dt;
        const floor = Math.max(getH(walk.feet.x, walk.feet.z), surface(walk.feet.x,walk.feet.z).level-settings.eyeHeight+.25);
        if (walk.feet.y <= floor || walk.grounded && walk.feet.y - floor < 0.6 && walk.vy <= 0) {
            walk.feet.y = floor;
            walk.vy = 0;
            walk.grounded = true;
        }
        else
            walk.grounded = false;
        if (moved && walk.grounded && !walk.swim)
            walk.bob += dt * speed * 1.6;
    }
    function eyePosition(alpha: number) {
        eye.lerpVectors(walk.previousFeet, walk.feet, alpha);
        const phase = walk.previousBob + (walk.bob - walk.previousBob) * alpha;
        const moving = walk.bob !== walk.previousBob && walk.grounded && !walk.swim;
        eye.y += model.walkSettings.eyeHeight + (model.walkSettings.bob && moving ? Math.sin(phase * 2) * 0.04 : 0);
        eye.y = Math.max(eye.y, getH(eye.x, eye.z) + 0.3);
        return eye;
    }
    function capture(): WalkPose {
        return { on: walk.on, feet: walk.feet.toArray() as Vec3, yaw: walk.yaw, pitch: walk.pitch, vy: walk.vy,
            grounded: walk.grounded, swim: walk.swim, flying:walk.flying,bob: walk.bob, start: walk.start ? walk.start.toArray() as Vec3 : null, autoWalking: walk.autoWalking,
            saved: walk.saved ? { pos: walk.saved.pos.toArray() as Vec3, target: walk.saved.target.toArray() as Vec3, near: walk.saved.near } : null };
    }
    function restore(pose: WalkPose) {
        walk.on = pose.on;
        walk.feet.fromArray(pose.feet);
        walk.yaw = pose.yaw;
        walk.pitch = pose.pitch;
        walk.vy = pose.vy;
        walk.grounded = pose.grounded;
        walk.swim = pose.swim;walk.flying=pose.flying??false;
        walk.bob = pose.bob;
        walk.start = pose.start ? new Vector3().fromArray(pose.start) : null;
        walk.paused = false;
        walk.saved = pose.saved ? { pos: new Vector3().fromArray(pose.saved.pos), target: new Vector3().fromArray(pose.saved.target), near: pose.saved.near } : null;
        clearKeys();
        synchronize();
    }
    return { walk, keys, step, eyePosition, synchronize, clearKeys, capture, restore,setFlying };
}
