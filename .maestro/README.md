# Maestro E2E flows

Device-level tests. Jest covers the pure sync policy (`src/sync/`); these cover
what only a real device can prove.

## Running

```
maestro test .maestro/login.yaml     # one flow
maestro test .maestro/               # all flows
```

Needs a booted emulator or a USB device (`adb devices` must list one) plus an
installed build with demo logins enabled:

```
eas build --profile e2e-test --platform android
```

The `e2e-test` profile in `eas.json` produces an emulator-compatible APK (and
an iOS simulator `.app`) with `EXPO_PUBLIC_DEMO_LOGINS=on`, which is what
`login.yaml`'s fast path depends on. `login.yaml` documents its own
preconditions.

## In CI

`.eas/workflows/e2e-android.yml` builds that profile and runs these flows on
every PR. The `maestro` job type is alpha — keep it out of required status
checks until it has proven stable, so an infra flake can't block a merge.

## Selector strategy

**Flows key on `testID`, never on visible copy.** User-facing copy in this app
is plain language and expected to change (CLAUDE.md), so a text assertion
breaks for reasons unrelated to the behaviour under test.

The convention, applied as screens are built rather than retrofitted:

| Kind | Pattern | Examples |
|---|---|---|
| Screen root | `screen-<route>` | `screen-today`, `screen-history`, `screen-photos`, `screen-settings`, `screen-camera` |
| Tab bar button | `tab-<route>` | `tab-today`, `tab-history`, `tab-camera`, `tab-photos`, `tab-settings` |
| Form control | `<screen>-<field>` | `login-email`, `login-password`, `login-submit`, `login-forgot` |
| Repeated row | `<screen>-<kind>-<key>` | `login-demo-superintendent`, `report-section-crew_work` |
| Status surface | `<screen>-<state>` | `login-error`, `login-notice` |
| Global status pill | `sync-status` + `sync-status-<state>` | `sync-status-synced`, `sync-status-queued` — deliberate exception to `<screen>-<state>`: the pill is the same surface on every screen |
| Section sheet | `sheet-<section>` + `-done` / `-none` / `-add` | `sheet-crew-work`, `sheet-crew-work-done`, `sheet-crew-work-none`, `sheet-deliveries-add` |

`PrimaryButton`, `TextField` and `SheetRow` all accept an optional `testID` and
forward it — use it rather than asserting on their `label` or
`accessibilityLabel`.

`SectionSheetScaffold` takes a `testID` prefix and derives `<prefix>-none` for
the affirmation row and `<prefix>-done` for the default footer, so every
section sheet exposes the same two handles without restating them. A sheet that
supplies its own `footer` owns that button's testID. A list-entry sheet's "Add"
button carries `<prefix>-add`.

The nine section-sheet prefixes shipped today: `sheet-crew-work`,
`sheet-weather`, `sheet-deliveries`, `sheet-equipment`, `sheet-inspections`,
`sheet-safety`, `sheet-delays`, `sheet-visitors`, `sheet-rfis` (plus the
pre-existing `sheet-notes` for General notes).

### The guard

`src/maestroSelectors.test.ts` asserts that every `id:` a flow selects on exists
as a `testID` (or `tabBarButtonTestID`) somewhere in `app/` or `src/`. It runs in
`npm run verify`, so a rename fails in seconds rather than twenty minutes into a
cloud build against a real device.

It proves the selector exists in source. It cannot prove the element is on
screen or that navigation reaches it — that is what the flow itself is for.

testIDs built at runtime (`login-demo-${role}`) can't be found by a literal
scan, so they are declared in that test's `DYNAMIC_TESTIDS` list along with the
file that generates them. Add to it rather than loosening the assertion.

## Blocked: the offline reconciliation flow

The highest-value flow — the one the sync engine exists for — **cannot be
written yet**:

> launch → create a report → go offline → mutate sections → come back online →
> assert the queue drained and the server state reconciled

`src/sync/` implements this (`mutationQueue.ts` at 100% coverage,
`conflict.ts`, `cursors.ts`, `paginate.ts`), and each piece is unit-tested.
Nothing exercises them together against a real SQLite database and a real
Supabase instance. Until this flow exists, 100% coverage on `mutationQueue.ts`
proves the *policy* is correct and proves nothing about the *engine*.

It is now blocked only on the sync ENGINE (M3), not on UI. All three UI
prerequisites shipped with M2: report creation from Today, section sheets
writing through the mutation queue, and the sync indicator
(`SyncStatusBanner` — machine-readable `sync-status-<state>` testIDs;
`report-sections.yaml` asserts the synced→queued transition). The engine that
drains the queue is what the reconciliation assertions still wait for.

Maestro toggles connectivity with `- setAirplaneMode: enabled` / `disabled`,
which is the offline half of the flow. `sync-status-synced` after
`setAirplaneMode: disabled` is the "queue drained" assertion once M3 lands.
