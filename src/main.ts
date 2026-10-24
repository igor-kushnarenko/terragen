import { createEditor } from './editor';
export { createEditor } from './editor';
declare global {
    interface Window { terrainEditor: ReturnType<typeof createEditor>; }
}
window.terrainEditor = createEditor();
