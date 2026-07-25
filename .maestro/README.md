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
| Repeated row | `<screen>-<kind>-<key>` | `login-demo-superintendent` |
| Status surface | `<screen>-<state>` | `login-error`, `login-notice` |

`PrimaryButton` and `TextField` both accept an optional `testID` and forward it
— use it rather than asserting on their `label`.

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

It is blocked on UI, not on tooling. Write it once these exist:

- a screen that creates a daily report,
- a section sheet that commits an edit through the mutation queue,
- a sync indicator (queued / syncing / synced) with a **`testID` and a
  machine-readable state** — asserting "the queue drained" against a spinner's
  copy reintroduces exactly the brittleness this file is about.

Maestro toggles connectivity with `- setAirplaneMode: enabled` / `disabled`,
which is the offline half of the flow. The assertions on reconciliation are the
part that needs the UI above.
