---
version: "2026-05"
name: "Pie Desktop"
description: "Current design system for Pie, a personal Agent client focused on agent state, configuration, logs, usage visibility, and channel/runtime setup."
sources:
  tokens: "src/desktop/renderer/src/styles.css"
  appShell: "src/desktop/renderer/src/App.tsx"
  layout:
    - "src/desktop/renderer/src/layout/AgentSidebar.tsx"
    - "src/desktop/renderer/src/layout/AgentDetailPane.tsx"
  primitives: "src/desktop/renderer/src/components/ui/"
  sharedComponents: "src/desktop/renderer/src/components/shared/"
colors:
  background: "var(--slate-3)"
  foreground: "var(--slate-12)"
  surface: "white"
  surfaceSoft: "var(--slate-2)"
  surfaceHover: "var(--slate-3)"
  muted: "var(--slate-3)"
  mutedForeground: "var(--slate-11)"
  border: "var(--slate-6)"
  borderSubtle: "var(--slate-5)"
  ring: "var(--slate-8)"
  primary: "var(--slate-12)"
  primaryForeground: "white"
  success: "var(--lime-9)"
  successText: "var(--lime-11)"
  warning: "var(--amber-9)"
  warningText: "var(--amber-11)"
  danger: "var(--red-9)"
  dangerText: "var(--red-11)"
typography:
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
  sizes:
    xs: "0.75rem / 1rem"
    sm: "0.875rem / 1.25rem"
    base: "1rem / 1.5rem"
    lg: "1.125rem / 1.625rem"
    xl: "1.25rem / 1.75rem"
    "2xl": "1.5rem / 1.875rem"
  letterSpacing: "0"
radii:
  checkbox: "6px"
  control: "18px"
  controlMenu: "calc(var(--control-radius) + 4px)"
  controlItem: "calc(var(--control-radius) - 4px)"
  panel: "24px-42px depending on density"
  appShell: "48px"
  agentDetail: "calc(var(--app-shell-radius) - var(--app-shell-gap))"
  full: "9999px"
components:
  buttonDefault:
    height: "36px"
    radius: "rounded-4xl"
    background: "var(--slate-12)"
    text: "white"
  inputDefault:
    height: "40px"
    radius: "var(--control-radius)"
    background: "white"
    focusRing: "3px var(--ring)"
  selectDefault:
    height: "40px"
    radius: "var(--control-radius)"
    menuRadius: "var(--control-menu-radius)"
  sidebarItem:
    height: "72px"
    radius: "36px"
  detailHeader:
    height: "72px"
  metricCard:
    radius: "24px-36px"
    background: "var(--slate-2)"
---

# Pie Desktop Design System

## Product Positioning

Pie is a personal Agent client. The desktop app is an operating console for creating, running, configuring, and observing long-running agents. It should feel quiet, precise, and work-focused rather than like a marketing site or generic chatbot wrapper.

The interface must make agent state, runtime health, channel setup, model configuration, usage, logs, and workspace paths easy to scan. Use restrained surfaces, compact controls, predictable navigation, and small functional status marks. Do not introduce oversized hero sections, decorative illustrations, broad gradients, high-saturation brand blocks, or copy that describes future capabilities as shipped product.

## Implementation Model

Desktop UI lives under `src/desktop/renderer`. Tailwind CSS v4 is the styling layer, with semantic tokens defined in `src/desktop/renderer/src/styles.css`. Treat those tokens and the source-owned UI primitives in `src/desktop/renderer/src/components/ui/` as the design system. Do not treat one-off utility-class bundles as reusable design rules.

The current primitive stack is:

- React 19, Vite, Tailwind CSS v4.
- Source-owned Shadcn-style components using Base UI primitives.
- Radix Colors for color scales.
- `motion/react` for small orientation-preserving transitions.
- `solar-icon-set`, Hugeicons, and limited Lucide icons where already used.
- `sonner` for toast notifications.

When adding new Shadcn components, run commands inside the renderer project and explicitly use Base UI:

```bash
npx shadcn@latest init --base base --cwd src/desktop/renderer
npx shadcn@latest docs <component> --base base --cwd src/desktop/renderer
```

New `components/ui/*` files should use Base UI. Existing Radix or other primitives may remain, but do not add another headless UI stack for ordinary controls.

## Color

