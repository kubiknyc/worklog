# WorkLog — Phase 2 Architecture: Photo Pipeline, Voice-to-Text, PDF Pipeline

> Phase 2 deliverable, produced by the mobile-subsystems track. Source spec: `FABLE5-PROMPT-worklog.md` §4.3/§4.4/§5/§6/§8 (final; §11 not relitigated). PRD: `docs/PRD.md` rev 3 — resolves open items §15 #3, #4, #7, #11 (partially), #13, #15. Every assumption is marked `ASSUMPTION:` inline; every stack deviation is marked `TRADEOFF:`.

---

## A. Photo Pipeline

### A.1 Design goals

1. **Never lose a photo** — bytes are durable from shutter time; every failure path ends in retry, park-with-surface, or user decision (spec §10).
2. **Provenance is first-class data, not metadata** — `captured_at`, `gps_lat`, `gps_lng`, `gps_accuracy` are columns on the photo row (local SQLite + Postgres), per spec §4.4 and PRD §11.2. Picker/camera EXIF alone does **not** deliver GPS (iOS camera EXIF has no GPS tags; PHPicker strips location; expo-camera does not geotag) — location comes from `expo-location` at shutter time.
3. **The shutter never waits** — GPS, processing, and upload are all asynchronous relative to capture; a 5-photo batch stays at ~14 s/photo hands-on (PRD §8).
4. **Convergence under retry** — client UUID = final server id = storage path = outbox filename; a storage 409 on that path means a previous attempt landed → success (spec §4.3 invariant 7).

### A.2 Module layout

```
src/photos/
  types.ts                CapturedPhotoDraft, PhotoProvenance, tag model      [pure]
  provenance.ts           EXIF subset extraction, captured_at derivation,
                          taken-vs-added semantics for library imports        [pure]
  distanceGuard.ts        haversine + wrong-project flag policy               [pure]
  pipeline.native.ts      shutter → staging → process → outbox orchestration
  location.native.ts      camera-session location warm-up + shutter sampling
  process.native.ts       resize/compress + thumbnail + print-rendition calls
  exifInject.native.ts    (Should) piexifjs re-injection step
src/sync/
  outbox.native.ts        durable photo-bytes outbox (PunchLog verbatim shape)
  push.native.ts          photo push handlers
```

Pure modules carry the Jest coverage (provenance derivation, guard policy, EXIF tag mapping); `*.native.ts` files hold every `expo-*` import, honoring the §4.3 platform-split grep guard. *(Note: the modules-track doc places `geoGuard`/`photoProvenance` under `src/data/` — see `00-README.md` Reconciliation R4 for the folder-placement decision; the behaviors are identical.)*

### A.3 End-to-end flow

```
 shutter tap
   │ takePictureAsync({ exif: true })          ← EXIF read HERE, pre-compression
   │ location ref read (already warm)          ← GPS read HERE, non-blocking
   ▼
 STAGE (durable, crash-safe)
   captures/<tempId>.jpg + captures/<tempId>.json   (app-document dir)
   ▼  … batch continues; filmstrip thumbnail from staged file …
 "Done (n)" → tag/caption sheet (skippable)
   ▼  "Add n photos to today's report"
 PROCESS (per photo, sequential)
   1. resize ≤1280px longest edge / 0.6 JPEG  (expo-image-manipulator — strips EXIF; ok, provenance already captured)
   2. (Should) piexifjs re-injection of DateTimeOriginal + GPS IFD into the 1280 JPEG
   3. ~200px thumbnail rendition
   4. move renditions → outbox/<photoId>.jpg + outbox/<photoId>.thumb.jpg ; delete staging pair
   ▼
 LOCAL INSERT  report_photos row, _pending = 1, provenance columns filled
   + enqueue add_photo mutation (client UUID = photoId) ; nudge engine
   ▼
 BACKGROUND UPLOAD (sync queue — add_photo drained LAST, oldest-first, one at a time)
   1. storage upload  worklog-photos / <projectId>/<reportId>/<photoId>.jpg   (upsert: false)
      → 409 / "Duplicate" ⇒ isDuplicateUpload ⇒ SUCCESS (bytes landed on a prior attempt)
   2. row insert into report_photos (23505 duplicate-key ⇒ row landed ⇒ SUCCESS)
   3. clear _pending ; delete outbox files
```

