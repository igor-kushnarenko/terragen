import {computeTerrainJob} from './terrain-pipeline';
import type { TerrainJob, WorkerReply } from './worker-jobs';
const scope = self as unknown as {
    onmessage: (event: MessageEvent<TerrainJob>) => void;
    postMessage(reply: WorkerReply, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
    try {
        const progress = (fraction: number) => scope.postMessage({ type: 'progress', fraction });
        const heights=computeTerrainJob(data,progress);
        scope.postMessage({ type: 'result', heights }, [heights.buffer]);
    } catch (error) {
        scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
