---
name: WorkLog
description: The daily construction report, in the PunchLog design system.
colors:
  blueprint-bg: "#0C2944"
  blueprint-surface: "#103A5C"
  blueprint-surface2: "#0E3252"
  blueprint-text: "#EAF4FF"
  blueprint-muted: "#8FB6D6"
  blueprint-faint: "#5E86A6"
  blueprint-border: "rgba(120,180,220,0.18)"
  blueprint-accent: "#4FC3F7"
  blueprint-accent-ink: "#06243C"
  blueprint-error: "#FF8A8A"
  editorial-bg: "#F0EBE0"
  editorial-surface: "#F8F4EB"
  editorial-surface2: "#EAE3D3"
  editorial-text: "#1F1B14"
  editorial-muted: "#645B4B"
  editorial-faint: "#6B6354"
  editorial-border: "rgba(43,36,24,0.14)"
  editorial-accent: "#9A3B2E"
  editorial-accent-ink: "#F5F0E6"
  editorial-error: "#B42318"
  beton-bg: "#C9C8C3"
  beton-surface: "#D3D2CD"
  beton-surface2: "#C0BFBA"
  beton-text: "#46453F"
  beton-muted: "#4A4945"
  beton-faint: "#525147"
  beton-border: "rgba(28,26,23,0.12)"
  beton-accent: "#8A2F0A"
  beton-accent-ink: "#FFFFFF"
  beton-error: "#8E1B12"
  blueprint-report-draft: "#FF6B6F"
  blueprint-report-submitted: "#8AA6F7"
  blueprint-report-locked: "#46C98A"
  blueprint-report-amended: "#4FC3F7"
  editorial-report-draft: "#E5484D"
  editorial-report-submitted: "#3E63DD"
  editorial-report-locked: "#1F8A50"
  editorial-report-amended: "#9A3B2E"
  beton-report-draft: "#BE3137"
  beton-report-submitted: "#2F50C0"
  beton-report-locked: "#1A7745"
  beton-report-amended: "#8A2F0A"
  blueprint-priority-medium: "#E8A100"
  editorial-priority-medium: "#9E6900"
  beton-priority-medium: "#855700"
  blueprint-priority-low: "#9AA7B4"
  editorial-priority-low: "#697787"
  beton-priority-low: "#586470"
  camera-blue: "#3FA9F0"
typography:
  display:
    fontFamily: "Spectral_700Bold, Georgia, serif"
    fontSize: "52px"
    fontWeight: 700
    letterSpacing: "-2px"
  headline:
    fontFamily: "Spectral_700Bold, Georgia, serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Spectral_700Bold, Georgia, serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.4px"
  sheet-title:
    fontFamily: "Archivo_700Bold, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "-0.3px"
  body:
    fontFamily: "Archivo_400Regular, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  row-title:
    fontFamily: "Archivo_600SemiBold, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.1px"
  button:
    fontFamily: "Archivo_700Bold, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  meta:
    fontFamily: "Archivo_400Regular, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "Archivo_600SemiBold, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.4px"
  tab-label:
    fontFamily: "Archivo_600SemiBold, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  code:
    fontFamily: "JetBrainsMono_500Medium, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.3px"
rounded:
  firm-badge: "3px"
  avatar: "10px"
  pill: "12px"
  button: "14px"
  input: "14px"
  row: "14px"
  card: "18px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
  screen: "16px"