**Crash safety:** the staged `.json` sidecar (provenance + pending tags) is written atomically with the staged JPEG at shutter time, so killing the app mid-batch loses nothing — on next launch, `pipeline.native.ts` sweeps `captures/` and re-offers orphaned staged photos ("3 photos from an unfinished batch — add to today's report?"). ASSUMPTION: orphaned staged photos older than 7 days without a report to attach to are surfaced once in the sync-status screen, never silently deleted.

### A.4 Exact capture API calls

**Camera (batch capture sheet — `expo-camera`, SDK 54 `CameraView`):**

```tsx
<CameraView ref={cameraRef} facing="back" flash={flashMode} animateShutter={false} />

const photo = await cameraRef.current.takePictureAsync({
  exif: true,          // full EXIF dict on the result — read BEFORE any manipulator touch
  quality: 0.9,        // near-lossless at capture; the 0.6 compression happens in PROCESS
  shutterSound: false, // jobsite courtesy; Android-only effect
  // skipProcessing stays default (false): Android orientation is normalized in-camera
});
// photo: { uri, width, height, exif?: Record<string, unknown> }
```

From `photo.exif`, `provenance.ts` extracts the corroboration subset: `DateTimeOriginal`, `OffsetTimeOriginal` (when present), `Make`, `Model`. `captured_at` is the **device clock at shutter** as an ISO-8601 string with UTC offset (PRD assumption #9 — EXIF `DateTimeOriginal` is stored separately in `exif_datetime_original` as independent corroboration; skew between them is surfaced in the lightbox, not corrected).

**Library import (`expo-image-picker`):**

```ts
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ['images'],
  allowsMultipleSelection: true,
  selectionLimit: 0,          // unbounded batch; Android 13+ system Photo Picker → no media-read permission
  orderedSelection: true,
  exif: true,                 // DateTimeOriginal ~always; GPS sometimes on Android, never via iOS PHPicker
  quality: 1,
});
```

Library-import provenance semantics (`provenance.ts`, pure): `captured_at` = EXIF `DateTimeOriginal` when present (else null — PDF prints "capture time not recorded"); `gps_*` = EXIF GPS IFD when present (Android sometimes), else null — **never** the device's current location, which would stamp a false "where" onto old evidence; `added_at` = now, `source = 'library'`. The PDF distinguishes "Taken" vs "Added to report" times (PRD assumption #8).

### A.5 expo-location strategy

**Permission:** requested at first camera/library use, behind the routed location explainer (`(onboarding)/permissions/location`, evidence framing per PRD §12.2). Denied → capture proceeds, GPS columns null, PDF prints "location not recorded". Approximate-only grant → accepted; `gps_accuracy` carries the truth and the PDF prints ±accuracy (PRD §11.10).

**Warm-up, not per-shot fixes** (`location.native.ts`): a cold `getCurrentPositionAsync` costs 3–10 s — unacceptable per shutter. Instead, a watch runs for the lifetime of the capture sheet and the shutter reads a ref:

```ts
// On capture-sheet mount (after permission check):
watchSub = await Location.watchPositionAsync(
  { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 5 },
  (fix) => { lastFix.current = fix; },
);
// On sheet unmount: watchSub.remove()
```

At shutter, resolution order — none of which blocks the shutter or the staging write:

1. `lastFix.current` if fresher than 60 s → use immediately.
2. Else `Location.getLastKnownPositionAsync({ maxAge: 120_000 })` (fast, cached OS fix).
3. Else a one-shot `getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })` raced against a 5 s timeout, resolving **asynchronously**: the staged sidecar is patched with the late fix if it arrives before the batch is committed to the outbox; otherwise the columns stay null.

Stored per photo: `gps_lat`, `gps_lng` (double), `gps_accuracy` (meters, from `fix.coords.accuracy`), and `captured_at` from the shutter clock. ASSUMPTION: the fix's own timestamp is checked against the shutter clock; a fix older than 120 s is used but its staleness is not separately persisted — `gps_accuracy` plus the guard below bound the damage.

**Wrong-project GPS guard (PRD §15 #11)** — `distanceGuard.ts`, pure:

```ts
export function wrongProjectFlag(fix, project): 'no-op' | 'ok' | 'flag' {
  if (project.lat == null || project.lng == null) return 'no-op'; // coordinates not yet set
  if (fix.lat == null) return 'no-op';                            // no GPS on this photo
  const d = haversineMeters(fix, project);
  return d - fix.accuracy > WRONG_PROJECT_THRESHOLD_M ? 'flag' : 'ok';
}
```

- **No-ops while project coordinates are null** — the shared `projects` table has no coordinates today; the guard degrades gracefully until the Phase 3 additive `projects.lat`/`lng` columns land and are populated (geocode-at-create + optional manual pin, per PRD §15 #11).
- ASSUMPTION: `WRONG_PROJECT_THRESHOLD_M = 500` (tunable constant) — generous enough for a brownstone block + urban-canyon GPS error, tight enough to catch "wrong borough". Accuracy is subtracted first so an approximate-location grant (±~2 km) can never false-positive.
- The flag **warns, never blocks**: the tag sheet shows "This photo's location is ~2.1 km from ⟨Project⟩ — right project?" with one-tap project switch (PRD §4 camera-tab behavior). The user's choice is final.

### A.6 Processing and renditions

`process.native.ts`, per photo, sequential (bounds peak memory on low-end Android):

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

async function renderJpeg(srcUri: string, longestEdge: number, compress: number) {
  const ctx = ImageManipulator.manipulate(srcUri);
  // resize only downward, preserving aspect (manipulator scales the other edge)
  if (Math.max(src.width, src.height) > longestEdge) {
    ctx.resize(src.width >= src.height ? { width: longestEdge } : { height: longestEdge });
  }
  const image = await ctx.renderAsync();
  try {
    return await image.saveAsync({ compress, format: SaveFormat.JPEG });
  } finally {
    image.release();
  }
}
```

| Rendition | Size | Quality | Purpose | Lifetime |
|---|---|---|---|---|
| **Archive** | ≤1280 px longest edge | 0.6 | The canonical photo: outbox → storage upload → lightbox full-res → PDF source | Outbox until upload confirmed; then storage |
| **Thumbnail** | ~200 px longest edge | 0.5 | Filmstrip, photo strip, Photos-tab wall, list rows — grids bind thumbnails **only** (PRD §11.8) | Device-local (`local_thumb_uri` column); regenerated lazily on other devices after first archive download |
| **Print** | ~800 px longest edge | 0.7 | PDF photo-sheet embedding (see §C) | Transient — produced at PDF render time from the archive, released per photo |

The manipulator re-encode **strips EXIF and bakes orientation into pixels** — this is why EXIF and GPS are read in §A.4/§A.5 *before* this step. ASSUMPTION: the 1280 px / 0.6 archive rendition is the evidentiary original; the staged near-lossless capture file is deleted after processing (matches PunchLog's pipeline and bounds device storage — the provenance columns, not the pixels, carry the dispute-grade claims).

Staging and outbox both live under the **app-document directory** (never the purgeable OS cache): `captures/` for the shutter-time staging pair, `outbox/` owned by `src/sync/outbox.native.ts` once the batch is committed. ASSUMPTION: file IO uses the SDK 54 `expo-file-system` `File`/`Directory` API to match PunchLog's `outbox.native.ts`; if PunchLog ships on the legacy API, mirror that instead — the outbox module is copied, not rewritten.

### A.7 EXIF provenance mechanism (spec §4.4 — stated as required)

**ASSUMPTION (the chosen mechanism):** provenance is carried by **first-class columns as the system of record**, with **optional piexifjs re-injection into the archive JPEG as a Should-tier hardening step**:

1. **Primary (Must, M5):** `captured_at`, `gps_lat`, `gps_lng`, `gps_accuracy`, `exif_datetime_original`, `source` as columns on `report_photos` (local + Postgres). The PDF photo sheet prints the provenance line from these columns (§C.4) — in-file EXIF would not survive `expo-print` rasterization anyway (PRD §11.2). The DB row, protected by the lifecycle RPCs and audit trail, is the evidentiary anchor.
2. **Secondary (Should, per PRD §2):** `exifInject.native.ts` runs between compression and the outbox write: read the 1280 JPEG as base64, use **piexifjs** to write `DateTimeOriginal`/`OffsetTimeOriginal` and the GPS IFD from the captured provenance, write back (~10–50 ms/photo — negligible). Result: any raw JPEG leaving the system (storage download, discovery production, email attachment) is self-evidently stamped, matching the columns. **TRADEOFF (already flagged in PRD §2):** piexifjs is one small pure-JS dependency outside PunchLog's proven set; it is severable — deleting the step changes nothing upstream or downstream.
3. **Not chosen:** XMP/JSON sidecar files in storage (doubles object count, nothing consumes them) and EXIF-only provenance (unverifiable against RLS/audit, stripped by the manipulator, absent GPS on iOS anyway).

### A.8 Data model (photo row + tag/caption sheet)

`report_photos` (Postgres; SQLite mirrors + local-only `_`-prefixed columns; full DDL in `04-data-model.md` / Phase 3):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Client-generated at shutter = storage filename = mutation clientId |
| `report_id`, `project_id` | uuid | Project id denormalized for storage-path RLS parsing |
| `storage_path` | text | `<projectId>/<reportId>/<photoId>.jpg` — known at capture (invariant 1) |
| `captured_at` | timestamptz | Shutter clock w/ offset; null for library imports without EXIF time |
| `gps_lat`, `gps_lng` | double precision, nullable | §A.5 |
| `gps_accuracy` | real, nullable | meters |
| `exif_datetime_original` | text, nullable | Corroboration only, verbatim EXIF string |
| `source` | text `'camera' \| 'library'` | Drives "Taken vs Added" PDF rendering |
| `added_at` | timestamptz | When attached to the report |
| `caption` | text, nullable | Free text / dictated |
| `trade_tag`, `location_tag` | text, nullable | Single-value chips (below) |
| `width`, `height` | integer | Archive-rendition dimensions |
| `created_by`, `created_at`, `updated_at` | — | Standard; server timestamps |
| *(local only)* `_pending`, `_dirty`, `local_uri`, `local_thumb_uri` | — | `_pending=1` until push confirms both bytes + row |

**Tag/caption sheet model — ASSUMPTION:** one trade tag + one location tag per photo (single TEXT columns, not arrays). Rationale: the sheet's one-pass swipe flow (PRD §8) offers chip *selection*, "Same tags as last photo" copies a `(trade_tag, location_tag)` pair, and the History/Photos filters are single-value predicates. Chips are sourced from: trades → today's crewed trades first, then project trade history; locations → the project's organically-grown area list (shared with Work Performed). A photo left untagged shows the dashed "Add tags" chip in the report strip — tagging is never forced.

**Mutation kinds:** `add_photo` (full row + `localUri` outbox pointer, drained last per `orderForDrain`), `remove_photo` (draft-only). **ASSUMPTION (this track's proposal):** a third kind `update_photo_meta` (caption/tags only, draft-window only, coalesced in place on repeated edits like `update_section`) — the Photos tab is explicitly the tag-cleanup surface, and tags must be editable after the initial `add_photo` has drained. It rides the queue as ordinary JSON. Post-submit tag corrections go through amendments, never `update_photo_meta`. *The modules track proposes an online-only RPC instead — see `00-README.md` Reconciliation R1.*

### A.9 Upload, thumbnails on pull, lightbox

**Push handler (add_photo):** upload archive bytes with `contentType: 'image/jpeg'`, `upsert: false` (the bucket deliberately has no storage UPDATE policy) → `normalizeStorageError` → `isDuplicateUpload` 409 ⇒ proceed as success → insert row (PK conflict 23505 ⇒ success) → clear `_pending`, delete outbox pair. All other failures flow through `classifyError` exactly as PunchLog: offline exempt from ceiling, RLS denial evicts, deterministic rejection parks.

**Pulled photos (other devices):** pull upserts the row; `local_uri`/`local_thumb_uri` stay null. Grids render via `expo-image` against a signed URL with `recyclingKey={photo.id}`; on first archive download the ~200 px thumbnail is generated locally and cached (`local_thumb_uri` filled), so scrolling never binds full-res (PRD §11.8).

**Lightbox** (`report/[id]/photo/[photoId]`, routed per PRD assumption #3): archive rendition full-screen; pinch-zoom/pan via `react-native-gesture-handler` + `react-native-reanimated` (both in the fixed stack — no new dependency); provenance panel below the image showing captured/added times, coordinates ±accuracy, source, and clock-skew note when `exif_datetime_original` disagrees with `captured_at` by >2 minutes (surfaced, not corrected — PRD assumption #9); "waiting to send" glyph while `_pending=1`.

---

## B. Voice-to-Text

### B.1 Scope and posture

On-device dictation for **sentence-shaped fields only** (work-performed lines, delivery material, inspection/safety/delay/RFI notes, photo captions, general notes — PRD §7 voice placement rule). Never on structured fields. Voice is an accelerator, never a gate: **every voice field is a normal `TextInput` with a mic accessory; the keyboard always works** (AC-A3). No network recognition fallback — audio never leaves the device, which is what keeps the store privacy declarations ("Audio = not collected") true (PRD §12.3).

### B.2 Module layout

```
src/speech/
  capability.ts        tri-state availability model + gate policy            [pure logic + thin native probe]
  useDictation.ts      single-session dictation controller (hook)
  DictationTextField.tsx  TextInput + mic accessory + interim-result styling
  contextualStrings.ts assemble project trades/vendors/areas for the recognizer [pure]
```

### B.3 Capability gating (PRD §11.1)

`getSpeechCapability()` resolves once per app session (re-checked when Settings opens) to:

| State | Condition | UI consequence |
|---|---|---|
| `available` | iOS 17+ with `supportsOnDeviceRecognition() === true`; or Android 13+ with on-device service + the user's locale model installed | Mic accessory rendered |
| `needs-model-download` | Android 13+, on-device service present, locale model **not** installed | Mic hidden in fields; Settings shows a "Download offline voice model" row → `ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale })` with progress/result handling; on success, capability re-resolves to `available` |
| `unavailable` | Android ≤12 (~10–15% of devices), no recognition service, or iOS reporting no on-device support | Mic never rendered; zero dead UI; typed flow is the honest ≈5:30–6:00 floor (PRD §6) |

Probes used: `ExpoSpeechRecognitionModule.isRecognitionAvailable()`, `supportsOnDeviceRecognition()`, and on Android `getSupportedLocales(...)` → `installedLocales` checked against the device locale. ASSUMPTION: model-download placement is **settings-only, plus a one-time inline hint** — the first time a `needs-model-download` user opens a notes field, a dismissible one-line banner offers "Turn on offline dictation in Settings"; no first-launch interstitial (resolves PRD §15 #7: opportunistic first-launch downloads burn cell data on a jobsite without consent).

### B.4 Permission flow

Two permissions, one moment, one explainer (PRD §5: "one combined explainer; both OS prompts fire at first mic tap"):

1. First mic tap → route to `(onboarding)/permissions/speech` (plain-language: dictation instead of typing; processed on your device; never stored — same sentences as the `infoPlist` strings, PRD §12.2).
2. "Enable dictation" → `ExpoSpeechRecognitionModule.requestPermissionsAsync()` — on iOS this raises **both** the microphone and speech-recognition prompts; on Android, `RECORD_AUDIO`. The `expo-speech-recognition` config plugin owns the mic permission string (`microphonePermission: false` on the camera/picker plugins — one key, one owner, per PRD §11.9).
3. Granted → return to the field, session starts immediately (the tap intent is preserved).
4. Denied → mic accessory remains rendered but tapping opens a small sheet: "Dictation needs microphone access — Open Settings" (`Linking.openSettings()`). The field itself is untouched: fully typable (store review denial-path requirement, PRD §12.4).

### B.5 UI pattern: per-field mic, single global session

**Per-field mic accessory** (not a global dictation mode): matches the section-sheet flow where the super moves field-to-field, keeps focus semantics obvious, and satisfies AC-A3 keyboard parity per field. A single `useDictation()` controller enforces **one active session app-wide** — starting dictation in field B stops field A's session cleanly (the module is a singleton recognizer anyway).

Session configuration (per-field short-burst — PRD assumption #12, sidesteps iOS ≤17 3-second-silence stops):

```ts
ExpoSpeechRecognitionModule.start({
  lang: deviceLocale,                  // e.g. 'en-US'
  requiresOnDeviceRecognition: true,   // hard privacy floor — never the network path
  interimResults: true,                // live inline feedback
  addsPunctuation: true,
  continuous: false,                   // short burst; ends on endpoint/silence or mic re-tap
  contextualStrings,                   // see below
});
```

`contextualStrings` (PRD §11.1, M8): assembled per project from trade names, supplier recents, area list, and inspector/agency recents — capped at ~100 phrases (ASSUMPTION: recognizer bias lists degrade past low hundreds; cap keeps latency flat) — so "GWB", "Blueskin", "DOB" land as text, not garble.

**Field behavior** (`DictationTextField`): mic tap → accessory pulses + field shows interim transcript **appended at the cursor in a visually volatile style** (muted color per theme tokens); `result` events with `isFinal` commit the segment as ordinary editable text; `end`/`error` events restore the idle mic. Dictated text is never auto-submitted and is always re-surfaced in the Review & Submit sheet before signature (PRD risk #12 — voice garbage on a legal record is caught at review, and the *facts* the PDF aggregates come from chips/steppers, not transcription). Errors are plain-language and quiet: "Didn't catch that — try again or type" (no error-red; consistent with offline-is-normal styling).

### B.6 Offline behavior

On-device recognition works with zero connectivity **by construction** — this is the point of the `requiresOnDeviceRecognition: true` floor and the no-network-fallback decision (TRADEOFF recorded in the PRD: declined network fallback; the cost is `unavailable` on Android ≤12, paid deliberately to keep "audio never leaves the device" literally true). The only connectivity-adjacent surface is the Android model download itself (Settings row, requires network once, states the download size). Recognition results are ordinary local text-field edits — they enter the sync queue only as part of whatever section/caption payload the containing field belongs to; dictation adds **zero** new mutation kinds and zero engine impact.

---

## C. PDF Pipeline

### C.1 Design goals

1. **Dispute-grade output:** logo/branding, all 11 sections, "Nothing to report" affirmations rendered as such, photo sheets with a per-photo provenance line, amendment trail visible on the artifact, signature block, page numbers, generated timestamp + report identity on every page.
2. **Two renderers, one document:** on-device `expo-print` (HTML) for typical reports; a Supabase edge function (pdf-lib) for heavy photo sheets **and** for all server-initiated renders (M11 distribution email — submit can drain from an offline queue with no client present). Two visually divergent renderings of the same legal record are unacceptable → an explicit consistency contract (§C.6).
3. **Never blocks, never OOMs:** photos embed sequentially at print rendition size; heavy renders route server-side; offline heavy renders degrade explicitly rather than fail.

### C.2 Module layout (mirrors PunchLog `src/report/`)

```
src/report/
  layout.ts               shared layout constants: section order, photo grid,
                          provenance-line format, footer format, LAYOUT_VERSION   [pure]
  assembleReport.ts       report + sections + photos + amendments + signature
                          → ReportRenderModel (one snapshot object)               [pure]
  renderReportHtml.ts     ReportRenderModel → complete HTML string                [pure, Jest-tested]
  routing.ts              on-device vs edge decision                              [pure]
  printReport.native.ts   expo-print printToFileAsync + expo-sharing
  printReport.web.ts      blob download (web companion builds clean; no v1 UI)
  embedPhoto.native.ts    archive file → ~800px print rendition → base64 data URI
  embedPhoto.web.ts       signed URL → blob → dataURL
jobsight-backend/supabase/functions/
  render-report-pdf/      pdf-lib renderer (Deno) + a copied layout.ts constants
                          file, drift-guarded by the golden test (§C.6)
```

`assembleReport.ts` reads exclusively through the `src/data` repository seam. The render model is a **frozen snapshot** — a locked report renders identically forever from its stored rows.

### C.3 On-device render (`expo-print`)

```ts
const html = renderReportHtml(model, embeddedAssets); // logo, signature, photos as data URIs
const { uri } = await Print.printToFileAsync({ html }); // US Letter default; margins via @page CSS
await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf',
  dialogTitle: `Daily Report — ${model.projectName} — ${model.reportDate}` });