Use semantic tokens first: `background`, `foreground`, `muted`, `muted-foreground`, `border`, `input`, `ring`, `primary`, `accent`, `destructive`, and related component tokens. If direct scale access is needed, use Radix variables such as `var(--slate-2)`, `var(--slate-11)`, `var(--lime-9)`, or `var(--red-11)` instead of hard-coded gray hex values.

The app uses Slate as the neutral base. Global appearance settings can shift the Slate hue through `src/desktop/renderer/src/lib/appearance-theme.ts`, so components should keep depending on Slate tokens for hue changes to apply consistently.

Default surface roles:

- App shell background: `var(--slate-3)` with a transparent Electron window and continuous rounded outer shell.
- Main detail surface: white.
- Soft working panels, setup cards, metric cards, chat input, and settings sections: `var(--slate-2)`.
- Hover or selected soft surfaces: `var(--slate-3)` or white depending on surrounding contrast.
- Dividers, tracks, weak borders: `var(--slate-4)` through `var(--slate-6)`.
- Primary text: `text-foreground` or `var(--slate-12)`.
- Secondary text, paths, hints, counts: `text-muted-foreground` or `var(--slate-11)`.

Status color is functional and small:

- Lime: running, ready, success, completed, current step.
- Amber: waiting, warning, attention, restart-required hints.
- Red: error, destructive action, failed runtime, invalid credential.
- Slate: stopped, neutral, unavailable, historical data.

Do not expand Lime, Amber, or Red into large brand backgrounds. Use them for dots, badges, small icons, progress bars, subtle alert pills, and focused state markers.

Dark tokens exist and some components have `.dark` overrides, but dark mode is not a finished product capability. New UI may be compatible with `.dark`; do not present dark mode as complete unless the product state changes.

## Typography

Use the global font stack from `styles.css`: Inter first, then Apple/system UI fonts and Chinese system fallbacks. Do not introduce new body fonts.

The supported text scale is deliberately narrow:

- `text-xs`: labels, hints, paths, timestamps, counts, compact badges.
- `text-sm`: default UI body, form controls, list rows, chat body.
- `text-base`: section titles and emphasized body text.
- `text-lg`: compact metrics or local emphasis.
- `text-xl`: page/detail titles such as agent names and settings titles.
- `text-2xl`: rare major metrics.

All text uses `letter-spacing: 0`. Do not use viewport-based font sizes or negative letter spacing. Keep headings proportional to their container: compact panels use compact headings, not display typography.

Common patterns:

- Detail/page title: `text-xl font-semibold` or `text-xl font-bold`.
- Section title: `text-base font-semibold leading-snug`.
- Card subtitle or hint: `text-xs` or `text-sm text-muted-foreground`.
- Form label: `text-xs font-medium text-muted-foreground`.
- Metric label: `text-xs font-medium uppercase text-muted-foreground`.
- Metric value: `font-bold tabular-nums`, usually `text-sm` through `text-2xl`.
- Logs and paths: monospace, around `11px`, with truncation or scroll behavior.

Avoid dense stacks of bold text. Usually only the title or the primary metric in a surface should be visually heavy.

## Shape And Surface

Pie uses soft continuous corners. The key CSS custom properties are:

- `--control-radius: 18px`
- `--control-menu-radius: calc(var(--control-radius) + 4px)`
- `--control-item-radius: calc(var(--control-radius) - 4px)`
- `--app-shell-radius: 48px`
- `--app-shell-gap: 6px`
- `--agent-detail-radius: calc(var(--app-shell-radius) - var(--app-shell-gap))`

Use `pie-smooth-corner` where a surface follows the app's squircle language. Use `app-continuous-corner`, `agent-detail-corner`, `app-shell-surface`, and `agent-detail-surface` for the main shell and detail pane only.

Current surface hierarchy:

- Outer app: transparent window clipped to a 48px continuous corner shell.
- Sidebar: transparent background with selected agent pill on white.
- Detail pane: white, clipped by `--agent-detail-radius`.
- Working panels: `var(--slate-2)` with 24px to 42px radii, chosen by density and scale.
- Repeated items: individual rounded rows or cards, usually white or `var(--slate-2)`.
- Dialogs/popovers: focused floating working surfaces with subtle ring/shadow.

Do not put UI cards inside other cards unless the inner surface is a real nested control group, such as an install step list inside a runtime diagnostic panel. Page sections should be full-width regions or unframed constrained layouts, not decorative floating cards.