components:
  button-primary:
    backgroundColor: "{colors.blueprint-accent}"
    textColor: "{colors.blueprint-accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    height: "50px"
  button-confirm-lock:
    backgroundColor: "{colors.blueprint-report-locked}"
    textColor: "{colors.blueprint-bg}"
    rounded: "{rounded.button}"
    height: "50px"
  button-secondary:
    textColor: "{colors.blueprint-text}"
    rounded: "{rounded.button}"
    height: "50px"
  input:
    backgroundColor: "{colors.blueprint-surface2}"
    textColor: "{colors.blueprint-text}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    height: "50px"
    padding: "0 14px"
  filter-chip:
    textColor: "{colors.blueprint-muted}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
  filter-chip-active:
    backgroundColor: "{colors.blueprint-accent}"
    textColor: "{colors.blueprint-accent-ink}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
  status-chip:
    textColor: "{colors.blueprint-text}"
    rounded: "{rounded.full}"
    padding: "5px 10px"
  card:
    backgroundColor: "{colors.blueprint-surface}"
    rounded: "{rounded.card}"
  bottom-sheet:
    backgroundColor: "{colors.blueprint-surface}"
    rounded: "{rounded.card}"
    padding: "10px 16px 12px"
  tab-bar:
    backgroundColor: "{colors.blueprint-surface}"
    textColor: "{colors.blueprint-muted}"
    typography: "{typography.tab-label}"
---

# Design System: WorkLog

