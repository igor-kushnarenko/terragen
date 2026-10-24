import type { EditorModel } from './state';
import type { OperationRecord } from './world';
export function recordOperation(model: EditorModel, kind: OperationRecord['kind'], seed: number, parameters: OperationRecord['parameters'], algorithmVersion: OperationRecord['algorithmVersion'] = 1) {
    model.operations.push({ kind, seed: seed >>> 0, algorithmVersion, parameters: { ...parameters } });
    if (model.operations.length > 10000)
        model.operations.shift();
}
