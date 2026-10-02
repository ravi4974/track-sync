# Track Sync Agent Instructions

## Project Shape

- This is a browser-only Vite app written in vanilla TypeScript. There is no application backend; peer connectivity uses PeerJS/WebRTC and its signaling service.
- Read [README.md](README.md) for setup, user workflow, and the deployed app. Treat [package.json](package.json), [tsconfig.json](tsconfig.json), [vite.config.js](vite.config.js), and [vitest.config.ts](vitest.config.ts) as the authoritative tool configuration.
- The GitHub Pages deployment base is `/track-sync/` in [vite.config.js](vite.config.js). Preserve it when changing asset URLs or routing.

## Commands

Run these from the repository root. In PowerShell, use `npm.cmd` because the npm PowerShell shim may be blocked by execution policy.

```text
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run dev
npm.cmd run preview
```

Run the narrowest relevant Vitest test while iterating, then run `npm.cmd test` and `npm.cmd run build` before finishing. The build runs TypeScript checking followed by the Vite production build.

## Architecture Boundaries

- [src/main.ts](src/main.ts) is imperative DOM composition and event wiring. Keep reusable state and synchronization logic in plain classes or services so it can be tested without a browser DOM.
- [src/providers/MediaProvider.ts](src/providers/MediaProvider.ts) is the provider contract; [src/providers/YouTubeProvider.ts](src/providers/YouTubeProvider.ts) is the YouTube IFrame implementation. New media sources should implement the contract rather than coupling sync code to YouTube.
- [src/queue/PlaybackQueue.ts](src/queue/PlaybackQueue.ts) owns queue state and change listeners. Keep queue mutations here and let `main.ts` render and wire controls.
- [src/storage/LibraryStore.ts](src/storage/LibraryStore.ts) owns IndexedDB favorites, playlists, and history. Use its injectable `dbName` for test isolation; schema changes require an IndexedDB version migration.
- [src/sync/PeerLink.ts](src/sync/PeerLink.ts) is the narrow, fakeable transport contract. Services and tests should depend on it rather than the concrete [src/sync/PeerConnectionManager.ts](src/sync/PeerConnectionManager.ts).
- [src/sync/protocol.ts](src/sync/protocol.ts) is the canonical discriminated-union wire protocol. Every message needs `senderId`, `seq`, and `ts`; add new message kinds to the union and cover them with protocol tests.
- [src/sync/LeadershipService.ts](src/sync/LeadershipService.ts) owns leader identity and leadership transfer. [src/sync/PlaybackSyncService.ts](src/sync/PlaybackSyncService.ts) applies leader-authoritative playback behavior, clock correction, stream reconciliation, and echo suppression. [src/sync/ClockSync.ts](src/sync/ClockSync.ts) estimates per-peer clock offset and RTT.

## Synchronization Rules

- With a `LeadershipView`, only the leader broadcasts authoritative load, play, pause, seek, and playback-stream updates. Non-leader local controls may affect the local provider but must not broadcast; loading a different track is leader-only.
- Remote timestamps must be corrected using the measured clock offset. Do not add an extra half-RTT to a timestamp delta that already includes message transit.
- All peers must converge on the exact computed timeline position. Use bounded seek retries to avoid deadlocking on a stalled provider, not playback-rate changes or pause-and-hold catch-up behavior.
- Resume synchronization runs before and after `play()` to account for buffering differences. Preserve echo suppression while YouTube transitions are asynchronous.
- Remote YouTube loads must use `cueVideoById`, not autoplay. Provider `play()` and `pause()` should resolve only after confirmed iframe state events.
- Avoid broadcasting duplicate playback state when track, play state, and predicted position have not materially changed; the iframe can repeat state events.

## TypeScript and Testing Conventions

- The compiler uses strict unused-local/parameter checks, `verbatimModuleSyntax`, bundler resolution, and `erasableSyntaxOnly`. Do not use TypeScript enums or constructor parameter-property shorthand; assign constructor fields explicitly.
- Keep imports with `.ts` extensions, matching the existing bundler configuration.
- Use Vitest `describe`/`it`/`expect`. Follow nearby tests for fake `PeerLink` implementations, injected clocks/randomness, and async flushing of queued inbound messages.
- Test synchronization behavior for ordering, buffering, drift correction, leader gating, and echo suppression. Avoid relying on real time or real PeerJS connections when a fake transport/provider can express the case.
- Do not add tests around the DOM-heavy composition in `main.ts` unless the behavior cannot reasonably be extracted into a testable class.

## Change Discipline

- Start from the owning abstraction and make the smallest compatible change. Preserve public contracts unless the request requires an API change.
- Before editing, inspect the neighboring implementation and test. After an edit, run the narrowest relevant test or build check immediately; do not broaden changes until that check is understood.
- Do not invent backend APIs, credentials, or server-side persistence. Browser/runtime behavior involving YouTube or WebRTC may need manual validation in addition to automated tests.
- Keep user-facing styling consistent with the existing CSS in [src/style.css](src/style.css), and verify responsive queue/player behavior when changing the UI.