> WorkLog (App #2) shares PunchLog's design system and colors with no accent of its own, so the two JobSight Suite apps look like one product. PunchLog's `DESIGN.md` is the reference; this file restates it with WorkLog's report statuses and screens. When the two disagree, PunchLog's values win and WorkLog's code should be brought into line.

## Overview

**Creative North Star: "The Architect's Office"**

WorkLog is a professional instrument, not field equipment and not a dashboard. Its world is the drawing set: fine lines, paper and ink, and editorial serif moments. Precision in the details is the premium signal: hairline borders, aligned mono numerals, deliberate whitespace. Gloss, gradients and depth effects are not. The personality is sharp, precise and considered, and the emotional goal is confidence and control.

The system ships three themes from one token set. **Blueprint** (deep architectural blue, dark) is the default and the site theme: it is the drawing itself. **Editorial** (warm paper, light) and **Béton** (concrete grey, light) suit indoor and office review. Theme choice follows context, never decoration. Every value in `src/theme/tokens.ts` is per-theme and WCAG-verified, so a new color is never a one-theme decision.

The work happens on a phone, on site, at the end of a shift. Density is "glanceable first": a superintendent sees whether today's report is a draft, submitted or locked in under a second. Confirmed anti-references: Procore-style enterprise density; consumer-social playfulness (emoji, bubbly color); generic SaaS (purple gradients, glass cards, cyan-on-dark sparklines); and bare stock UI with no personality.

**Key Characteristics:**
- Bordered, flat surfaces; depth only where something truly floats.
- Spectral serif for signature moments, Archivo sans for all work, JetBrains Mono only where alignment is functional.
- One accent per theme, rare and load-bearing.
- Status always carried by color **and** a text label.
- Token-driven: color, spacing, radii and fonts come from `src/theme`, never hard-coded.

## Colors

Three tonally coherent palettes (ink-blue, warm paper, concrete) sharing one role structure, with a per-theme status and priority set tuned to clear contrast on that theme.

### Primary
- **Survey Cyan** (Blueprint accent): the primary CTA, active filter chip, active tab tint and selection, and the Amended report state. Paired with **Deep Drafting Ink** (accent-ink) for text on top.
- **Oxblood Rubric** (Editorial accent): the same roles on warm paper; reads like the red ink of a marked-up print.
- **Rust Iron** (Béton accent): the same roles on concrete, darkened to clear AA under white ink.

### Neutral
- **Blueprint Night / Plan Blue / Sheet Blue** (Blueprint bg / surface / surface2): page ground, cards and rows, and inset fields and avatars.
- **Cold Paper Ink, Faded Line Blue, Ghost Grid Blue** (Blueprint text / muted / faint): primary text, secondary text and labels, and separators and icons on placeholders.
- **Bone Paper / Fresh Sheet / Kraft** (Editorial bg / surface / surface2) with **Lamp Black** text and **Pencil Umber** muted.
- **Poured Concrete / Trowelled Slab / Shadowed Form** (Béton bg / surface / surface2) with **Graphite** text.
- **Hairline borders** are translucent per theme (the rgba border tokens), so a 1px rule always reads as a drawn line, never a box.

### Report status & priority
- Report lifecycle per theme: **Draft** (PunchLog's Open red), **Submitted** (In-progress blue), **Locked** (Closed green). **Amended** is a derived display state for a locked report with amendments, drawn in the theme accent.
- Priority matches PunchLog: **High** red, **Medium** amber, **Low** slate.
- Error text has its own per-theme token at AA 4.5:1.

### Known drift in WorkLog code
- **Béton accent:** `src/theme/tokens.ts` still uses `#E8531F` with dark ink (`#0B0F14`). PunchLog replaced that orange with **Rust Iron** (`#8A2F0A`, white ink) because it failed contrast, and WorkLog pins its 2.0–2.4:1 Amended chip as a known exception in `contrast.test.ts`. Adopting PunchLog's value removes the exception.
- **Editorial medium priority:** WorkLog uses `#A36C00`; PunchLog uses `#9E6900`.

### Fixed (theme-invariant)
- **Camera Blue** (`camera-blue`): reserved for camera capture, matching PunchLog.

### Named Rules
**The Load-Bearing Accent Rule.** The theme accent marks the one thing you can act on or the state you're in: primary CTA, active chip, active tab, selection. It never decorates.

**The Color-Plus-Word Rule.** No status or priority is ever color alone. A chip carries the label in theme text ink; a row bar or dot is backed by the accessibility label.

**The Three-Theme Rule.** A new color is three colors. Add it to every palette and verify it against that theme's bg, surface and surface2 before shipping.

## Typography

**Display Font:** Spectral (Georgia fallback)
**Body Font:** Archivo (system sans fallback)
**Label/Mono Font:** JetBrains Mono, for codes and numeric counts only

**Character:** An editorial serif against a sturdy grotesque, like a title block on a drawing set: the serif signs the sheet, the sans does the work.

### Hierarchy
- **Display** (Spectral Bold, 52px, -2px tracking): hero numerals on the Today screen, when present.
- **Headline** (Spectral Bold, 26px, -0.5px): screen titles. Login wordmark runs at 34px.
- **Title** (Spectral Bold, 22–24px, -0.4px, 28px line): report detail title and project name. Empty-state titles use Spectral SemiBold at 17px.
- **Sheet title** (Archivo Bold, 19px, -0.3px): bottom-sheet headers.
- **Body** (Archivo Regular, 15px): inputs, sheet rows and running copy. Notices use Archivo Medium 13px on an 18px line.
- **Row title** (Archivo SemiBold, 15px, -0.1px, one line): the primary line of every list row (a report's date or project).
- **Meta** (Archivo Regular, 12.5px): dot-separated secondary details; alert parts switch to SemiBold in the priority-high color.
- **Label** (Archivo SemiBold, 12px, 0.4px, UPPERCASE): field labels and dashboard section labels.
- **Code** (JetBrains Mono Medium, 12px, 0.3px): codes and counts, in muted ink.
- **Tab label** (Archivo SemiBold, 11px): the floor; nothing in the UI goes below 11px.

### Named Rules
**The Signature Serif Rule.** Spectral appears only at moments that matter: wordmark, report title, screen titles, empty-state headline. Never in a button, label, row or field.

**The Functional Mono Rule.** JetBrains Mono is for identity and alignment (codes, counts), never "techie" flavor.

**The One Pairing Rule.** Any font change is a whole-app decision made once in `src/theme/fonts.ts`. No per-screen fonts.

## Layout

A single phone column with a 16px screen gutter (`SIZES.screenPad`). Vertical rhythm uses the 4pt semantic scale (`xs` 4 → `xxxl` 48); new and edited code uses the scale rather than inline pixels.

Lists use two density presets: **Comfortable** (15px row padding, 10px gap, default) and **Compact** (11px, 7px). Bottom navigation is a three-slot tab bar: Today, History, Settings. Controls are sized for gloves and sun: 50px buttons and inputs, 34px row affordances with 6px hit slop, and 44pt minimum targets everywhere.

## Elevation & Depth

Flat by default. Surfaces separate by tone (bg → surface → surface2) and by a 1px translucent hairline border, the way a drawing separates by line weight. Shadows are reserved for elements that physically float over the content.

### Shadow Vocabulary
- **Floating bar** (black, 0.25 opacity, 10px radius): the bulk-action bar in select mode.
- **Toast / celebration** (black, 0.25–0.3 opacity, 12–16px radius): transient overlays.

### Named Rules
**The Float-Only Shadow Rule.** If it doesn't float over content, it has no shadow. Cards, rows, sheets and chips are bordered and flat.

## Shapes

Softly squared, never bubbly. Containers share one corner family: 18px cards and sheet tops, 14px rows, buttons and inputs, 12px filter pills, and 10px avatars. Status chips are the one fully round (999px) element. Borders are 1px hairlines; 1.5–2px strokes appear only on interactive outlines (advance button, checkbox). List rows may lead with a 4px full-height status bar, PunchLog's signature edge, in the report-status color.

## Components

### Buttons
Confident, tall and flat.
- **Shape:** gently squared (14px), 50px tall, full width in forms and sheets.
- **Primary:** theme accent fill with accent-ink text, Archivo Bold 16px. Disabled drops to 0.7 opacity.
- **Confirm-lock:** the Locked report green, with ink picked for contrast at runtime, for the confirmation that locks a report.
- **Secondary:** transparent with a 1px hairline border and text ink (the Cancel in confirm sheets).
- **Press:** a subtle scale (0.96–0.985) plus 0.9 opacity, never opacity alone.

### Chips
- **Filter chip:** hairline-bordered pill (12px), Archivo SemiBold 13px in muted ink, 7×13px padding. Active state fills with the accent and switches to accent-ink text.
- **Status chip:** fully round pill tinted with the status color at about 13% alpha, a 7px status dot, and the label in theme **text** ink (status-colored text on its own tint failed AA). Two sizes: sm (11px) and md (12.5px).

### Cards / Containers
- **Corner Style:** 18px.
- **Background:** surface on a bg page; inset elements use surface2.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px theme hairline; the accent replaces it only to mark selection or a focal card.

### Inputs / Fields
- **Style:** 50px tall, 14px radius, 1px hairline border, 12–14px horizontal padding, Archivo 15px. An uppercase 12px label sits 6px above.
- **Error:** per-theme error-token text below the field, Archivo Medium 13px.

### Navigation
- **Tab bar (Today, History, Settings):** surface background with a hairline top border, Ionicons, Archivo SemiBold 11px labels. Active tint is the theme accent; inactive is muted.

### Bottom Sheet
18px top corners, a 40×4px grab handle, 16px side padding, an Archivo Bold 19px title, and 50px action buttons. Used for pickers and confirmations.

## Do's and Don'ts

### Do:
- **Do** pull every color, radius, spacing value and font from `src/theme` (`useTheme()`); the pre-auth login's locked Blueprint is the one exception.
- **Do** pair every status or priority color with a label or accessibility text.
- **Do** verify any new color against all three themes' bg, surface and surface2 (AA 4.5:1 for text, 3:1 for indicators).
- **Do** keep motion to transform and opacity on the native driver, with a press-scale on tappables and one staggered reveal per screen at most. Honor reduce-motion.
- **Do** keep tap targets at 44pt minimum and primary controls at 50px.
- **Do** take any new shared token from PunchLog's `src/theme/tokens.ts` first, so the two apps never diverge.

### Don't:
- **Don't** add drop shadows to cards, rows, chips or sheets; only floating elements cast them.
- **Don't** use gradients, glass, blur effects or decorative sparklines.
- **Don't** set Spectral in UI controls, or JetBrains Mono for anything but codes and counts.
- **Don't** give WorkLog an accent of its own, or use the theme accent for decoration.
- **Don't** put status-colored text on its own status tint; use theme text ink.
- **Don't** pick a WorkLog-only color where a PunchLog token exists.
- **Don't** go below 11px for any UI text.