```

Photos embed via `embedPhoto.native.ts`: archive file → `expo-image-manipulator` downscale to `PRINT_RENDITION_PX = 800` / 0.7 → base64 data URI — produced **sequentially, one photo at a time**, each released before the next, so peak memory stays bounded on low-end Android. A photo still `_pending` (offline, not yet uploaded) embeds from its outbox file — offline PDF export works fully.

**Page structure:** report body sections flow with `break-inside: avoid` per section card; photo sheets are explicit fixed pages (`page-break-after: always`, grid per §C.4), as are the amendment appendix and signature page. **Page numbers:** CSS paged-media counters (`@page` margin boxes / `counter(page)` `counter(pages)`) with per-platform validation on a real low-end Android (PRD §11.10 QA item). ASSUMPTION: if the Android print WebView drops margin-box counters, the fallback is manual numbering on the explicitly-paginated pages (photo sheets, appendix, signature) plus "Page n" omission on flowed body pages in favor of the always-present footer identity line — the golden test (§C.6) asserts whichever contract ships. Footer on every page: `⟨Company⟩ · ⟨Project⟩ · Daily Report ⟨date⟩ · Report ⟨short-id⟩ · Generated ⟨timestamp TZ⟩ · layout v⟨LAYOUT_VERSION⟩`.

### C.4 Document content (all 11 sections, dispute-grade)

1. **Header page:** company logo (branding settings; default JobSight-neutral header until M11 branding lands) + company name/address, project name/address, report date, report status chip (Draft renders with a diagonal **DRAFT — NOT SUBMITTED** watermark; only submitted/locked reports render clean), weather line with fetch timestamp + `manual override` marker when `weather_source = 'manual'`.
2. **Sections in fixed `layout.ts` order** (weather, crew, work performed, deliveries, equipment, inspections, safety, delays, visitors, RFIs, notes): tabular for aggregated sections (crew/equipment/delays render from the relational child rows with totals), prose blocks for the rest. Empty sections print "None reported" — and Safety prints the explicit **"Nothing to report — affirmed by ⟨name⟩"** line when so affirmed (a deliberate none is legally stronger than a blank, PRD §7).
3. **Amendment rendering (PRD §15 #15):** original section content printed **unaltered**; each affected section carries an "AMENDED — see appendix" stamp; an appendix page per amendment shows who/when/what with the original text preserved beside the amended text.
4. **Photo sheets:** ASSUMPTION — **4 photos per page (2×2 grid)**, ~800 px renditions, each cell = photo + caption + provenance line + tag line:

   ```
   Captured 2026-07-15 07:42 EDT · 40.6782, -73.9442 (±8 m)
   Trade: Electrical · Location: Cellar
   ```

   Variants: `Location not recorded` when GPS is null; `(±~2 km — approximate location)` styling when accuracy > 500 m; library imports print `Taken 2026-07-14 16:03 · Added to report 2026-07-15 08:10` (taken-vs-added honesty, PRD assumption #8); `Capture time not recorded — added ⟨time⟩` when EXIF time was absent.
5. **Signature block:** embedded signature PNG + signer full name + **title** (from `report_member_prefs` — the PM/super display label, PRD §10) + signed-at timestamp + the line "Signed electronically in WorkLog" (drawn image + name + timestamp, not PKI — PRD assumption #4). The signature PNG rides the `submit_report` RPC payload into a `report_signatures` row (PRD §15 #13 recommendation adopted — ASSUMPTION confirmed here: base64-in-RPC, not a storage object; ~5–20 KB is trivially atomic with submit and gives the server renderer the bytes with no second fetch). Amendment signatures follow the same row pattern keyed by amendment id.

### C.5 Renderer routing (`routing.ts`, pure) and the edge fallback

```ts
export const ON_DEVICE_PHOTO_CEILING = 40; // ASSUMPTION — tunable; PRD research: expo-print safe to ~40
                                           // photos worst-case Android; 800px print renditions give headroom.

