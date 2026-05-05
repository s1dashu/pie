---
version: "alpha"
name: "Pie Desktop"
description: "Design system for Pie, a personal Agent client focused on agent state, configuration, logs, and usage visibility."
colors:
  background: "#F1F3F5"
  surface: "#F8F9FA"
  surfaceRaised: "#FFFFFF"
  surfaceSoft: "#FAFBFC"
  foreground: "#1A1F24"
  foregroundMuted: "#606873"
  border: "#D7DBDF"
  borderSubtle: "#E2E5E8"
  ring: "#9BA3AD"
  primary: "#1A1F24"
  primaryForeground: "#FFFFFF"
  accent: "#F8F9FA"
  accentForeground: "#1A1F24"
  success: "#4F7000"
  successSoft: "#F0F7D7"
  warning: "#7A4F00"
  warningSoft: "#FFF4D6"
  danger: "#B82025"
  dangerSoft: "#FFE5E5"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "0px"
  bodyLarge:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    letterSpacing: "0px"
  label:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "0px"
  sectionTitle:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.35"
    letterSpacing: "0px"
  metric:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: "1.75rem"
    letterSpacing: "0px"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, Liberation Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "1rem"
    letterSpacing: "0px"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  control: "18px"
  panel: "24px"
  dialog: "32px"
  shell: "48px"
  full: "9999px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
components:
  primaryButton:
    height: "40px"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primaryForeground}"
    padding: "{spacing.md} {spacing.lg}"
  input:
    height: "40px"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
    backgroundColor: "{colors.surfaceRaised}"
    textColor: "{colors.foreground}"
    padding: "{spacing.sm} {spacing.md}"
  card:
    rounded: "{rounded.panel}"
    typography: "{typography.body}"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    padding: "{spacing.md}"
  shell:
    rounded: "{rounded.shell}"
    backgroundColor: "{colors.surfaceRaised}"
    textColor: "{colors.foreground}"
    padding: "{spacing.xs}"
  statusBadgeRunning:
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    backgroundColor: "{colors.successSoft}"
    textColor: "{colors.success}"
    padding: "{spacing.xxs} {spacing.sm}"
  statusBadgeWaiting:
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    backgroundColor: "{colors.warningSoft}"
    textColor: "{colors.warning}"
    padding: "{spacing.xxs} {spacing.sm}"
  statusBadgeError:
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    backgroundColor: "{colors.dangerSoft}"
    textColor: "{colors.danger}"
    padding: "{spacing.xxs} {spacing.sm}"
  appCanvas:
    rounded: "{rounded.shell}"
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    padding: "{spacing.xs}"
  secondaryButton:
    height: "40px"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accentForeground}"
    padding: "{spacing.md} {spacing.lg}"
  subtlePanel:
    rounded: "{rounded.panel}"
    typography: "{typography.body}"
    backgroundColor: "{colors.surfaceSoft}"
    textColor: "{colors.foregroundMuted}"
    padding: "{spacing.md}"
  divider:
    height: "1px"
    backgroundColor: "{colors.borderSubtle}"
  strongDivider:
    height: "1px"
    backgroundColor: "{colors.border}"
  focusRing:
    size: "3px"
    backgroundColor: "{colors.ring}"
---

# Pie Desktop Design System

## Overview

Pie is a personal Agent client, not a marketing site and not a generic coding bot shell. The desktop UI should feel like a quiet operating console for long-running agents: low-saturation, softly rounded, moderately dense, and easy to scan across agent state, configuration, logs, usage, and channel status.

Prefer restraint over spectacle. Do not introduce landing-page composition, oversized hero typography, decorative illustrations, strong gradients, high-saturation brand blocks, or visual noise unless a product surface explicitly needs it. The first job of the interface is to make agent status and configuration legible.

## Implementation Model

Desktop UI uses Shadcn UI in source-owned mode. Component source lives in this repository and Pie owns the visual style and component API.

