import type { BrushSystem } from './brushes';
import type { Feedback } from './feedback';
import type { MaterialsSystem } from './materials';
import { applyDocument, captureDocument, type DocumentSnapshot, type ProjectView } from './project';
import { UNDO_LIMIT, type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
export interface HistoryTransaction {
    readonly active: boolean;
    commit(): void;
    rollback(): void;
    discard(): void;
}
interface Entry {
    document: DocumentSnapshot;
    label: string;
    view?: ProjectView;
}
export function createHistory(model: EditorModel, feedback: Feedback, terrain: TerrainSystem, materials: MaterialsSystem, vegetation: VegetationSystem, brushes: BrushSystem) {
    const undoStack: Entry[] = [], redoStack: Entry[] = [];
    let active: HistoryTransaction | undefined;
    const listeners = new Set<() => void>();
    const changed = () => listeners.forEach(listener => listener());
    let captureView: (() => ProjectView) | undefined, restoreView: ((view: ProjectView) => void) | undefined;
    let refresh = () => { materials.updateWater(); materials.updateMaterial(); feedback.syncAllUI(); };
    const snapshot = (label: string, includeView = false): Entry => ({ document: captureDocument(model), label, view: includeView ? captureView?.() : undefined });
    function restore(entry: Entry) {
        brushes.interaction.painting = false;
        brushes.interaction.strokeDirty = false;
        brushes.interaction.hoverHit = null;
        applyDocument(model, entry.document);
        terrain.buildTerrain();
        materials.splatTex.needsUpdate = true; materials.detailTex.needsUpdate = true;
        terrain.updateMeshAll();
        vegetation.rebuild();
        refresh();
        if (entry.view)
            restoreView?.(entry.view);
    }
    function append(entry: Entry) {
        undoStack.push(entry);
        if (undoStack.length > UNDO_LIMIT)
            undoStack.shift();
        redoStack.length = 0;
        feedback.updateUndoButtons(); changed();
    }
    function same(a: DocumentSnapshot, b: DocumentSnapshot) {
        if (a.heights.length !== b.heights.length || a.splat.length !== b.splat.length)
            return false;
        for (let i = 0; i < a.heights.length; i++)
            if (a.heights[i] !== b.heights[i])
                return false;
        for (let i = 0; i < a.splat.length; i++)
            if (a.splat[i] !== b.splat[i])
                return false;
        for (let i = 0; i < a.splatDetail.length; i++) if (a.splatDetail[i] !== b.splatDetail[i]) return false;
        return JSON.stringify({ ...a, heights: undefined, splat: undefined, splatDetail: undefined }) === JSON.stringify({ ...b, heights: undefined, splat: undefined, splatDetail: undefined });
    }
    function flush() { if (model.busy)
        return; active?.commit(); active = undefined; }
    function begin(label = 'Изменение', includeView = false,knownChange=false): HistoryTransaction | undefined {
        if (model.busy)
            return;
        flush();
        const before = snapshot(label, includeView);
        let open = true;
        const transaction: HistoryTransaction = {
            get active() { return open; },
            commit() {
                if (!open)
                    return;
                open = false;
                if (active === transaction)
                    active = undefined;
                // Callers that always append an operation already know this edit
                // changed the document. Keep rollback/undo but skip the second clone.
                if(knownChange){append(before);return;}
                const after = snapshot(label, includeView);
                if (!same(before.document, after.document) || JSON.stringify(before.view) !== JSON.stringify(after.view))
                    append(before);
            },
            discard() {
                if (!open) return;
                open = false;
                if (active === transaction) active = undefined;
            },
            rollback() {
                if (!open)
                    return;
                open = false;
                if (active === transaction)
                    active = undefined;
                restore(before);
                feedback.updateUndoButtons();
            },
        };
        active = transaction;
        return transaction;
    }
    function transaction(label: string, change: () => void, includeView = false,knownChange=false) {
        const edit = begin(label, includeView,knownChange);
        if (!edit)
            return false;
        try {
            change();
            edit.commit();
            return true;
        }
        catch (error) {
            edit.rollback();
            throw error;
        }
    }
    // Compatibility for code that explicitly captures a pre-edit snapshot.
    function pushUndo(label = 'Изменение', includeView = false) { if (model.busy)
        return; flush(); append(snapshot(label, includeView)); }
    function undo() {
        if (model.busy)
            return;
        brushes.endStroke();
        flush();
        const entry = undoStack.pop();
        if (!entry)
            return;
        redoStack.push(snapshot(entry.label, entry.view !== undefined));
        restore(entry);
        feedback.updateUndoButtons();
        feedback.setStatus(`Отменено: ${entry.label}`); changed();
    }
    function redo() {
        if (model.busy)
            return;
        brushes.endStroke();
        flush();
        const entry = redoStack.pop();
        if (!entry)
            return;
        undoStack.push(snapshot(entry.label, entry.view !== undefined));
        restore(entry);
        feedback.updateUndoButtons();
        feedback.setStatus(`Повторено: ${entry.label}`); changed();
    }
    return { onChange(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
        checkpoint() {
            const undo = undoStack.slice(), redo = redoStack.slice();
            return () => { active?.discard(); undoStack.splice(0, undoStack.length, ...undo); redoStack.splice(0, redoStack.length, ...redo); feedback.updateUndoButtons(); };
        },
        get editing() { return !!active?.active; },
        clear() { active?.discard(); undoStack.length = 0; redoStack.length = 0; feedback.updateUndoButtons(); },
        undo, redo, pushUndo, begin, transaction,transactionChanged:(label:string,change:()=>void)=>transaction(label,change,false,true),flush,
        refreshCurrent() { refresh(); },
        bindRefresh(callback: () => void) { refresh = callback; },
        bindView(capture: () => ProjectView, restore: (view: ProjectView) => void) { captureView = capture; restoreView = restore; },
        get redoDepth() { return redoStack.length; }, get undoDepth() { return undoStack.length; },
        get undoLabel() { return undoStack.at(-1)?.label ?? ''; }, get redoLabel() { return redoStack.at(-1)?.label ?? ''; } };
}
export type HistorySystem = ReturnType<typeof createHistory>;
