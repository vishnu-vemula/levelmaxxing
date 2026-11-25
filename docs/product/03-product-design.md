# Levelmaxing product design

**Release surfaces** · iPhone, Android, Apple Watch and a restricted desktop operations console. **Design direction** · a training log with warm paper surfaces, dark gym photography and lime for the next action. The mobile experience gives logging, corrections, and recent history priority during a workout or meal.

[Release plan](01-release-plan.md) · [Production architecture](02-production-architecture.md) · [Build prompt](04-build-prompt.md) · [Prototype and walkthrough](../prototype/README.md)

## Navigation and screen contracts

The mobile tab bar holds **Today, Train, Eat, Progress, More**. Coach, Library, connections and account settings stay reachable from More and from relevant tasks. The tablet and prototype desktop layout expose secondary destinations in a side rail. Routes accept stable IDs and validated origin links. Sign-in, purchase, onboarding and workout focus mode take over the screen when their flows require it. Back returns to the previous form or list state.

| Screen and entry | Main content and action | Required alternate states and recovery |
|---|---|---|
| Welcome → account → setup | Continue with email or platform sign-in where offered. Set experience, training goal, available equipment, priorities, days, duration, locale and units. Preview the suggested plan and nutrition preferences before saving. | Resume incomplete setup, skip optional measurements, retry recovery, confirm account changes, complete offline setup drafts and connect later. No automatic calorie change from a permission prompt. |
| Today | Date, scheduled training, diary totals, trend and check-in when eligible. Quick log opens food, activity, weight or workout. | Rest day suggests next session or manual activity. Empty ranges show relatable first actions. Pending data remain visible with sync text. Past date selection leaves real-time workout and active date explicit. |
| Train → Program | Current phase, week/calendar controls, pinned version, effort and duration choices. Builder has day cards, exercise rows, integer set ranges, progression options, reordering and save preview. | Draft and activation date differ. When shortening or substituting, show affected sets and equipment requirements. Check conflicts between weekly schedule and active session. |
| Train → Active workout | Exercise, target versus actuals, previous set, quick number fields, set style and one sticky log action. Rest timer includes add time, skip and haptic preferences. | Resume from saved snapshot, foreground countdown catch-up, continue while offline, optional workout lock, discard confirmation, and unlogged sets in finish review. Program edits leave active session's exercise prescriptions anchored to its captured version. |
| Train → History → Workout | Show performed sets, duration, volume where meaningful, PR context, original time and edits. Day or date-range filters respect diary timezone. | Empty or partially logged history remains inspectable. Backdated edits show consequences. Deleting or changing a record confirms scope and recalculates derivations with provenance. |
| Eat → Diary | Locale date switch, energy and macro totals, per-meal entries, search/select, favorite, recent and saved meals. Copy one item or a whole meal to a selected date. | Unavailable upstream search shows cached personal foods and manual entry. Log date and recipe/catalog version display in detail. Invalid units preserve entered amount and suggest valid bases. |
| Eat → Add → Search or manual | Match by local terms, aliases, source, basis and serving. Quantity and nutrition appear together before confirm. | Offline cache misses go to manual entry. Missing nutrients display “Unavailable”. Volume versus mass prompts for a valid basis before conversion. |
| Eat → Add → Scan methods | Separate camera entries for barcode, label and meal photo, plus typed description. Review ingredients or product, quantity, source, uncertainty and edits. | Camera denial offers picker or manual entry. Unknown barcode opens label/manual. Ambiguous label highlights field and original crop. Photo/text estimates keep draft on missing network or quota. Cancel stops any pending write, and late replies cannot replace corrections. |
| Eat → Recipe and grocery | Ingredients editor, equivalents, variants, cooked yield, portion preview, save/duplicate/share, import preview. Grocery price list has units, market, date, alternatives where comparable and current coverage. | Unsupported or blocked URL offers manual entry, retains the draft. Unknown density or unsupported recipe source needs user attention. Grocery no-data retains a shopping list with no implied current price; expired prices are dated. |
| Coach → Check-in → Review | Separate training and nutrition evidence. Explain status, relevant inputs, proposal, effect date, accept, edit where supported, skip, and history. | Insufficient data is a state. Concurrent update refreshes evidence and requires confirmation. User can proceed with training and manual diary through provider outages. Weight-sensitive copy avoids praise or blame based on direction. |
| Coach → Conversation and program jobs | Reviewed educational context, cited guidance where available, suggested follow-ups, async draft progress and editable validated program preview. | Cancel, retry budget, resume from history, out-of-scope or low-confidence response, manual program builder. Unsafe health or nutrition requests route to reviewed support content without making clinical claims. |
| Progress → Measurements and photos | Trend window, actual logged dates, history filters, provenance, accessible data table, optional photos and user-owned comparison, training analytics and adherence. | Sparse signal uses recorded data with readable axes. Unknown weight stays unknown. Private photo preview, upload retry, removal, and retention settings. Avoid inferring body composition from weight or a photograph. |
| Progress → Activity and cycle | Manual and imported activity provenance, duplicate linking, event time and local display time. Cycle data is opt-in with a separate permissions/export/removal control. | Revoke connection and offer data-category decisions per provider rules. No fertility advice, automated coaching inference, or external sharing for cycle records. Manual activity works on unsupported devices. |
| Library → Exercise guide or lesson | Search by topic/equipment, accessible media player and text equivalent, saved list, editorial version and related action. | Low bandwidth supports text and lower bitrate. Revoked rights remove media, preserve referenced activity history and explain unavailable link. |
| More → Connections and device sync | Per integration show availability, read/write scope, last updated, authorization, revoke, account/device binding, and queue/conflict inspection. | No platform permission assumption. Distinguish device disconnected, no data, limited permissions, needs authorization and stale data. On account switch, quarantine old Watch work and show which account can access it. |
| More → Membership, account and support | Plan, purchase/restore, renewal terms, unsubscribe path, remembered locale, settings, support, account export and deletion. | Pending payment, expired access, store unavailable, sign-in expired, export progress and deletion confirmation. Previously logged data remain available according to entitlement policy. |
| Apple Watch workout | Large current exercise, target, actual reps/load, set confirmation, heart rate when permitted, rest timer and reachability status. | Queue while disconnected under the original account binding. Show phone pickup/reconnection instructions and allow first-party timer controls. |
| iOS Live Activity | Use lock screen / Dynamic Island for workout label and rest countdown when allowed. End on completion, cancellation, or timeout with phone reconciliation. | System-imposed visibility, disabled updates and expired session degrade to in-app timer. Keep personal measurements and meals off the lock screen. |
| Admin | Inbox for content review, rights expiry, versions, jobs, catalog approvals and entitlement reconciliation. Details show safe identifiers and authorized actions. | Distinct roles. Two-step actions for deletion/revocation, immutable audit event on sensitive actions, redacted failure details, and no default access to meal or progress photos. |