New Shadcn UI components must use Base UI primitives. Run Shadcn commands inside the renderer project and explicitly pass Base UI:

```bash
npx shadcn@latest init --base base --cwd src/desktop/renderer
npx shadcn@latest docs <component> --base base --cwd src/desktop/renderer
```

When adding or migrating headless primitives, prefer Base UI. Existing Radix primitives may remain; do not migrate them only for consistency. New `components/ui/*` files should not add new `@radix-ui/react-*` dependencies unless this design system is intentionally revised.

Tailwind CSS is the styling expression layer for Pie design tokens. Do not treat scattered utility classes as the design system. New UI should consume semantic tokens from `src/desktop/renderer/src/styles.css` or existing component primitives.

Radix Colors may be used as the main color scale source. Radix Themes typography scale can be used as reference, but Radix Themes components are not the default component library. Only use Radix Themes components in clearly isolated or temporary prototype surfaces.

## Color

The primary color system is based on Radix Slate and mapped to semantic tokens in `src/desktop/renderer/src/styles.css`: `background`, `foreground`, `muted`, `muted-foreground`, `border`, `input`, `ring`, `primary`, `accent`, and related component tokens.

Use semantic tokens first. If a direct scale value is necessary, prefer `var(--slate-*)` rather than new gray hex values. The appearance settings can adjust the Slate hue through `src/desktop/renderer/src/lib/appearance-theme.ts`, so components must keep depending on Slate tokens for hue changes to apply consistently.

Default light surfaces:

- App shell and page background: `var(--slate-2)` or `var(--slate-3)`.
- Cards and panels: `var(--slate-2)`, white, or translucent white.
- Dividers, tracks, and weak boundaries: `var(--slate-4)` through `var(--slate-6)`.
- Primary text: `text-foreground` or `var(--slate-12)`.
- Secondary text, hints, paths, and count labels: `text-muted-foreground` or `var(--slate-11)`.
- Weak charts, bars, and progress fills: `var(--slate-8)` through `var(--slate-10)`.

Status colors are functional only:

- Lime means running, success, available, or can continue.
- Amber means waiting, warning, or needs attention.
- Red means error, danger, destructive, or delete.

Do not expand Lime, Amber, or Red into large brand backgrounds. Keep status color areas small: dots, badges, icons, progress markers, and focused state surfaces.

Dark mode tokens exist partially, but dark/light theme switching is not a finished product capability. New UI may be compatible with `.dark`, but do not expose or describe dark mode as complete product functionality.

## Typography

Use the global font stack from `styles.css`: Inter first, then Apple/system UI fonts, with Chinese system font fallbacks. Do not introduce new body fonts inside local components.

Supported Tailwind text sizes are intentionally narrow:

- `text-xs`: labels, hints, metadata, paths, counts, compact status text.
- `text-sm`: default UI body text, inputs, controls, table/list rows.
- `text-base`: card and section titles, emphasized body text.
- `text-lg`: small metric values or compact page-level emphasis.
- `text-xl` and `text-2xl`: major metric values and rare primary results.

All text tokens use `letter-spacing: 0`. Do not use viewport-based font sizes, negative letter spacing, or large display sizes for normal desktop surfaces.

Common patterns:

- Card or section title: `text-base font-semibold leading-snug`.
- Card subtitle or hint: `text-xs leading-none` or `text-xs leading-5 text-muted-foreground`.
- Form label, status label, path, or count: `text-xs font-medium` or regular `text-xs`.
- Regular explanatory copy: `text-sm`.
- Code, paths, and log fragments: `font-mono text-[11px]` or a close size.
- Metrics: `text-lg` to `text-2xl`, `font-bold`, and `tabular-nums`.

Avoid stacking multiple bold elements inside the same card. Usually only the active section title or the primary metric should be visually heavy; subtitles, hints, paths, and explanations stay muted.

Use uppercase labels only for overview metric cards: `uppercase text-xs font-medium text-muted-foreground`. Do not uppercase ordinary navigation, buttons, or descriptive copy.

