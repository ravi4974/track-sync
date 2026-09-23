import './style.css';
import { YouTubeProvider } from './providers/YouTubeProvider.ts';
import { PeerConnectionManager } from './sync/PeerConnectionManager.ts';
import { ClockSync } from './sync/ClockSync.ts';
import { PlaybackSyncService } from './sync/PlaybackSyncService.ts';
import { LibrarySyncService } from './sync/LibrarySyncService.ts';
import { LibraryStore } from './storage/LibraryStore.ts';
import { PlaybackQueue, type QueueItem } from './queue/PlaybackQueue.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="app-layout">
    <div id="main-column">
      <section id="pairing">
        <p>Your room code: <strong id="local-code">...</strong> | status: <span id="status">idle</span></p>
        <input id="remote-code" placeholder="Enter peer's room code" maxlength="6" />
        <button id="connect-btn" class="icon-btn" title="Connect" aria-label="Connect">🔗</button>
      </section>
      <section id="player-section">
        <div id="player"></div>
        <div id="player-controls">
          <button id="prev-btn" class="icon-btn" aria-label="Previous">⏮</button>
          <button id="play-pause-btn" class="icon-btn" aria-label="Play">▶</button>
          <button id="next-btn" class="icon-btn" aria-label="Next">⏭</button>
          <button id="favorite-btn" class="icon-btn" title="Add to Favorites" aria-label="Add to Favorites">☆</button>
          <button id="queue-toggle-btn" class="icon-btn" aria-expanded="false" title="Queue" aria-label="Toggle queue">📋</button>
        </div>
      </section>
      <section id="library">
        <h2>Favorites</h2>
        <ul id="favorites-list"></ul>
        <h2>History</h2>
        <ul id="history-list"></ul>
      </section>
    </div>
    <aside id="queue-panel">
      <div id="queue-panel-header">
        <h2>Queue</h2>
        <button id="queue-close-btn" class="icon-btn" title="Close queue" aria-label="Close queue">✕</button>
      </div>
      <div id="queue-add">
        <input id="queue-input" placeholder="YouTube video ID or URL" />
        <button id="queue-add-btn" class="icon-btn" title="Add to queue" aria-label="Add to queue">➕</button>
      </div>
      <button id="queue-shuffle-btn" class="icon-btn" title="Shuffle queue" aria-label="Shuffle queue">🔀</button>
      <ul id="queue-list"></ul>
    </aside>
  </div>
`;

const provider = new YouTubeProvider('player');
const connection = new PeerConnectionManager();
const store = new LibraryStore();
const clockSync = new ClockSync(connection);
const playbackSync = new PlaybackSyncService(provider, connection, clockSync);
const librarySync = new LibrarySyncService(store, connection);

document.querySelector('#local-code')!.textContent = connection.localId;
connection.onStatusChange((status) => {
  document.querySelector('#status')!.textContent = status;
});

document.querySelector('#connect-btn')!.addEventListener('click', () => {
  const remoteInput = document.querySelector<HTMLInputElement>('#remote-code')!;
  if (remoteInput.value.trim()) connection.connectTo(remoteInput.value);
});

const playPauseBtn = document.querySelector<HTMLButtonElement>('#play-pause-btn')!;
playPauseBtn.addEventListener('click', () => {
  if (provider.getState().isPlaying) void playbackSync.pause();
  else void playbackSync.play();
});
provider.onStateChange((state) => {
  playPauseBtn.textContent = state.isPlaying ? '⏸' : '▶';
  playPauseBtn.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
});

const queuePanel = document.querySelector<HTMLElement>('#queue-panel')!;
const queueToggleBtn = document.querySelector<HTMLButtonElement>('#queue-toggle-btn')!;
const queueCloseBtn = document.querySelector<HTMLButtonElement>('#queue-close-btn')!;
queueToggleBtn.addEventListener('click', () => {
  const isOpen = queuePanel.classList.toggle('open');
  queueToggleBtn.setAttribute('aria-expanded', String(isOpen));
});
queueCloseBtn.addEventListener('click', () => {
  queuePanel.classList.remove('open');
  queueToggleBtn.setAttribute('aria-expanded', 'false');
});

document.querySelector('#favorite-btn')!.addEventListener('click', async () => {
  const trackId = provider.getState().trackId;
  if (!trackId) return;
  const title = (provider as any).getVideoTitle?.();
  const item = await store.put({ id: `favorite:${trackId}`, kind: 'favorite', trackId, title });
  librarySync.broadcastLocalChange(item);
});

for (const listId of ['favorites-list', 'history-list']) {
  document.querySelector(`#${listId}`)!.addEventListener('click', (event) => {
    const trackId = (event.target as HTMLElement).dataset.track;
    if (trackId) void playbackSync.load(trackId);
  });
}