## Connected interaction flows

### Training

1. **Today → Start workout** opens the planned session and displays the active plan version.
2. First set opens reps and load with prior performed values labeled as suggestions. Each confirmed set shows immediate local acknowledgment, pending state if disconnected, and an accessible correction action.
3. Finish opens a review containing performed, skipped and incomplete exercises, duration, and a summary of relevant comparisons. Save completes the session and creates an activity projection.
4. Second device receives sets and completion state when both clients can sync. A late conflicting edit opens the user's draft and synced version side by side with a meaningful choice. History remains tied to performed set facts.

### Food diary

1. **Today → Log food** lists Search, Manual, Barcode, Label, Photo, Describe and Recent or Saved where available.
2. Every scanner converges on a review sheet with meal date/slot, food name, quantity, units, measurement basis, calories/macros and source. Edits update visible totals and remain in a draft.
3. Confirm adds a nutrition snapshot. The daily panel recalculates immediately and lists the diary entry. Open details to edit, copy or remove.
4. A recipe change creates a new catalog version. A diary edit shows the recorded recipe version and gives an explicit update path when a newer one exists.

### Progress and adaptation

1. **Progress → Log weight** resolves the displayed unit, capture date and entry origin. The graph has the same values in a table.
2. **Coach → Check-in** shows the actual evidence window and reason for a proposal or lack of one. Before applying, show what changes, effective date and expected training/diary behavior.
3. Confirm records acceptance linked to the proposal version. Outdated proposals need re-review. The active session and historical targets retain their original facts.

### Sync, account and billing

