// Verification only. Asynchronous GPU queries measure submitted rendering work,
// not the browser's idle/occluded requestAnimationFrame interval. No GPU waits.
(() => {
    const original = window.requestAnimationFrame.bind(window), pending = [], samples = [];
    let gl, ext, unavailable = false, disjoint = 0, published = 0;
    function publish() {
        const panel = document.getElementById('graphicsCheck');
        if (!panel) return;
        let output = document.getElementById('graphicsGpu');
        if (!output) { output = document.createElement('pre'); output.id = 'graphicsGpu'; output.style.cssText = 'white-space:pre-wrap;font-size:10px'; panel.append(output); }
        output.textContent = JSON.stringify({supported: !!ext, disjoint, method: 'EXT_disjoint_timer_query_webgl2; async, no gl.finish; milliseconds on GPU, not FPS', samples}, null, 2);
    }
    window.requestAnimationFrame = callback => original(timestamp => {
        if (!gl && !unavailable) {
            gl = document.querySelector('#view canvas')?.getContext('webgl2');
            if (gl) { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); unavailable = !ext; }
        }
        if (ext && !gl.isContextLost()) {
            if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { pending.splice(0).forEach(p => gl.deleteQuery(p.query)); disjoint++; }
            while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
                const p = pending.shift();
                samples.push({timestamp:p.timestamp,scene:p.scene,phase:p.phase,ms:gl.getQueryParameter(p.query,gl.QUERY_RESULT)/1e6});
                gl.deleteQuery(p.query);
            }
            while (samples.length > 1200) {
                const idle = samples.findIndex(s => s.phase === 'idle');samples.splice(idle < 0 ? 0 : idle, 1);
            }
        }
        const query = ext && !gl.isContextLost() && pending.length < 8 ? gl.createQuery() : null;
        if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        try { callback(timestamp); }
        finally {
            if (query) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                const text = document.getElementById('graphicsStatus')?.textContent ?? '';
                pending.push({query,timestamp,scene:text.split(' · ')[0],phase:text.match(/warmup|baseline|storm|recovery/)?.[0] ?? 'idle'});
            }
            if (timestamp - published > 500) { published = timestamp; publish(); }
        }
    });
})();
