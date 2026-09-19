# Migration notes

Reference: `../VideoAnalysePy`, inspected at commit `e0ec456c99141b9500540b37918e6ac55a8ed89c` plus the working files present during the rewrite. The Python app has not been modified.

## Architecture

| Layer                                                  | Implementation                            |
| ------------------------------------------------------ | ----------------------------------------- |
| Analysis model, codec, invariants, export ordering     | `src/domain.ts`                           |
| React editing/document lifecycle                       | `src/App.tsx`                             |
| Video element, transport, compact timeline             | `src/Player.tsx`                          |
| Clip draft and Category/export dialogs                 | `src/ClipEditor.tsx`, `src/Dialogs.tsx`   |
| Native menus/dialogs, restricted IPC, media streaming  | `electron/main.ts`, `electron/preload.ts` |
| Atomic persistence, relative paths, media fingerprints | `electron/files.ts`                       |
| Native probing, codec fallback copies                  | `electron/media.ts`                       |
| Restricted historical pickle data import               | `electron/legacy.ts`                      |
| Export preflight, native rendering, cancellation       | `electron/export.ts`                      |

The owner's requested rewrite intentionally replaces the original ADR 0008 Python/QML presentation decision. The original domain vocabulary, UUID relationships, single compact timeline, transient export order, JSON schema, external media, and cancellable drafts remain.

Visual thesis: a dark, compact editing workspace, using the original pink accent, Inter, and JetBrains Mono. Content: Clip/Source navigation at left, video as the dominant surface, a single timeline/transport below it, and a contextual Clip inspector at right. Interactions: immediate transport feedback, brief inspector/dialog entry, and subdued selection/hover states; reduced motion is respected. The frontend skill informed this restrained composition; no marketing page or decorative imagery was added.

## Intentional differences and unfinished parity

- Coaching playlists are a TS extension: `src/Playlists.tsx` provides named, ordered Clip references and `src/useSequencePlayback.ts` runs cancellable bounded playback requests across media loads. Playlist files use schema v2 so older apps cannot silently strip them; playlist-free files remain schema v1. Export reuses the native pipeline with playlist order supplied explicitly. Source transitions may buffer; this is not a gapless multi-video player.

- The interface uses English labels, with the original handball Category defaults (`Abwehr`, `Angriff`, `Tor`). Pixel-perfect QML replication was not the objective.
- Direct legacy import supports the historical ClipItem data representation and its protocol 2–5 data opcodes. Other pickle forms, including reducers and protocol 0/1, are rejected; those still require conversion through the Python app. The original legacy fixture passes, and conversion cannot overwrite its source file.
- Left/Right advances one nominal frame based on probed average FPS, rather than the original fixed 100 ms. Variable-frame-rate footage does not have guaranteed frame-exact stepping. A native frame-indexed player would be the next choice if that becomes a hard requirement.
- Chromium codec support differs from Qt's. On-demand playback copies cover unsupported codecs, but require an initial conversion and disk space.
- Exports use 16:9 720p or 1080p at 30 fps, letterboxing footage as needed; the original composed to the sources' output canvas. Notes and Category cards preserve their 2-second and 1.5-second durations. Text size is scaled to the output, rather than the original fixed pixel sizes.
- Audio is optional, off by default to match the Python export. Silent sources receive a silent audio track when audio export is enabled.
- Windows hardware export, full Unicode casefold equivalence beyond common cases, automatic playback-cache eviction, and installer signing are not implemented.
- The sidebar currently renders all matching rows. Very large analyses (thousands of Clips) should be benchmarked and may warrant virtualized rows.

## Validation boundaries

Automated Node tests exercise schema invariants, transactional failure, relative media resolution, external-change detection, sampled fingerprints, real native export/decoding, output preservation on cancellation, and the React import/edit/save/recovery/export flows with a mocked desktop bridge.

Playlist checks cover v1/v2 round trips, atomic save/recovery, reference cleanup after Clip/Source removal, shared Clip edits, add/reorder/remove/batch selection, ordered export, same- and cross-source sequential playback, manual cancellation, missing media, and stopping before a delayed media load resolves. Native FFmpeg export order is verified by sampling pixels from a blue-then-red playlist deliberately reversed from the source/category order. Playback UI tests use mocked media events; native runtime verification remains subject to the limitation below.

A generated TypeScript Analysis was also passed directly through the original Python `AnalysisFileCodec`: Python read and re-encoded it with all fields identical, including UUIDs, millisecond boundaries, Unicode title, multiline notes, Categories, and relative media paths.

The Electron end-to-end test is included, but this agent's restricted macOS process environment aborts Electron in `_RegisterApplication` before application code runs. Therefore desktop playback, native dialogs, and the packaged UI are **not yet runtime-verified here**. The connected browser tool also reported that no browser was available, so there is no verified UI screenshot from this session. The development-only `tests/preview.html` harness is available for visual inspection with Vite; it is not bundled into the app and its desktop bridge is a test double.

The unsigned macOS ARM64 `.app` bundle was built successfully and its archive inspected: the entry point, native binaries, fonts and UI are included; development/cache/test files are excluded. Attempting native UI inspection through Computer Use was separately blocked with “Computer Use was not approved to use Video Analyse TS.” Enable that app permission to continue live verification.

Windows has not been executed locally. The two-platform CI definition is intended to verify the desktop workflows and packages on actual runners. Performance should be compared on the same representative match recordings before claiming a numerical speedup over Python.
