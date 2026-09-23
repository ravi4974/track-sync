import './style.css';
import { Check, createIcons, Heart, History, Link2, ListMusic, Pause, Play, Plus, Shuffle, SkipBack, SkipForward, X } from 'lucide';
import { YouTubeProvider } from './providers/YouTubeProvider.ts';
import { PeerConnectionManager } from './sync/PeerConnectionManager.ts';
import { ClockSync } from './sync/ClockSync.ts';
import { PlaybackSyncService } from './sync/PlaybackSyncService.ts';
import { LibrarySyncService } from './sync/LibrarySyncService.ts';
import { QueueSyncService } from './sync/QueueSyncService.ts';
import { LibraryStore } from './storage/LibraryStore.ts';
import { PlaybackQueue, type QueueItem } from './queue/PlaybackQueue.ts';

const playerIcons = { Check, Heart, History, Link2, ListMusic, Pause, Play, Plus, Shuffle, SkipBack, SkipForward, X };
const ROOM_CODE_STORAGE_KEY = 'track-sync-room-code';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="app-layout">
    <header id="topbar">
      <a class="brand" href="/" aria-label="Track Sync home">track<span>sync</span></a>
      <section id="pairing" aria-label="Room connection">
        <div class="room-code">
          <label class="room-label" for="local-code-input">Your room</label>
          <div class="room-code-editor">
            <input id="local-code-input" value="..." maxlength="6" autocomplete="off" spellcheck="false" aria-label="Your room code" />
            <button id="set-local-code-btn" class="icon-btn" title="Use this room code" aria-label="Use this room code"><i data-lucide="check"></i></button>
          </div>
        </div>
        <span class="connection-status"><span class="status-dot"></span><span id="status">idle</span></span>
        <div class="connect-form">
          <input id="remote-code" placeholder="Enter room code" maxlength="6" aria-label="Peer room code" />
          <button id="connect-btn" class="icon-btn connect-btn" title="Connect to room" aria-label="Connect to room"><i data-lucide="link-2"></i></button>
        </div>
      </section>
    </header>
    <div id="content-grid">
      <main id="main-column">
        <section id="player-section">
          <div class="player-frame">
            <div id="player"></div>
          </div>
          <div class="player-info">
            <div>
              <p class="eyebrow">Now playing</p>
              <h1 id="current-title">Ready to play</h1>
              <p id="current-subtitle">Add a YouTube video to start the session.</p>
            </div>
            <button id="favorite-btn" class="icon-btn favorite-btn" title="Add to Favorites" aria-label="Add to Favorites"><i data-lucide="heart"></i></button>
          </div>
          <div id="seek-controls">
            <span id="elapsed-time">0:00</span>
            <input id="seek-bar" type="range" min="0" max="0" value="0" step="0.1" aria-label="Seek playback position" disabled />
            <span id="duration-time">0:00</span>
          </div>
        <div id="player-controls">
          <div class="transport-controls">
            <button id="prev-btn" class="icon-btn" title="Previous" aria-label="Previous"><i data-lucide="skip-back"></i></button>
            <button id="play-pause-btn" class="icon-btn play-btn" aria-label="Play"><i data-lucide="play"></i></button>
            <button id="next-btn" class="icon-btn" title="Next" aria-label="Next"><i data-lucide="skip-forward"></i></button>
          </div>
          <button id="queue-toggle-btn" class="icon-btn queue-toggle" aria-expanded="false" title="Queue" aria-label="Toggle queue"><i data-lucide="list-music"></i><span>Queue</span></button>
        </div>
      </section>
      <section id="library">
        <div class="library-group">
          <div class="section-heading"><i data-lucide="heart"></i><h2>Favorites</h2></div>
          <ul id="favorites-list"></ul>
        </div>
        <div class="library-group">
          <div class="section-heading"><i data-lucide="history"></i><h2>History</h2></div>
          <ul id="history-list"></ul>
        </div>
      </section>
      </main>
      <aside id="queue-panel">
      <div id="queue-panel-header">
        <div class="section-heading"><i data-lucide="list-music"></i><h2>Queue</h2></div>
        <button id="queue-close-btn" class="icon-btn" title="Close queue" aria-label="Close queue"><i data-lucide="x"></i></button>
      </div>
      <div id="queue-add">
        <input id="queue-input" placeholder="YouTube video ID or URL" />
        <button id="queue-add-btn" class="icon-btn add-btn" title="Add to queue" aria-label="Add to queue"><i data-lucide="plus"></i></button>
      </div>
      <button id="queue-shuffle-btn" class="text-btn" title="Shuffle queue"><i data-lucide="shuffle"></i>Shuffle queue</button>
      <ul id="queue-list"></ul>
      </aside>
    </div>
    <div id="notification" role="status" aria-live="polite"></div>
  </div>