export function routeRender(input: { photoCount: number; online: boolean; purpose: 'share' | 'distribution' }) {
  if (input.purpose === 'distribution') return 'edge';          // server-initiated — no client may exist
  if (input.photoCount <= ON_DEVICE_PHOTO_CEILING) return 'device';
  return input.online ? 'edge' : 'device-degraded';
}
```

- **`device`** — §C.3. The typical daily report (≤ ~15 photos) renders in seconds, fully offline.
- **`edge`** — client POSTs to `render-report-pdf`, shows determinate progress, downloads the PDF to the app cache, hands it to `expo-sharing`.
- **`device-degraded`** (offline + >40 photos — rare but must not dead-end): on-device render proceeds with the print rendition dropped to 600 px and strictly sequential embedding, behind an explicit confirm ("This report has 62 photos — offline export may be slow on this device. Export anyway / Wait for connection"). ASSUMPTION: degraded-offline export is accepted-risk with a mandatory low-end-Android QA pass at 50+ photos (PRD risk #7); the alternative — refusing to export evidence while offline — violates "offline never blocks".

**Edge function contract — `render-report-pdf` (jobsight-backend, Deno, pdf-lib):**

```
POST /functions/v1/render-report-pdf
Auth:    user JWT (purpose 'share' — data read with a user-scoped client, so RLS is the authorizer)
         service-role invocation (purpose 'distribution' — called by the submit path for M11 email)