## Layout

The desktop app uses a stable two-pane working layout:

- Sidebar width: `260px`.
- Sidebar item height: `72px`.
- Detail headers: `72px` high with a drag region and a compact close/action area.
- Detail pane content: scroll inside the pane, not the whole window.
- Primary horizontal page padding in detail views: `px-7`; dense tab content can use tighter padding such as `px-3 pb-4`.

Prefer stable dimensions for controls, counters, tabs, list rows, metric cards, QR panels, charts, logs, and chat input. Loading states should reserve space with fixed-height placeholders, skeletons, or spinners. Text must not overlap nearby controls; use `min-w-0`, `truncate`, wrapping, or scroll regions for long names, paths, tokens, and log lines.

The app is a repeated-use tool. Favor compact, scannable grouping over editorial layout. Empty states can be warm and simple, but should still present the next useful action directly.

## Components

Source-owned primitives live in `src/desktop/renderer/src/components/ui/`.

Buttons:

- Default button: 36px tall (`h-9`), rounded pill/4xl, Slate primary background.
- Large button: 40px (`h-10`) for primary setup or dialog actions.
- Small button: 28px (`h-7`) for dense management actions.
- Icon buttons: 24px, 32px, 36px, or 40px depending on context.
- Focus ring: 3px ring using `ring/50`.
- Active states should be small press feedback: `translate-y-px` or `scale(0.96)` where already established.

Use icon-only buttons for familiar commands such as close, settings, docs, reveal folder, play/start, pause, restart, delete, upload, scroll, and retry. Add `aria-label` and wrap unfamiliar or icon-only controls with `AceternityTooltip`.

Inputs and selects:

- Default height: 40px.
- Radius: `var(--control-radius)`.
- Surface: white by default; setup flows may use `var(--slate-2)` through `controlSurfaceClass`.
- Hover border: `var(--slate-7)`.
- Focus: 3px semantic ring.
- Select menus use `var(--control-menu-radius)` and items use `var(--control-item-radius)`.

Checkboxes:

- Size: 16px.
- Radius: 6px.
- Checked state uses primary Slate, not a bright accent.

Tabs:

- Default variant: soft rounded segmented control on `bg-muted`.
- Line variant: transparent list with a Lime animated indicator.
- The active indicator uses spring motion and must track tab size/position without layout shift.

Dialogs and popovers:

- Dialog overlay is dark with light blur.
- Dialog content is rounded 4xl, max width around `sm:max-w-md` unless the workflow needs a custom size.
- Popovers are work surfaces for editing avatar/name, settings choices, channel setup, and compact menus.
- Copy should be direct and operational.

Tooltips:

- `AceternityTooltip` is the current shared tooltip pattern.
- It is portal-rendered, black, compact, animated with small spring motion, and should be used for icon-only or ambiguous controls.
- Keep tooltip content short; avoid paragraphs.

Metrics and charts:

- Use `CompactMetric` and `UsageMetric` from shared components.
- Labels are uppercase `text-xs`; values use `tabular-nums`.
- Resource and usage charts should stay low contrast and Slate-based unless communicating status.

Logs and terminal surfaces:

- Runtime logs may use dark terminal surfaces such as `bg-slate-950`.
- Stdout/success can use Lime, stderr/errors Red, system lines muted Slate.
- Preserve monospace readability and horizontal overflow behavior.

## Iconography

Current desktop iconography is mixed but intentional by area:

- `solar-icon-set` is used for many app and agent affordances.
- Hugeicons is used in several Base UI primitives and close/check controls.
- Lucide is present in chat/status areas where already used.

For new product surfaces, prefer the icon family already used nearby. Do not mix icon families inside the same tight control group unless an existing component already does. Icons in buttons should be 16px by default, 20px for close or prominent action controls, and larger only for empty states or avatar-like visuals.

Use `AppIcon` when rendering Solar icons so sizing and behavior stay consistent.

## Motion

Use motion to preserve orientation and explain state changes, not as decoration.

Current patterns:

- Sidebar selected item: spring position transition.
- Sidebar list entry: slight fade/y/blur on enter and exit.
- Detail pane switch: short fade/scale/blur transition with `AnimatePresence mode="wait"`.
- Tabs line indicator: spring position and size transition.
- Tooltips: small spring scale/y transition.
- Resource bars and progress tracks: width transition around 300ms.
- Buttons: subtle hover color and press movement or scale.

