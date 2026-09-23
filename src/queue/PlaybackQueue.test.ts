import { describe, expect, it, vi } from 'vitest';
import { PlaybackQueue } from './PlaybackQueue.ts';

describe('PlaybackQueue', () => {
  it('adds tracks and exposes them in order', () => {
    const queue = new PlaybackQueue();

    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');

    expect(queue.queue).toEqual([
      { id: 'id-a', trackId: 'track-a' },
      { id: 'id-b', trackId: 'track-b' },
    ]);
  });

  it('removes a track by id', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');

    queue.remove('id-a');

    expect(queue.queue).toEqual([{ id: 'id-b', trackId: 'track-b' }]);
  });

  it('shuffles using the injected random source', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');
    queue.add('track-c', 'id-c');

    // Always swap with the first element so the order is fully reversed.
    queue.shuffle(() => 0);

    expect(queue.queue.map((item) => item.id)).toEqual(['id-b', 'id-c', 'id-a']);
  });

  it('reorders a dragged item next to a drop target', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');
    queue.add('track-c', 'id-c');

    queue.reorder('id-a', 'id-c');

    expect(queue.queue.map((item) => item.id)).toEqual(['id-b', 'id-c', 'id-a']);
  });

  it('ignores reordering when dragged and target ids match', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');

    queue.reorder('id-a', 'id-a');

    expect(queue.queue.map((item) => item.id)).toEqual(['id-a', 'id-b']);
  });

  it('dequeues the next track and records the current one in history', () => {
    const queue = new PlaybackQueue();
    queue.add('track-b', 'id-b');
    queue.add('track-c', 'id-c');

    const nextTrackId = queue.next('track-a');

    expect(nextTrackId).toBe('track-b');
    expect(queue.queue.map((item) => item.trackId)).toEqual(['track-c']);
    expect(queue.canGoPrevious).toBe(true);
  });

  it('returns null from next() when the queue is empty', () => {
    const queue = new PlaybackQueue();

    expect(queue.next('track-a')).toBeNull();
  });

  it('steps back through history and re-enqueues the current track', () => {
    const queue = new PlaybackQueue();
    queue.add('track-b', 'id-b');
    queue.next('track-a'); // history: [track-a], queue: []

    const prevTrackId = queue.previous('track-b');

    expect(prevTrackId).toBe('track-a');
    expect(queue.queue.map((item) => item.trackId)).toEqual(['track-b']);
    expect(queue.canGoPrevious).toBe(false);
  });

  it('returns null from previous() when there is no history', () => {
    const queue = new PlaybackQueue();

    expect(queue.previous('track-a')).toBeNull();
  });

  it('reflects queue/history emptiness via canGoNext and canGoPrevious', () => {
    const queue = new PlaybackQueue();

    expect(queue.canGoNext).toBe(false);
    expect(queue.canGoPrevious).toBe(false);

    queue.add('track-a', 'id-a');
    expect(queue.canGoNext).toBe(true);

    queue.next('current');
    expect(queue.canGoNext).toBe(false);
    expect(queue.canGoPrevious).toBe(true);
  });

  it('notifies listeners on add, remove, shuffle, reorder, next and previous', () => {
    const queue = new PlaybackQueue();
    const listener = vi.fn();
    queue.onChange(listener);

    queue.add('track-a', 'id-a');
    queue.add('track-b', 'id-b');
    queue.reorder('id-a', 'id-b');
    queue.shuffle(() => 0);
    queue.next('current');
    queue.previous('track-x');
    queue.remove('id-a');

    expect(listener).toHaveBeenCalledTimes(7);
  });

  it('adds a track with an optional title', () => {
    const queue = new PlaybackQueue();

    queue.add('track-a', 'id-a', 'My Video Title');
    queue.add('track-b', 'id-b');

    expect(queue.queue).toEqual([
      { id: 'id-a', trackId: 'track-a', title: 'My Video Title' },
      { id: 'id-b', trackId: 'track-b', title: undefined },
    ]);
  });

  it('preserves titles when removing tracks', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a', 'Title A');
    queue.add('track-b', 'id-b', 'Title B');
    queue.add('track-c', 'id-c', 'Title C');

    queue.remove('id-b');

    expect(queue.queue).toEqual([
      { id: 'id-a', trackId: 'track-a', title: 'Title A' },
      { id: 'id-c', trackId: 'track-c', title: 'Title C' },
    ]);
  });

  it('preserves titles when shuffling', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a', 'Title A');
    queue.add('track-b', 'id-b', 'Title B');
    queue.add('track-c', 'id-c', 'Title C');

    queue.shuffle(() => 0);

    expect(queue.queue).toEqual([
      { id: 'id-b', trackId: 'track-b', title: 'Title B' },
      { id: 'id-c', trackId: 'track-c', title: 'Title C' },
      { id: 'id-a', trackId: 'track-a', title: 'Title A' },
    ]);
  });

  it('preserves titles when reordering', () => {
    const queue = new PlaybackQueue();
    queue.add('track-a', 'id-a', 'Title A');
    queue.add('track-b', 'id-b', 'Title B');
    queue.add('track-c', 'id-c', 'Title C');

    queue.reorder('id-a', 'id-c');

    expect(queue.queue).toEqual([
      { id: 'id-b', trackId: 'track-b', title: 'Title B' },
      { id: 'id-c', trackId: 'track-c', title: 'Title C' },
      { id: 'id-a', trackId: 'track-a', title: 'Title A' },
    ]);
  });

  it('dequeues next track with title preserved', () => {
    const queue = new PlaybackQueue();
    queue.add('track-b', 'id-b', 'Title B');
    queue.add('track-c', 'id-c', 'Title C');

    const nextTrackId = queue.next('track-a');

    expect(nextTrackId).toBe('track-b');
    expect(queue.queue).toEqual([{ id: 'id-c', trackId: 'track-c', title: 'Title C' }]);
  });
});
