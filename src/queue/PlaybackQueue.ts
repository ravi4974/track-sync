// Pure queue/history state for the "up next" list, kept separate from DOM so it's unit-testable.

export interface QueueItem {
  id: string;
  trackId: string;
  title?: string;
}

export class PlaybackQueue {
  private items: QueueItem[] = [];
  private history: string[] = [];
  private listeners: Array<() => void> = [];

  get queue(): readonly QueueItem[] {
    return this.items;
  }

  get canGoNext(): boolean {
    return this.items.length > 0;
  }

  get canGoPrevious(): boolean {
    return this.history.length > 0;
  }

  add(trackId: string, id: string = crypto.randomUUID(), title?: string): QueueItem {
    const item: QueueItem = { id, trackId, title };
    this.items.push(item);
    this.notify();
    return item;
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.notify();
  }

  shuffle(random: () => number = Math.random): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
    this.notify();
  }

  reorder(draggedId: string, targetId: string): void {
    if (draggedId === targetId) return;
    const fromIndex = this.items.findIndex((item) => item.id === draggedId);
    const toIndex = this.items.findIndex((item) => item.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, moved);
    this.notify();
  }

  /** Dequeues the next track, pushing currentTrackId onto history for a later "previous". */
  next(currentTrackId: string | null): string | null {
    const nextItem = this.items.shift();
    if (!nextItem) return null;
    if (currentTrackId) {
      this.history.push(currentTrackId);
    }
    this.notify();
    return nextItem.trackId;
  }

  /** Pops the last played track from history, re-enqueuing currentTrackId at the front. */
  previous(currentTrackId: string | null): string | null {
    const prevTrackId = this.history.pop();
    if (!prevTrackId) return null;
    if (currentTrackId) this.items.unshift({ id: crypto.randomUUID(), trackId: currentTrackId });
    this.notify();
    return prevTrackId;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
