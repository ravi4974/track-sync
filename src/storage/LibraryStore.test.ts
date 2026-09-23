import { describe, expect, it } from 'vitest';
import { LibraryStore } from './LibraryStore.ts';

let dbCounter = 0;
function createStore(): LibraryStore {
  dbCounter += 1;
  return new LibraryStore(`test-db-${dbCounter}`);
}

describe('LibraryStore', () => {
  it('applies a remote item that has no local counterpart', async () => {
    const store = createStore();
    const applied = await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 100 });
    expect(applied).toBe(true);
    const items = await store.getAll();
    expect(items).toHaveLength(1);
  });

  it('rejects a remote item older than the local one (last-write-wins)', async () => {
    const store = createStore();
    await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 200 });
    const applied = await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 100 });
    expect(applied).toBe(false);
  });

  it('accepts a remote item newer than the local one', async () => {
    const store = createStore();
    await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 100 });
    const applied = await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 200 });
    expect(applied).toBe(true);
  });

  it('excludes soft-deleted items from getAll', async () => {
    const store = createStore();
    await store.merge({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc', updatedAt: 100, deletedAt: 100 });
    const items = await store.getAll();
    expect(items).toHaveLength(0);
  });

  it('notifies listeners on put and merge', async () => {
    const store = createStore();
    let notifications = 0;
    store.onChange(() => (notifications += 1));
    await store.put({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc' });
    await store.merge({ id: 'favorite:def', kind: 'favorite', trackId: 'def', updatedAt: 1 });
    expect(notifications).toBe(2);
  });

  it('stores and retrieves titles in library items', async () => {
    const store = createStore();
    const item = await store.put({
      id: 'favorite:abc',
      kind: 'favorite',
      trackId: 'abc',
      title: 'My Favorite Video',
    });
    expect(item.title).toBe('My Favorite Video');
    const items = await store.getAll();
    expect(items[0].title).toBe('My Favorite Video');
  });

  it('stores and retrieves titles for history items', async () => {
    const store = createStore();
    const item = await store.put({
      id: 'history:xyz',
      kind: 'history',
      trackId: 'xyz',
      title: 'Recently Watched Video',
    });
    expect(item.title).toBe('Recently Watched Video');
    const items = await store.getAll();
    expect(items[0].title).toBe('Recently Watched Video');
  });

  it('preserves titles when merging remote items', async () => {
    const store = createStore();
    await store.merge({
      id: 'favorite:abc',
      kind: 'favorite',
      trackId: 'abc',
      title: 'Remote Title',
      updatedAt: 100,
    });
    const items = await store.getAll();
    expect(items[0].title).toBe('Remote Title');
  });

  it('handles items without titles gracefully', async () => {
    const store = createStore();
    const item = await store.put({
      id: 'favorite:abc',
      kind: 'favorite',
      trackId: 'abc',
    });
    expect(item.title).toBeUndefined();
    const items = await store.getAll();
    expect(items[0].title).toBeUndefined();
  });
});