## Shape And Surfaces

Pie uses soft rounded rectangles and continuous corners. Prefer existing CSS custom properties:

- Controls: `var(--control-radius)` (`18px`).
- Control menus: `var(--control-menu-radius)`.
- Control menu items: `var(--control-item-radius)`.
- App shell: `var(--app-shell-radius)` (`48px`).
- Agent detail surface: `var(--agent-detail-radius)`.

Use `pie-smooth-corner` where a smooth corner treatment is already part of the surrounding surface language. Keep cards and panels visually calm with subtle borders, soft inset highlights, and low-contrast shadows.

Do not put UI cards inside other cards. Use cards for repeated items, modals, and genuinely framed tools. Page sections should be full-width bands or unframed layouts with constrained content.

## Layout And Density

The desktop app is a working client. Prioritize scan speed, stable layout, and repeat workflows over editorial composition.

Use predictable navigation, compact but readable panels, and clear grouping. Stable controls, counters, grids, timelines, and toolbar elements should have fixed or constrained dimensions so labels, icons, hover states, and loading text do not resize or shift the layout.

Text must fit inside its parent across desktop and narrow viewports. Wrap to a new line when needed. If a long token still cannot fit, use truncation, min-width constraints, or dynamic sizing so it does not overlap neighboring content.

## Components

Buttons should use icon-only controls when the command has a familiar symbol, especially for tool actions such as undo, redo, save, download, zoom, bold, italic, pause, resume, start, stop, refresh, and settings. Use lucide icons when an icon exists. Add a tooltip for icon-only or unfamiliar commands.

Use text or icon-plus-text buttons only for clear commands where text materially improves recognition. Keep button text short and ensure it fits at all supported widths.

Use familiar controls for common input types:

- Swatches for color.
- Segmented controls for mutually exclusive modes.
- Toggles or checkboxes for binary settings.
- Sliders, steppers, or numeric inputs for numeric values.
- Menus or selects for option sets.
- Tabs for peer views.

Inputs and selects should default to 40px height, rounded control corners, white or tokenized surfaces, subtle hover border, and 3px focus rings using the ring token.

Dialogs and popovers should feel like focused working surfaces, not marketing cards. Keep copy direct. Avoid large illustration headers unless the surface is explicitly visual.

## Motion And Interaction

Use motion to explain state changes and preserve orientation, not to decorate. Keep transitions short, subtle, and tied to interaction: hover color shifts, active press movement, opacity changes, small scale changes, focus rings, and state indicators.

Loading states should reserve space before content arrives. Use skeletons, stable spinners, or fixed-height placeholders so panels do not jump.

## Product-Specific UI Guidance

Agent state, runtime status, channel status, logs, usage, and skills paths are first-class operational information. Make them easy to scan with compact rows, restrained metrics, clear status dots or badges, and muted supporting text.

Access Mode and sandbox-related UI must distinguish real enforcement from policy or configuration. Only call something a sandbox when the backend or Pie execution layer actually enforces it. For Pi and Ousia today, `workDir` is a workspace policy/default directory, not a security boundary.

Skills management is intentionally light: show grouped sources, paths, and existence state, and provide a way to open the corresponding folder. Do not design this as a marketplace, installer, permission system, sync system, database, or plugin runtime unless the product scope changes.

Global appearance settings may expose available appearance convergence controls such as Slate hue. Do not expose a finished light/dark theme switch until the product capability is actually supported.

## Anti-Patterns

Avoid these by default:

- Marketing-page hero sections inside the desktop app.
- Decorative gradient backgrounds, blobs, or orbs.
- Large illustrations used only for atmosphere.
- One-note palettes dominated by a single hue family.
- New gray hex values when Slate or semantic tokens are available.
- High-saturation brand surfaces.
- Dense stacks of bold text.
- Viewport-scaled typography.
- Negative letter spacing.
- Nested cards.
- Text that overlaps controls, icons, or neighboring content.
- Describing planned UI capabilities as already shipped.
