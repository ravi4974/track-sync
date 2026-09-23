# Track Sync

Track Sync is a browser-based shared YouTube playback experience. Pair two devices with a room code, then play, pause, seek, and load videos together.

## Live

[Open Track Sync on GitHub Pages](https://ravi4974.github.io/track-sync/)

## Features

- Synchronizes YouTube playback between paired devices through PeerJS and WebRTC.
- Corrects for clock differences and buffering so peers converge on the same playback position.
- Supports a local playback queue with next, previous, shuffle, and drag-to-reorder controls.
- Stores favorites and listening history locally in IndexedDB, and syncs library updates with a connected peer.

## Getting Started

Prerequisites: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Vite prints the local development URL after starting the server.

## Usage

1. Open Track Sync on two devices or browser windows.
2. Copy the room code shown on one device.
3. Enter that code on the other device and select the connect button.
4. Add a YouTube video ID or URL to the queue, then use the player controls on either connected device.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Type-check the project and create a production build. |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Run the Vitest test suite. |

## Technology

- TypeScript and Vite
- YouTube IFrame Player API
- PeerJS / WebRTC
- IndexedDB via `idb`