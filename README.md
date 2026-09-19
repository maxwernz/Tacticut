# Video Analyse TS

A TypeScript desktop rewrite of the Python/PySide/QML Video Analyse app. Electron runs the desktop shell, React renders the workspace, and native FFmpeg processes handle video work. No Python installation is needed.

## Run

Use Node.js 22.12+ (Node 24 recommended):

```sh
npm ci
npm run dev
```

For the production build:

```sh
npm run build
npm start
```

Dependencies include native FFmpeg and ffprobe binaries. Installation needs internet access; the installed app processes media locally. The renderer is sandboxed, has no Node access, and communicates through a narrow preload interface. Native dialogs choose files; a token-based streaming protocol serves video with byte-range support.

## Workflow

- Add or drop one or more Source videos. The Videos tab switches, renames, reorders, removes, and relinks them.
- Press **Space** to play/pause, **Left/Right** for frame-sized steps, **Shift+Left/Right** for five-second jumps, and **Up/Down** to increase/decrease playback speed. Shortcuts leave text fields and dropdowns alone. Playback speed and volume live below the video.
- Choose **Select clips** to reveal batch-selection checkboxes for export or deletion. **Done** or **Escape** hides them and clears the batch selection; normal clip browsing stays uncluttered.
- Press **M** to mark the start and again to mark the end. Save the resulting Clip draft with its name, Category, boundaries, and notes. Cancelling a draft leaves the Analysis unchanged.
- In parallel, press **1–9** to immediately capture a Clip in that Category (in sidebar Category order), or use the **Tag** menu. Default context is 8 seconds before and 3 seconds after the playhead; the settings button beside Tag changes these device-local values. Capture does not pause playback or disturb a pending manual start, ignores held-key repeats, and clamps to video boundaries. Finish or cancel an open Clip draft before quick tagging. Captures are ordinary Clips, included in recovery and saved/exported through the existing workflow.
- Capture, Tag, and selected-Clip editing now share the playback control row. Shortcut explanations remain in tooltips instead of a permanent bottom strip.
- Click a Clip to navigate to its Source video and start. Double-click or use its pencil button to edit it. The timeline scrubs, selects ranges, and double-clicks to a Clip start.
- Filter Clips by Source video and search names, notes, Categories, and Source-video names. Sort by Category, start, or creation order. Check Clips to export or delete a selection.
- Manage Analysis-wide Categories with the sidebar settings button. The Analysis menu also edits the reusable Category template.
- Save with **Cmd/Ctrl+S**. New, Open, Save As, Add Source videos, and Combined export also have native menu shortcuts.
- Export selected Clips (or all Clips if none are selected), rearrange their independent Export list, and choose title/Category/notes cards, Clip numbers, source audio, and 720p or 1080p output.
- Use **Playlists** to create a named coaching sequence. **Add Clips** searches existing Clips; the arrows set presentation order and the × removes only the playlist reference. A Clip can belong to several playlists, but appears only once within each. Batch selections can also be added using the playlist button beside Delete.
- **Play playlist** plays each Clip's interval in order, switching Source videos as needed; click a playlist row to start there. Space pauses/resumes; Stop or Escape ends the sequence. Manual seeking, document edits and dialogs cancel sequence playback. Finish or cancel unfinished capture before playing a playlist. Switching Source videos may briefly buffer; playback is not gapless. **Export playlist** uses that same order in the existing export dialog.

## Compatibility

The app reads and writes the Python app's schema-version-1 JSON `.analysis` files, preserving UUIDs, Clip creation order, Categories, notes, and external Source-video references. It uses the same three-region SHA-256 media fingerprint algorithm. Relative Source-video paths support moving media together with the Analysis. Missing media can be relinked without losing Clips; replacement footage requires a confirmation.

Analyses containing playlists save as **schema version 2**, with named, ordered Clip-ID references stored in the same file and recovery snapshot. These files require this TS version; older Python/TS apps reject them rather than silently losing playlists. Use **Save As** to keep an original Python-compatible copy. Analyses without playlists continue to save as version 1. Deleting a Clip or Source video removes its references from all playlists; removing a playlist never deletes the underlying Clips.

Saving uses atomic replacement and checks for external file changes. Unsaved durable edits create a separate debounced recovery snapshot, offered on the next launch after an abnormal exit. Pending boundaries and unsaved Clip drafts are transient, as in the Python app.

**Legacy pickle files:** the historical `treewidget_item.ClipItem` format can be imported directly using a restricted data-only reader. It never imports Python globals or executes constructors/reducers. Conversion requires Save As to a new JSON file; the original remains intact. Unrecognized pickle forms are rejected and can instead be converted using the Python app. Imports are limited to 32 MiB.

## Performance choices

- FFmpeg decodes/encodes/composes natively; frames never pass through JavaScript or React.
- Export runs in asynchronous child processes, with progress and cancellation. It normalizes clips into temporary segments and stream-copies the final concatenation. This bounds memory usage, at the cost of temporary disk space.
- On macOS, Automatic export attempts VideoToolbox hardware encoding and falls back to software. Windows currently uses the `veryfast` software H.264 encoder. No claim of a measured speedup over the Python app is made yet.
- The playhead updates directly in the DOM while playing; it does not rerender the Clip list. Scrubbing is coalesced to animation frames. Idle playback does not run a continuous animation loop.
- Source identity checks read at most three 64 KiB regions instead of hashing an entire match recording.
- Unsupported playback codecs can be converted on demand into a cached 720p H.264/AAC playback copy. Exports still use the original media. Cache files live under the app's local user-data directory; there is no automatic cache-size limit yet.

TypeScript is appropriate for this application's editing and document logic. Native code is still responsible for the expensive media operations. Electron has a larger RAM and application-size cost than Qt or Tauri; a TypeScript rewrite by itself is not a performance improvement.

## Checks and packaging

```sh
npm test               # domain, persistence, React workflows, actual FFmpeg exports
npm run test:e2e       # builds and launches Electron via Playwright
npm run package:mac   # run on ARM64 macOS
npm run package:win   # run on x64 Windows
```

Build packages on their destination OS so their native video binaries match. macOS packages are unsigned/unnotarized unless signing is configured; Windows installers likewise need a signing identity for signed distribution. Native dependencies retain their supplied license files; bundled fonts retain their SIL Open Font Licenses.

The GitHub Actions workflow checks and packages macOS and Windows independently. It has been added locally, not run remotely.

See [MIGRATION.md](MIGRATION.md) for parity decisions and remaining validation work.
