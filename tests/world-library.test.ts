import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openWorldRepository, WORLD_DB_NAME, type SavedWorld } from '../src/world-library';
const world = (id: string, updatedAt = 1): SavedWorld => ({ id, name: 'Мир ' + id, updatedAt, project: '{"complete":"snapshot"}', preview: 'data:image/png;base64,preview' });

test('IndexedDB worlds and last-session pointer survive reopening and previews are returned without project data', async () => {
    const factory = new IDBFactory(), repository = await openWorldRepository(factory);
    await repository.put(world('a')); await repository.put(world('b', 2));
    const summaries = await repository.list();
    assert.deepEqual(summaries.map(item => item.id), ['b', 'a']); assert.ok(!('project' in summaries[0]));
    repository.close(); const reopened = await openWorldRepository(factory);
    assert.deepEqual(await reopened.last(), world('b', 2)); assert.deepEqual(await reopened.get('a'), world('a')); reopened.close();
});

test('selection and deleting an inactive world leave the active session intact', async () => {
    const repository = await openWorldRepository(new IDBFactory());
    await repository.put(world('a')); await repository.put(world('b')); await repository.select('a');
    await repository.remove('b'); assert.equal((await repository.last())!.id, 'a');
    await assert.rejects(repository.select('missing')); assert.equal((await repository.last())!.id, 'a');
    await repository.remove('a'); assert.equal(await repository.last(), undefined); assert.deepEqual(await repository.list(), []); repository.close();
});

test('failed IndexedDB writes atomically preserve both the project and session pointer', async () => {
    const factory = new IDBFactory(), repository = await openWorldRepository(factory);
    await repository.put(world('a'));
    const invalid = { ...world('b'), project: (() => {}) as unknown as string };
    await assert.rejects(repository.put(invalid));
    assert.equal(await repository.get('b'), undefined); assert.equal((await repository.last())!.id, 'a'); repository.close();
});

test('an unsupported future database version is rejected without resetting its data', async () => {
    const factory = new IDBFactory();
    const empty = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(WORLD_DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    // An existing higher version is explicitly rejected rather than resetting data.
    empty.close();
    const future = await new Promise<IDBDatabase>(resolve => { const request = factory.open(WORLD_DB_NAME, 3); request.onsuccess = () => resolve(request.result); });
    future.close(); await assert.rejects(openWorldRepository(factory));
});
