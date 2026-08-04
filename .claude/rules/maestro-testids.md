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
| Section sheet | `sheet-<section>` + `-done` / `-none` | `sheet-safety-done` |

The section-sheet prefix is the sheet's own name, which is not always the
`SectionKind`: the crew sheet is `sheet-crew-work`, so its footer is
`sheet-crew-work-done`. (`sheet-crew-done` was the example here until #22 and
exists nowhere in the source.) `.maestro/README.md` holds the live inventory —
check it rather than inferring a prefix from the section name.

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

Two rules for `DYNAMIC_TESTIDS` entries, both learned from guards that passed
while broken:

- **The prefix must appear in real code, not a comment.** The check strips
  comments first. `sync-status-` used to be satisfied by the prose in
  `SyncStatusBanner.tsx`'s header, so deleting the runtime template would have
  left the guard green.
- **If another file appends the suffix, name it in `derivedIn`.** A prefix
  declared in one file says nothing about the template that builds the full id
  elsewhere. `sheet-safety` was satisfied by a static literal in
  `SafetySectionSheet.tsx` while the `` `${testID}-none` `` template it was meant
  to protect lived in `SectionSheetScaffold.tsx`. Prefer the narrowest prefix
  that covers only genuinely derived ids — static siblings are found by the
  normal scan and need no exemption.

The guard proves a selector exists in source, not that navigation reaches it —
that is what the flow itself is for.
