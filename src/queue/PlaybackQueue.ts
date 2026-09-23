// Pure playlist state, kept separate from DOM so it's unit-testable.

export interface QueueItem {
  id: string;
  trackId: string;
  title?: string;
}

export class PlaybackQueue {
  private items: QueueItem[] = [];
  private currentItemId: string | null = null;
  private listeners: Array<() => void> = [];

  get queue(): readonly QueueItem[] {
    return this.items;
  }

  get currentId(): string | null {
    return this.currentItemId;
  }

  get canGoNext(): boolean {
    return this.currentIndex >= 0 && this.currentIndex < this.items.length - 1;
  }

  get canGoPrevious(): boolean {
    return this.currentIndex > 0;
  }

  replace(items: readonly QueueItem[], currentId: string | null): void {
    this.items = items.map((item) => ({ ...item }));
    this.currentItemId = this.items.some((item) => item.id === currentId) ? currentId : null;
    this.notify();
  }

  add(trackId: string, id: string = crypto.randomUUID(), title?: string): QueueItem {
    const item: QueueItem = { id, trackId, title };
    this.items.push(item);
    this.notify();
    return item;
  }

  setTitle(id: string, title: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.title === title) return;
    item.title = title;
    this.notify();
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    if (this.currentItemId === id) this.currentItemId = null;
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

  select(id: string): string | null {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    this.currentItemId = item.id;
    this.notify();
    return item.trackId;
  }

  next(): string | null {
    const currentIndex = this.currentIndex;
    if (currentIndex === -1) return null;
    const nextItem = this.items[currentIndex + 1];
    return nextItem ? this.select(nextItem.id) : null;
  }

  previous(): string | null {
    const currentIndex = this.currentIndex;
    if (currentIndex <= 0) return null;
    const previousItem = this.items[currentIndex - 1];
    return previousItem ? this.select(previousItem.id) : null;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private get currentIndex(): number {
    return this.currentItemId ? this.items.findIndex((item) => item.id === this.currentItemId) : -1;
  }
}