`;

createIcons({ icons: playerIcons });

const provider = new YouTubeProvider('player');
const savedRoomCode = sessionStorage.getItem(ROOM_CODE_STORAGE_KEY) ?? undefined;
const connection = new PeerConnectionManager(savedRoomCode);
const store = new LibraryStore();
const clockSync = new ClockSync(connection);
const playbackSync = new PlaybackSyncService(provider, connection, clockSync);
const librarySync = new LibrarySyncService(store, connection);

const localCodeInput = document.querySelector<HTMLInputElement>('#local-code-input')!;
localCodeInput.value = connection.localId;
localCodeInput.addEventListener('input', () => {
  localCodeInput.value = localCodeInput.value.toUpperCase();
  localCodeInput.setCustomValidity('');
});
document.querySelector('#set-local-code-btn')!.addEventListener('click', () => {
  const roomCode = localCodeInput.value.trim().toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(roomCode)) {
    localCodeInput.setCustomValidity('Use six letters or numbers, excluding I, O, 0, and 1.');
    localCodeInput.reportValidity();
    return;
  }
  if (roomCode === connection.localId) return;
  sessionStorage.setItem(ROOM_CODE_STORAGE_KEY, roomCode);
  window.location.reload();
});
connection.onStatusChange((status) => {
  document.querySelector('#status')!.textContent = status;
});
const notification = document.querySelector<HTMLDivElement>('#notification')!;
let notificationTimeout: ReturnType<typeof setTimeout> | null = null;
connection.onPeerDisconnected(({ peerId, allDisconnected }) => {
  notification.textContent = `${peerId} disconnected${allDisconnected ? '. Room is now idle.' : '.'}`;
  notification.classList.add('visible');
  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => notification.classList.remove('visible'), 4_000);
});

document.querySelector('#connect-btn')!.addEventListener('click', () => {
  const remoteInput = document.querySelector<HTMLInputElement>('#remote-code')!;
  if (remoteInput.value.trim()) connection.connectTo(remoteInput.value);
});

const playPauseBtn = document.querySelector<HTMLButtonElement>('#play-pause-btn')!;
const seekBar = document.querySelector<HTMLInputElement>('#seek-bar')!;
const elapsedTime = document.querySelector<HTMLSpanElement>('#elapsed-time')!;
const durationTime = document.querySelector<HTMLSpanElement>('#duration-time')!;
let isSeeking = false;

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function updateSeekControls(): void {
  const state = provider.getState();
  const duration = provider.getDuration();
  const elapsed = state.isPlaying ? state.positionSec + (Date.now() - state.updatedAt) / 1000 : state.positionSec;
  const position = Math.min(Math.max(elapsed, 0), duration || elapsed);
  seekBar.max = String(duration);
  seekBar.disabled = duration <= 0;
  if (!isSeeking) seekBar.value = String(position);
  elapsedTime.textContent = formatTime(isSeeking ? Number(seekBar.value) : position);
  durationTime.textContent = formatTime(duration);
}

seekBar.addEventListener('pointerdown', () => { isSeeking = true; });
seekBar.addEventListener('input', () => {
  isSeeking = true;
  elapsedTime.textContent = formatTime(Number(seekBar.value));
});
seekBar.addEventListener('change', () => {
  isSeeking = false;
  void playbackSync.seek(Number(seekBar.value));
});
setInterval(updateSeekControls, 250);

playPauseBtn.addEventListener('click', () => {
  if (provider.getState().isPlaying) void playbackSync.pause();
  else void playbackSync.play();
});
provider.onStateChange((state) => {
  playPauseBtn.innerHTML = `<i data-lucide="${state.isPlaying ? 'pause' : 'play'}"></i>`;
  createIcons({ icons: playerIcons });
  playPauseBtn.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
  if (state.trackId) {
    document.querySelector('#current-title')!.textContent = state.title || state.trackId;
    document.querySelector('#current-subtitle')!.textContent = state.isPlaying ? 'Playing in this shared room' : 'Paused in this shared room';
  }
  updateSeekControls();
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

async function fetchVideoTitle(trackId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${trackId}`)}&format=json`);
    if (!response.ok) return null;
    const metadata = await response.json() as { title?: unknown };
    return typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : null;
  } catch {
    return null;
  }
}

const playbackQueue = new PlaybackQueue();
new QueueSyncService(playbackQueue, connection);
let draggedQueueId: string | null = null;

const queueList = document.querySelector<HTMLUListElement>('#queue-list')!;
const prevBtn = document.querySelector<HTMLButtonElement>('#prev-btn')!;
const nextBtn = document.querySelector<HTMLButtonElement>('#next-btn')!;

function renderQueue(): void {
  queueList.innerHTML = playbackQueue.queue
    .map(
      (item: QueueItem) => `
        <li data-id="${item.id}"${item.id === playbackQueue.currentId ? ' class="current"' : ''}>
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
  const prevTrackId = playbackQueue.previous();
  if (prevTrackId) void playbackSync.load(prevTrackId);
});

nextBtn.addEventListener('click', () => {
  const nextTrackId = playbackQueue.next();
  if (nextTrackId) void playbackSync.load(nextTrackId);
});

document.querySelector('#queue-add-btn')!.addEventListener('click', async () => {
  const input = document.querySelector<HTMLInputElement>('#queue-input')!;
  const trackId = extractVideoId(input.value.trim());
  if (!trackId) return;

  const item = playbackQueue.add(trackId);
  void fetchVideoTitle(trackId).then((title) => {
    if (title) playbackQueue.setTitle(item.id, title);
  });
  if (!provider.getState().trackId) {
    playbackQueue.select(item.id);
    await playbackSync.load(trackId);
  }
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
  const itemId = target.closest<HTMLLIElement>('li')?.dataset.id;
  if (itemId) {
    const trackId = playbackQueue.select(itemId);
    if (trackId) void playbackSync.load(trackId);
  }
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
