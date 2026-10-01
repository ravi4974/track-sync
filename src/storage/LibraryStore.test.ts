import { describe, expect, it } from 'vitest';
import { LibraryStore } from './LibraryStore.ts';

let dbCounter = 0;
function createStore(): LibraryStore {
  dbCounter += 1;
  return new LibraryStore(`test-db-${dbCounter}`);
}

describe('LibraryStore', () => {
  it('clears only the requested kind locally', async () => {
    const store = createStore();
    await store.put({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc' });
    await store.put({ id: 'history:def', kind: 'history', trackId: 'def' });

    await store.clear('favorite');

    expect(await store.getAll()).toEqual([expect.objectContaining({ id: 'history:def' })]);
  });

  it('notifies listeners on put and clear', async () => {
    const store = createStore();
    let notifications = 0;
    store.onChange(() => (notifications += 1));
    await store.put({ id: 'favorite:abc', kind: 'favorite', trackId: 'abc' });
    await store.clear('favorite');
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