Body:    { reportId: string, purpose: 'share' | 'distribution' }
Response 200: { ok: true, pdfPath: string, signedUrl: string, pageCount: number,
                renderedAt: string, layoutVersion: number }
Errors:  403 not a member (RLS) · 404 report not found · 422 report has no signature and
         customization requires one · 500 render failure (client falls back to device-degraded
         with the same confirm, or surfaces retry)
```

Behavior: fetch report + section rows + child tables + photos (+ `report_signatures`, + branding); download archive JPEGs from `worklog-photos`; **pdf-lib embeds the JPEG bytes without re-encode** (fits function memory/time limits at hundreds of photos — PRD §11.4); render against the copied `layout.ts` constants; write the PDF to `worklog-pdfs/<projectId>/<reportId>/<contentHash>.pdf` and return a short-lived signed URL (a heavy PDF as a response body would blow function response limits; the storage object also becomes the **cache** — a locked report's content hash is stable, so repeat renders and the distribution email reuse the same object). ASSUMPTION: `worklog-pdfs` is a private bucket with the same path-encoding RLS pattern as `worklog-photos`; draft/submitted renders are cache-busted by content hash so amendments and edits always produce a fresh artifact.

**TRADEOFF (accepted by spec §6 and PRD §11.4, restated for the record):** two renderers (HTML/expo-print and pdf-lib) is deliberate — edge functions cannot run a headless browser, and the server path is *not* an edge case (every M11 distribution email is pdf-lib output). The cost is the consistency burden below; the declined alternatives were server-only rendering (breaks offline export, a core requirement) and device-only rendering (breaks distribution-from-queue-drain and the photo ceiling).

### C.6 Dual-renderer consistency contract (PRD §15 #4 — core deliverable)

1. **Shared constants:** `layout.ts` is the single authority for section order, section titles, photo-grid geometry, provenance-line format strings, footer format, date/number formatting, and `LAYOUT_VERSION`. The edge function carries a **copied** constants file (app repo and backend repo are separate by §11 decision); the golden test is the drift guard.
2. **Golden-output test (CI, both repos):** a checked-in reference `ReportRenderModel` fixture — all 11 sections populated, one amendment, 6 photos covering every provenance variant (GPS, no-GPS, approximate, library taken-vs-added), signature — is rendered by both paths. The comparison is an **information-parity manifest**, not pixels: extracted text content per page (order-preserving), page count class, section order, every provenance line verbatim, totals, signature name/title/timestamp, footer identity fields. Manifests must be identical; a `LAYOUT_VERSION` mismatch between the two constants files fails the test outright. ASSUMPTION: pixel-identical output across an HTML engine and pdf-lib is not achievable or required — *information* parity plus shared geometry constants is the dispute-grade property (no fact appears in one rendering and not the other).
3. **Version stamping:** both renderers print `layout v⟨N⟩` in the footer, so any two PDFs of the same report can be checked for layout-generation equivalence after the fact.
4. **Routing rule recorded (from §C.5):** on-device share ≤40 photos · edge for >40 photos online and for all M11 distribution · device-degraded offline-heavy with explicit confirm.

---

### Cross-cutting notes

- **New mutation kinds introduced by this document:** `update_photo_meta` (ASSUMPTION, §A.8 — contested by the modules track; see `00-README.md` R1). Everything else rides the PRD §11.7 kind list unchanged. Dictation and PDF rendering add zero mutation kinds.
- **New Phase 3 schema obligations surfaced here:** `report_photos` columns as specified (§A.8); `report_signatures` (base64-in-RPC transport, §C.4); `worklog-pdfs` bucket + policies (§C.5); project coordinates for the GPS guard (already PRD §15 #11); storage DELETE policy for `remove_photo` (already PRD §11.7).
- **Stack deviations in this document:** piexifjs (Should, severable — §A.7, pre-flagged in PRD); no others. FlashList, react-native-calendars, network speech fallback, and OS background transfer remain declined as recorded in PRD §14.