Keep transitions short and subtle. Avoid motion that delays normal operation or causes content to jump. Respect stable dimensions before animating content.

## Agent Product Surfaces

Agent sidebar:

- Shows avatar, name, formatted subtitle, and one compact runtime/status mark.
- Selected row is a 72px white pill with very subtle shadow.
- Runtime tooltip can include lifecycle label and work directory.
- Create is the primary text button at the bottom; docs/settings are icon buttons.

Agent header:

- Agent identity is editable through a popover opened from the name/avatar pill.
- Primary runtime actions are icon-led: start, pause, restart config, reveal folder, delete.
- Runtime unavailable, credential invalidated, and restart-needed states use small functional pills, not large banners.

Agent detail tabs:

- Chat, overview, model/config, logs, and related panels should keep their own scroll regions.
- Overview metrics are compact and performance-conscious; do not load expensive metrics until the overview tab is active.
- Skills/source paths should show grouped source, existence state, and folder-open affordance. Do not design this as a marketplace or plugin system.
- System prompt display applies only where the harness supports it.

Create agent flow:

- This is a focused wizard, not a landing page.
- Steps include config, identity, auth/credentials, model, and runtime diagnostics as needed.
- Harness choices currently include OpenClaw, Hermes, Codex, Pi, and Ousia. Default new agent behavior belongs to product/runtime logic, not this visual document.
- Channel choices currently exposed in normal create flow are Feishu, WeChat, Discord, and DingTalk.
- Runtime diagnostics for Codex/Hermes/OpenClaw must clearly distinguish ready, missing, login required, upgrade required, and install in progress.
- Install steps should stay compact and tail-truncated.

Settings:

- Settings are grouped into rounded `var(--slate-2)` sections.
- General settings use select controls.
- Binary lifecycle settings use checkbox/toggle-style rows.
- Appearance currently exposes Slate hue adjustment through a compact hue slider. Do not imply the whole theme system is finished beyond what the UI actually supports.
- Managed runtime rows show install status with a small dot and action buttons.

Chat:

- Chat is a working conversation panel, not a public chat product surface.
- User/assistant bubbles should stay bounded around `max-w-[82%]`.
- Tool and thinking status should be compact, expandable where needed, and visually quieter than assistant content.
- Markdown must wrap long content with `overflow-wrap: anywhere`; code blocks must scroll horizontally inside their container.

## Accessibility And Interaction

Every icon-only button needs an `aria-label`; add a tooltip when the meaning is not obvious. Inputs, selects, and checkboxes should keep visible focus rings. Destructive actions require confirmation where data or profile state is removed.

The Electron shell uses draggable regions. Interactive controls inside drag regions must include `no-drag`. New header controls should be checked for drag/click behavior.

Use familiar controls for common input types:

- Swatches or sliders for color-like settings.
- Segmented/tabs for peer modes.
- Checkbox or toggle rows for binary settings.
- Selects/menus for option sets.
- Numeric inputs, sliders, or steppers for numeric values.

## Content Rules

Write direct operational copy. Prefer concrete labels like "Runtime logs", "Work directory", "Install OpenClaw", or "Restart to apply" over explanatory marketing language.

Do not claim planned capabilities are stable. In particular:

- Pi/Ousia `workDir` is a workspace policy/default directory, not a security sandbox.
- Codex permission/plan approval over IM is not complete.
- Ousia scheduled tasks and distillation remain prototype-level.
- Slack/Telegram are developer-mode/support-in-progress surfaces, not normal stable channels.
- Dark mode is not a complete product capability.

Feishu replies and IM-facing content should avoid Markdown tables. Use paragraphs or ordered lists.

## Anti-Patterns

Avoid these by default:

- Marketing-page hero sections inside the desktop app.
- Decorative gradient backgrounds, blobs, or orbs.
- Large atmospheric illustrations with no operational value.
- One-note palettes dominated by a single hue family.
- New gray hex values when Slate or semantic tokens exist.
- High-saturation brand surfaces.
- Dense stacks of bold text.
- Viewport-scaled typography.
- Negative letter spacing.
- Nested cards used only for decoration.
- Text that overlaps controls, icons, or neighboring content.
- Layout that changes size on hover, loading, or live data updates.
- Describing prototype or planned runtime behavior as already stable.