1. A status control near the workspace header opens device state, change count, last successful sync, retries and drafts needing attention.
2. An expired session asks the user to reconnect to the same account. Offline edits continue when the prior session and device policy permit. Account logout explains pending records before locking the local workspace.
3. Store-owned purchase and restore controls feed entitlement reconciliation. If delayed, show pending with a refresh path; provider webhook arrival does not require restarting.
4. Export and removal confirmation state what is affected, when the operation completes, and how the user can check status. System or provider permissions remain manageable after account access changes.

## Design system

The prototype uses system typography with Avenir Next where present. Native production should choose platform-accessible system fonts with a Hindi-capable fallback, semantic weight roles and tabular numerals. Visible copy uses sentence case; field labels remain above input. Translate complete strings and use locale-aware units, pluralization, INR formatting and date boundaries. Large text may wrap into a second row or move a sidebar action below the header.

| Role | Light | Dark | Use |
|---|---|---|---|
| Canvas | `#F5F4EE` | `#181B16` | App background |
| Surface | `#FFFEFA` | `#20241C` | Diary, form, dialog and chart |
| Text | `#20221C` | `#F2F3E9` | Body, heading, action labels |
| Muted text | `#5C6154` | `#B8BFAB` | Help, timestamps and secondary labels |
| Border | `#DBDCD0` | `#3D4436` | Structure; pair component affordances with focus or distinct surface |
| Primary action | `#D6F55E` | `#D6F55E` | Next physical action, paired with `#161B08` text |
| Success | `#3E641F` | `#B5E77B` | Sync and confirmed states, always with text |
| Warning | `#875708` | `#F1C379` | Offline, stale or conditional data |
| Error | `#A42723` | `#FFA099` | Invalid input, failed sync, destructive action |

Proposed display 46/50 desktop and 36/40 phone, screen title 28/34, section 22/27, body 16/23, supporting label 13/18. Use a 4-point spacing base with 8, 12, 16, 24 and 32 as common intervals. Use restrained 8-point controls and 14-point surfaces. Set targets to at least 44 pt or 48 dp on native. Use minimum 44 CSS px for prototype actions where possible. Design focus and active state with visible stroke, foreground contrast, and accessible label changes; dark palette applies to controls, dialogs, charts and status.

| Component | Contract |
|---|---|
| Log field | Visible label, unit suffix announced with label, retained input, number keypad where supported, inline error and focus on first invalid field on submit. |
| Exercise or food row | Primary name first, secondary context/provenance, row action separate, stable row ID and expanded text size support. |
| Nutrition meter | Visible current and target units, optional domain-adjusted values, semantic meter accessible name/value, over-target distinguished by number. |
| Trend chart | Date/measurement pairs accessible by table; gaps for missing days; neutral up/down styling for weight. |
| Status and alert | Plain words and icons plus color; announce meaningful transitions, avoid repeating background refreshes. Keep messages beside the affected action. |
| Sheet / dialog | Bounded content, heading, swipe/dismiss behavior with draft preservation, keyboard focus trap on web and explicit focus return. |
| Timeline and list | Cursor pagination by production route, screen reader context, loading placeholders sized to actual layout and retry without losing filters. |
| Media tile | Original or licensed media with caption or transcript, fallback on slow/offline/dismissed network, layout dimensions reserved. |

## Visual and interaction release evidence

For real iOS and Android clients record compact and large layouts, light and dark theme, largest supported text size, screen reader traversal and reduced motion. Verify keyboard and focus in the admin, Hindi long labels and numerals, Android permission denial, camera fallback, notification denial, watch pairing and ActivityKit lifecycle. Verify no clipping at narrow width, sticky save survives keyboard safe area, and screen-reader users can confirm a set or meal and resolve a sync conflict without gestures. Map each F01–F16 requirement to a normal and failure-state screenshot or interaction recording plus a test where behavior matters.

## Prototype design verdict

The prototype is an interactive desktop/phone browser reference. The workout → logged set → completed history and meal → review → diary paths share real local HTTP sync, as do plans, recipes, measurements, check-ins and settings. **Sync and devices** reveals two independent local queues, revision numbers and reviewable conflicts. Sample barcode, label, photo interpretation and coach responses exercise the review screens. The native provider, store, camera and admin views are workflow previews, with production evidence gates in the release plan.

The training panel photo is generated for this prototype. Its source prompt asked for a photorealistic editorial image of an adult South Asian athlete using black dumbbells on an incline bench in a charcoal gym, with the subject on the right and dark open space for the workout title. Workout tutorial media for release has separate content, review and rights requirements.
