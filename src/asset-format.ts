// GLB 2.0 stores its container length in an unsigned 32-bit header. No application size budget.
export const MAX_ASSET_BYTES = 0xffffffff;
export function binaryBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer); let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}
export function base64Binary(text: string) {
    if (text.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) throw new Error('Неверные данные GLB');
    return Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer;
}
export function readGLB(buffer: ArrayBuffer, external = false): Record<string, unknown> {
    if (buffer.byteLength < 20 || buffer.byteLength > MAX_ASSET_BYTES) throw new Error('Неверный размер контейнера GLB 2.0');
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Неверный контейнер GLB 2.0');
    let offset = 12, json: Record<string, unknown> | undefined;
    while (offset < buffer.byteLength) {
        if (offset + 8 > buffer.byteLength) throw new Error('Повреждённый GLB');
        const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true); offset += 8;
        if (length % 4 || offset + length > buffer.byteLength) throw new Error('Повреждённый блок GLB');
        if (type === 0x4e4f534a) { if (json) throw new Error('Повторный JSON GLB'); json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, length))); }
        offset += length;
    }
    if (!json || offset !== buffer.byteLength) throw new Error('Нет JSON GLB');
    validateGLTF(json, external); return json;
}
export function validateGLTF(json: Record<string, unknown>, external = false) {
    if ((json.asset as { version?: string })?.version !== '2.0') throw new Error('Требуется glTF 2.0');
    for(const skin of (json.skins??[]) as {joints?:unknown[]}[])if(!Array.isArray(skin.joints)||!skin.joints.length)throw new Error('В скелете отсутствуют кости');
    const required = json.extensionsRequired as string[] | undefined;
    if (required?.some(x => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(x))) throw new Error('Сжатые Draco / Meshopt / KTX2 модели пока не поддерживаются; экспортируйте обычный GLB');
    for (const collection of ['buffers', 'images']) for (const item of (json[collection] ?? []) as { uri?: string }[]) {
        if (item.uri && !item.uri.startsWith('data:') && (!external || /^(https?:|\/\/|file:|blob:)/i.test(item.uri))) throw new Error('Выберите локальные ресурсы модели; сетевые URL не загружаются');
    }
}
