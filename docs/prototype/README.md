# Levelmaxing interactive prototype

Run the training, food diary and progress flows through a local backend. Two independent browser clients share a fictional workspace. Each client has its own durable draft queue, offline control, and conflict review.

## Open it

1. Install or use **Node.js 22 or later**. No dependency install is needed.
2. In Terminal, change to the extracted prototype folder and run:

   ```sh
   node server.mjs
   ```

3. Open [Levelmaxing](http://127.0.0.1:4316). On macOS you can also run `./start.command` from the prototype folder to open the browser and start the server. Stop it in Terminal with Control-C.

If port 4316 is busy, run `PORT=4317 node server.mjs`, then open [port 4317](http://127.0.0.1:4317). By default, the backend writes its workspace to a hidden `.demo-state` directory beside the server. You can use `LEVELMAXING_DATA_DIR=/path/to/a/new/demo-folder` to start a separate workspace. Use fictional entries. The demo listens on `127.0.0.1` and has one shared demo identity. It runs without credentials or paid services.

## Try the connected flows

| Journey | Steps | What to expect |
|---|---|---|
| Workout across two clients | On Device A, start the workout, log a set and finish. Open **Sync → Open Device B**, then **Train**. | The performed set and completed session appear on Device B. |
| Offline and restart | On A, choose **Sync → Go offline**, log a meal, and reload A. Open the diary on B. Then go online on A. | The meal survives A’s reload, appears as queued, and reaches B only after A reconnects. |
| Two edits to one record | Go offline on A and edit an existing meal. On B, edit the same meal. Reconnect A. | A preserves its draft and opens a comparison. Keep the synced version or explicitly apply A’s revision. |
| Deletion versus an offline edit | Edit a meal offline on A. On B, remove the meal. Reconnect A and go to **Sync → Review draft**. | The original ID stays deleted. You may keep the deletion or save A’s text and values under a new entry. |
| Commit with missing reply | In **Sync → Test recovery**, arm **Drop next save reply**. Close the panel and log a meal. | The backend saves once. When the first reply is lost, A retries the same operation ID and the two clients show a single meal. |
| Recipe history | Create a recipe, review and log a portion, then edit the source recipe. | The previously logged meal keeps its stored nutrition totals. |
| Other app surfaces | Try sample barcode/photo/label/text review, program building, weights and activities, cycle logging, a coach check-in, lesson bookmark, grocery price entry and JSON export. | These use the working local workspace. Scanner and coach interpretation are fixture-driven. |

The demo’s offline switch pauses synchronization for that client while its browser page stays available. It is useful for testing pending writes and recovery, including reload with the local server running. The production mobile apps require a real offline startup implementation and encrypted SQLite. The two client links can run as separate tabs or windows on the same computer.

## What the prototype proves

- `public/` is the browser interface. `server.mjs` implements small JSON endpoints with strict request validation, optimistic versions, receipt hashes, ordered revisions, high-water paging and tombstones.
- Application writes refresh a local confirmed view plus the device outbox in one browser storage operation. The server serializes each change in its single process and publishes a complete replacement state file. A restart keeps acknowledged state and operation receipts.
- A server write copies and persists the entire demo state, **O(N)** time and **O(N)** auxiliary space for N stored records, receipts and deltas. Pull reads at most 100 indexed array elements per page. Client render and browser storage scale with the small demo workspace. The production architecture replaces this file persistence with indexed PostgreSQL transactions, bounded retention and paged snapshots.
- Camera capture, native health/watch connections, account authentication, app-store transactions, push reminders and live AI are preview or design surfaces. The full-release docs specify implementation and device/provider acceptance.

## Reproduce the checks

```sh
node --check server.mjs
node --check public/app.js
node --test sync.test.mjs
```

The HTTP suite starts a throwaway local server on port 4336 and tests replay after a dropped reply, changed request reuse, concurrent separate sets and same-meal edits, frozen workout prescriptions, delete versus stale edit, invalid input, stale epochs, concurrent paging, and restart. Run in an environment that permits local loopback.

With Chrome installed, run `node browser-qa.mjs`. It starts local test services on ports 4326 and 9426 and uses a temporary profile. Set `CHROME_BIN` to select a different Chrome executable. Optional `LEVELMAXING_CAPTURE_DIR` points to an existing directory for screenshots.

## Files

- `server.mjs` — local HTTP backend and persisted fictional workspace
- `public/index.html`, `styles.css`, `app.js`, `workout.webp` — browser UI and original generated training photo
- `sync.test.mjs`, `browser-qa.mjs` — real HTTP and browser integration checks
- `start.command` — macOS launcher

## Validation performed

- Node.js 24 passed syntax checks for the backend, browser application and browser test runner. The macOS launcher passed `sh -n`.
- `node --test sync.test.mjs` passed the local HTTP scenario and its assertions for concurrent writes, retries, history and durable server state.
- `node browser-qa.mjs` passed in headless Chrome with two clients. It exercised workout start, logging, preserving a captured program, cross-client completion, offline meal reload, reconciliation, a stale edit against deletion, explicit save-as-new, sample photo review, and recipe history.
- Inspected desktop at 1440 px and phone at 390 px, plus dark mode with a 26 px document base size. The browser check verified no horizontal document overflow at 320 px across the seven destinations and basic Tab focus. VoiceOver, TalkBack, full keyboard audit and physical device tests remain release work.
