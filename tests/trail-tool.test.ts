import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera} from 'three';
import {createTrailTool} from '../src/trail-tool';
import {createModel} from '../src/state';

test('trail commit reports incomplete/invalid drafts, preserves points for correction, and clears on successful retry',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{classList:{toggle(){}}}}});t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete (globalThis as any).document;});
 const model=createModel(),statuses:string[]=[];let bound:any,valid=false;
 const tool=createTrailTool(model,{scene:new Scene(),camera:new PerspectiveCamera(),renderer:{domElement:{focus(){}}}} as any,{getH:()=>40} as any,{walk:{on:false},cancelPick(){},clearKeys(){},bindTerrainTool(t:any){bound=t;}} as any,{syncUI(){},setStatus(s:string){statuses.push(s);}} as any,{async buildTrail(){if(!valid)throw Error('Тропа пересекает воду. Проведите кривую по суше.');return true;}} as any,()=>{});
 tool.begin();await tool.commit();assert.match(tool.state.error,/две/);assert.equal(tool.state.active,true);
 tool.state.points.push([0,0],[40,0]);await tool.commit();assert.match(tool.state.error,/воду/);assert.equal(tool.state.points.length,2);assert.equal(tool.state.active,true);
 valid=true;let prevented=false;assert.equal(bound.keyDown({key:'Enter',preventDefault(){prevented=true;}}),true);await new Promise(r=>setTimeout(r,0));assert.equal(prevented,true);assert.equal(tool.state.active,false);assert.equal(tool.state.error,'');assert.equal(tool.state.points.length,0);assert.ok(statuses.some(s=>s.includes('воду')));
});
