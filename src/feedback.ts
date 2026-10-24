import type { EditorModel } from './state';
export function createFeedback(model: EditorModel) {
    const uiSync: Record<string, () => unknown> = {};
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    const setStatus = (message: string) => {
        const element = document.getElementById('status')!;
        element.textContent = message;
        element.style.opacity = '1';
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { element.style.opacity = '0.35'; }, 5000);
    };
    const syncUI = (key: string) => { uiSync[key]?.(); };
    const syncAllUI = () => { Object.values(uiSync).forEach(sync => sync()); };
    const setProgress = (fraction: number) => {
        const bar = document.getElementById('progressBar');
        if (bar)
            {
            const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
            bar.style.width = `${percent}%`;
            bar.parentElement?.setAttribute('aria-valuenow', String(percent));
            const label = document.getElementById('operationLabel');
            if (label) label.textContent = `Вычисление… ${percent}%`;
        }
    };
    const setBusy = (busy: boolean) => {
        model.busy = busy;
        document.getElementById('busy')!.style.display = busy ? 'block' : 'none';
        for (const id of ['btnGen', 'btnErode', 'btnScatter', 'btnPreset', 'btnCompose', 'btnDrawTrail','btnCreateWorld','btnPreviewWorld']) {
            const button = document.getElementById(id) as HTMLButtonElement | null;
            if (button)
                button.disabled = busy;
        }
        updateUndoButtons();
        uiSync.worldCreation?.();
        uiSync.workspace?.();
    };
    let undoDepth = () => 0, redoDepth = () => 0;
    let undoLabel = () => '', redoLabel = () => '';
    const updateUndoButtons = () => {
        const undo = document.getElementById('btnUndo') as HTMLButtonElement | null;
        const redo = document.getElementById('btnRedo') as HTMLButtonElement | null;
        if (undo) {
            undo.disabled = model.busy || undoDepth() === 0;
            undo.title = undoLabel() ? 'Отменить: ' + undoLabel() : 'Отменить';
        }
        if (redo) {
            redo.disabled = model.busy || redoDepth() === 0;
            redo.title = redoLabel() ? 'Повторить: ' + redoLabel() : 'Повторить';
        }
    };
    const bindHistory = (getUndoDepth: () => number, getRedoDepth: () => number, getUndoLabel = () => '', getRedoLabel = () => '') => {
        undoDepth = getUndoDepth;
        redoDepth = getRedoDepth;
        undoLabel = getUndoLabel;
        redoLabel = getRedoLabel;
        updateUndoButtons();
    };
    return { uiSync, setStatus, syncUI, syncAllUI, setProgress, setBusy, updateUndoButtons, bindHistory };
}
export type Feedback = ReturnType<typeof createFeedback>;
