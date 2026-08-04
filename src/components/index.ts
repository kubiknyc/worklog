/**
 * Shared UI components — screens import from here.
 *
 * **No consumer yet** (audited 2026-08-04, #22): `ErrorState`, `RecentsRow`,
 * `ListSkeleton`, `CardSkeleton`, `REPORT_STATUS_LABELS`, `Stagger`. These are
 * suite-shared chrome ported verbatim (see
 * `docs/architecture/02-modules-navigation-sync.md`) and kept deliberately —
 * but a barrel makes "exported" and "used" indistinguishable, so the status is
 * recorded here rather than left for the next reader to rediscover. None has a
 * test; add one when a screen adopts it.
 *
 * `ErrorState` is the one to reach for first: Today
 * (`app/(tabs)/index.tsx:100-113`) and report detail
 * (`app/report/[id]/index.tsx:380-384`) each hand-compose `EmptyState` +
 * `PrimaryButton("Try again")` instead. They were not switched over because
 * both carry a screen-specific icon and title that `ErrorState`'s message-only
 * API cannot express — widening that API is the real fix and its own change.
 * The drift that had already happened is fixed: report detail's retry had no
 * `testID`, so no flow could drive it; it is now `report-retry`.
 */
export { AuthSplash } from './AuthSplash';
export { BottomSheet } from './BottomSheet';
export { Chip } from './Chip';
export { ChipRow, type ChipOption } from './ChipRow';
export { ConfirmSheet } from './ConfirmSheet';
export { EmptyState } from './EmptyState';
export { ErrorState } from './ErrorState';
export { PrimaryButton } from './PrimaryButton';
export { RecentsRow } from './RecentsRow';
export { ReportStatusChip, REPORT_STATUS_LABELS } from './ReportStatusChip';
export { SheetRow } from './SheetRow';
export { SyncQueueScreen, confirmMessageOf, kindLabelOf, rowDetailOf } from './SyncQueueScreen';
export {
  ConnectedSyncStatusBanner,
  SyncStatusBanner,
  bannerLabelOf,
  bannerStateOf,
  type SyncBannerState,
} from './SyncStatusBanner';
export { ListSkeleton, CardSkeleton, DetailSkeleton } from './Skeleton';
export { Stagger } from './Stagger';
export { Stepper } from './Stepper';
export { TextField } from './TextField';
export { ToastProvider, useToast, type ToastApi, type UndoableToastOptions } from './ToastProvider';

// Section-input scaffolding + static pick lists (report-write path).
export { EntryCard } from './report/EntryCard';
export { SectionSheetScaffold } from './report/SectionSheetScaffold';
export {
  useSectionDraft,
  SECTION_DRAFT_DEBOUNCE_MS,
  type SectionDraft,
} from './report/useSectionDraft';
export {
  TRADES,
  DELIVERY_UNITS,
  DELAY_CAUSES,
  VISITOR_ROLES,
  INSPECTION_AGENCIES,
  SAFETY_TYPES,
  INSPECTION_RESULTS,
  EQUIPMENT_STATUS,
  WEATHER_CONDITIONS,
} from './report/sectionConstants';
