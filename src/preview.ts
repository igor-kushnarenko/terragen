import type { EditorModel } from './state';
import {SIZE,HALF} from './state';
import {waterLevelAt} from './water-math';
/** Camera, weather and walking do not change this height-map thumbnail. */
export function createWorldPreviewCache(model:EditorModel,render=()=>worldPreview(model)) {
    let image='',revision=-1,heights=model.heights,bodies=model.world.waterBodies,water=NaN,snow=NaN;
    const statistics={renders:0,hits:0,lastRenderMs:0};
    return {statistics,get(){
        if(image&&revision===model.terrainRevision&&heights===model.heights&&bodies===model.world.waterBodies&&water===model.state.water&&snow===model.state.snowLine){statistics.hits++;return image;}
        const start=performance.now(),next=render();
        statistics.renders++;statistics.lastRenderMs=performance.now()-start;
        image=next;revision=model.terrainRevision;heights=model.heights;bodies=model.world.waterBodies;water=model.state.water;snow=model.state.snowLine;return image;
    }};
}
// A small map preview stays useful even when the saved camera is below water or in a forest.
export function worldPreview(model: EditorModel) {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    const heights = model.heights, n = model.n;
    let maximum = model.state.water + 1;
    for (const height of heights) maximum = Math.max(maximum, height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = Math.round(x / (canvas.width - 1) * model.N), j = Math.round(y / (canvas.height - 1) * model.N);
        const water=waterLevelAt(model.state.water,model.world.waterBodies,i/model.N*SIZE-HALF,j/model.N*SIZE-HALF);
        const height = heights[j * n + i], t = Math.max(0, Math.min(1, (height - water) / (maximum - water)));
        let color = height <= water ? [27, 70, 102] : height < water + 3 ? [178, 168, 112] : height > model.state.snowLine ? [215, 223, 226] : [60 + t * 60, 113 + t * 20, 66 + t * 55];
        const slope = heights[j * n + Math.min(model.N, i + 1)] - heights[j * n + Math.max(0, i - 1)];
        const shade = height <= water ? 1 : Math.max(0.65, Math.min(1.2, 1 - slope / model.cell * 0.12));
        const offset = (y * canvas.width + x) * 4;
        color = color.map(value => value * shade);
        image.data.set([...color, 255], offset);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}
