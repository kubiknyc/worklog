# Maestro E2E flows

Device-level tests. Jest covers the pure sync policy (`src/sync/`); these cover
what only a real device can prove.

## Running

```
maestro test .maestro/login.yaml     # one flow
maestro test .maestro/                # all flows
```

Needs a booted emulator or a USB device (`adb devices` must list one) plus a
dev build installed. `login.yaml` documents its own preconditions.

## Selector strategy

The app defines **one** `testID` today (`chip-check` in `Chip.tsx`), so these
flows key on visible text and `accessibilityLabel`. That is brittle: changing
user-facing copy breaks the flow.

Prefer adding `testID` to elements as you build screens, and switch the
assertions to `id:` as they appear. Text assertions here are a stopgap, not a
convention to follow.

## Blocked: the offline reconciliation flow

The highest-value flow — the one the sync engine exists for — **cannot be
written yet**:

> launch → create a report → go offline → mutate sections → come back online →
> assert the queue drained and the server state reconciled

`src/sync/` implements this (`mutationQueue.ts` at 100% coverage,
`conflict.ts`, `cursors.ts`, `paginate.ts`), and each piece is unit-tested.
Nothing exercises them together against a real SQLite database and a real
Supabase instance.

It is blocked on UI, not on tooling. As of M2 all four tab screens are 12-line
placeholders (`app/(tabs)/index.tsx` renders `Today — M2` and nothing else),
and `src/components/report/` holds a `SectionSheetScaffold`, not a working
sheet. There is no way to create a report or edit a section from the UI, so
there is nothing for a flow to drive.

Write it once these exist:

- a screen that creates a daily report,
- a section sheet that commits an edit through the mutation queue,
- some visible sync indicator (queued / syncing / synced) to assert against.

Maestro toggles connectivity with `- setAirplaneMode: enabled` / `disabled`,
which is the offline half of the flow. The assertions on reconciliation are
the part that needs the UI above.
