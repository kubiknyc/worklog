---
paths:
  - ".maestro/**"
  - "src/maestroSelectors.test.ts"
---

# Maestro selector rules

**Flows key on `testID`, never on visible copy.** Copy in this app is plain
language and expected to change; a text assertion breaks for reasons unrelated
to the behaviour under test.

## Naming convention (full inventory: `.maestro/README.md`)

| Kind | Pattern | Example |
|---|---|---|
| Screen root | `screen-<route>` | `screen-today` |
| Tab bar button | `tab-<route>` | `tab-history` |
| Form control | `<screen>-<field>` | `login-submit` |
| Repeated row | `<screen>-<kind>-<key>` | `login-demo-superintendent` |
| Status surface | `<screen>-<state>` | `login-error` |
| Global status pill | `sync-status` + `sync-status-<state>` | `sync-status-queued` (screen-agnostic by design) |
| Section sheet | `sheet-<section>` + `-done` / `-none` | `sheet-crew-done` |

`SectionSheetScaffold` derives `<prefix>-none` and `<prefix>-done` from its
`testID` prefix; a sheet supplying its own `footer` owns that button's testID.
`PrimaryButton`, `TextField`, `SheetRow` accept and forward `testID` — use it
rather than asserting on `label` or `accessibilityLabel`.

## The guard

Every `id:` a flow selects on must exist as a `testID` (or
`tabBarButtonTestID`) in `app/` or `src/` — `src/maestroSelectors.test.ts`
enforces this in `npm run verify`. Runtime-built testIDs
(`login-demo-${role}`) go in that test's `DYNAMIC_TESTIDS` list with the file
that generates them. Never loosen the assertion.

The guard proves a selector exists in source, not that navigation reaches it —
that is what the flow itself is for.