function extractVideoId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    return url.searchParams.get('v') ?? url.pathname.split('/').pop() ?? null;
  } catch {
    return null;
  }
}

const playbackQueue = new PlaybackQueue();
let draggedQueueId: string | null = null;

const queueList = document.querySelector<HTMLUListElement>('#queue-list')!;
const prevBtn = document.querySelector<HTMLButtonElement>('#prev-btn')!;
const nextBtn = document.querySelector<HTMLButtonElement>('#next-btn')!;

function renderQueue(): void {
  queueList.innerHTML = playbackQueue.queue
    .map(
      (item: QueueItem) => `
        <li data-id="${item.id}">
          <span class="queue-drag-handle" draggable="true" aria-label="Drag to reorder">⠿</span>
          <div class="queue-item-content">
            <span class="queue-track" data-track="${item.trackId}">${item.title || item.trackId}</span>
            <span class="queue-track-id" data-track="${item.trackId}">${item.title ? `(${item.trackId})` : ''}</span>
          </div>
          <button class="queue-remove-btn" data-id="${item.id}" aria-label="Remove from queue">✕</button>
        </li>`,
    )
    .join('');
  prevBtn.disabled = !playbackQueue.canGoPrevious;
  nextBtn.disabled = !playbackQueue.canGoNext;
}

playbackQueue.onChange(renderQueue);

prevBtn.addEventListener('click', () => {
  const prevTrackId = playbackQueue.previous(provider.getState().trackId);
  if (prevTrackId) void playbackSync.load(prevTrackId);
});

nextBtn.addEventListener('click', () => {
  const nextTrackId = playbackQueue.next(provider.getState().trackId);
  if (nextTrackId) void playbackSync.load(nextTrackId);
});

document.querySelector('#queue-add-btn')!.addEventListener('click', async () => {
  const input = document.querySelector<HTMLInputElement>('#queue-input')!;
  const trackId = extractVideoId(input.value.trim());
  if (!trackId) return;
  
  // Load the video to fetch its title
  await playbackSync.load(trackId);
  
  // Wait a moment for the title to be extracted
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const title = (provider as any).getVideoTitle?.();
  playbackQueue.add(trackId, crypto.randomUUID(), title);
  input.value = '';
});

document.querySelector('#queue-shuffle-btn')!.addEventListener('click', () => {
  playbackQueue.shuffle();
});

queueList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const removeId = target.closest<HTMLElement>('.queue-remove-btn')?.dataset.id;
  if (removeId) {
    playbackQueue.remove(removeId);
    return;
  }
  const trackId = target.closest<HTMLElement>('.queue-track')?.dataset.track;
  if (trackId) void playbackSync.load(trackId);
});

// Only the drag handle initiates dragging, so clicking/removing the rest of the row stays reliable.
queueList.addEventListener('dragstart', (event) => {
  const handle = (event.target as HTMLElement).closest<HTMLElement>('.queue-drag-handle');
  const li = handle?.closest<HTMLLIElement>('li');
  if (!li) return;
  draggedQueueId = li.dataset.id ?? null;
  event.dataTransfer?.setData('text/plain', draggedQueueId ?? '');
});

queueList.addEventListener('dragover', (event) => {
  if (draggedQueueId) event.preventDefault();
});

queueList.addEventListener('drop', (event) => {
  event.preventDefault();
  const targetLi = (event.target as HTMLElement).closest<HTMLLIElement>('li');
  const targetId = targetLi?.dataset.id;
  if (draggedQueueId && targetId) playbackQueue.reorder(draggedQueueId, targetId);
  draggedQueueId = null;
});

renderQueue();

async function renderLibrary(): Promise<void> {
  const items = await store.getAll();
  const render = (kind: 'favorite' | 'history') =>
    items
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => `<li data-track="${item.trackId}"><span class="library-title">${item.title || item.trackId}</span>${item.title ? `<span class="library-track-id">(${item.trackId})</span>` : ''}</li>`)
      .join('');
  document.querySelector('#favorites-list')!.innerHTML = render('favorite');
  document.querySelector('#history-list')!.innerHTML = render('history');
}

store.onChange(() => void renderLibrary());
void renderLibrary();

// Records a history entry whenever a new track starts playing.
let lastHistoryTrackId: string | null = null;
provider.onStateChange((state) => {
  if (state.isPlaying && state.trackId && state.trackId !== lastHistoryTrackId) {
    lastHistoryTrackId = state.trackId;
    const trackId = state.trackId;
    void (async () => {
      const title = (provider as any).getVideoTitle?.();
      const item = await store.put({ id: `history:${trackId}`, kind: 'history', trackId, title });
      librarySync.broadcastLocalChange(item);
    })();
  }
});
