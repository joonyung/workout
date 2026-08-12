# Workout OS Design System

## Direction

Workout OS is an iPhone-first training utility inspired by the Apple design
analysis at https://getdesign.md/apple/design-md. It borrows the calm surface
hierarchy, system typography, single blue interaction color, restrained depth,
and frosted navigation treatment. It must still behave like a dense workout
tool, not an Apple marketing page.

The first viewport is the active workout. Visual polish must never slow down
set entry or hide the next action.

## Visual Principles

1. Use quiet neutral surfaces so weights, repetitions, RPE, and completion state
   carry the visual emphasis.
2. Use one blue for actions and focus. Reserve green, orange, and red for
   completion, caution, and destructive states.
3. Prefer full-width grouped sections and hairlines over floating dashboard
   cards and heavy shadows.
4. Keep controls at least 44px tall and reachable with one hand.
5. Use translucency only for sticky navigation and the active rest timer.
6. Do not use decorative gradients, glow effects, oversized heroes, or
   illustration-led empty states.

## Color Tokens

### Light

- Canvas: #f5f5f7
- Surface: #ffffff
- Raised surface: #fafafc
- Primary text: #1d1d1f
- Secondary text: #6e6e73
- Tertiary text: #86868b
- Separator: rgba(60, 60, 67, 0.18)
- Soft separator: rgba(60, 60, 67, 0.10)
- Action blue: #0071e3
- Action blue pressed: #0066cc
- Success: #248a3d
- Warning: #c93400
- Destructive: #d70015

### Dark

- Canvas: #000000
- Surface: #1c1c1e
- Raised surface: #2c2c2e
- Primary text: #f5f5f7
- Secondary text: #aeaeb2
- Separator: rgba(84, 84, 88, 0.65)
- Action blue: #2997ff
- Success: #30d158
- Warning: #ff9f0a
- Destructive: #ff453a

## Typography

Use the native Apple system stack:

    -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
    system-ui, sans-serif

- Page title: 34px / 700 / 1.08
- Workout title: 28px / 700 / 1.12
- Section title: 20px / 700 / 1.2
- Exercise title: 17px / 600 / 1.25
- Body and controls: 17px / 400 / 1.4
- Secondary and labels: 13px / 400-600 / 1.35
- Numeric set inputs: 17px / 600 with tabular numerals

Keep letter spacing at 0. Use weight, size, and whitespace for hierarchy.

## Shape And Depth

- Exercise and repeated item cards: 8px radius.
- Text inputs and utility controls: 8px radius.
- Primary commands and status chips: full pill where the label remains short.
- Circular icon controls: 44px square.
- Default surfaces have no drop shadow.
- Use a 1px hairline for cards and grouped sections.
- Sticky bars may use backdrop blur plus a bottom or top hairline.

## Core Components

### Top Bar

A compact, sticky, translucent bar with the current date or section title on the
left and one utility icon on the right. It must not consume more than 56px plus
safe-area inset.

### Workout Header

An unframed content block showing plan title, focus, estimated duration,
provenance, and progress. A stale plan warning appears directly below it.

### Readiness Control

A three-option segmented control for good, normal, and tired. The selected state
uses a white or raised surface and strong text, not a saturated color fill.

### Exercise Card

Each exercise is one repeated card containing:

- name, muscle group, target range, RPE, and prescribed rest;
- one concise technique cue;
- a stable grid of set number, kg, reps, RPE, and completion;
- previous performance as secondary text when available;
- compact add-set and substitution actions.

Completing a set must be the largest and most obvious row action.

The first incomplete row is the active row. Mark it with a restrained blue
surface and a leading accent so the next input target is obvious. Completed
rows use green plus a check symbol; color must never be the only signal. Show a
thin exercise-level progress track between the card header and inputs.

### Workout History

The history view is a comparison surface, not a list of filenames. Each session
summary shows working-set count, tonnage, average set RPE, and a compact muscle
distribution before expansion. Warmups never inflate working-set totals.

Expanded sessions use one stable four-column set table: set, kg, reps, and RPE.
Group tables under full-width exercise bands rather than nested cards. Keep
session RPE, set-average RPE, duration, and unrecorded values explicitly
distinct. RPE uses a colored dot plus its numeric value so meaning survives
without color.

### Rest Timer

A compact frosted bar fixed above bottom navigation while active. Show remaining
time, pause or resume, and dismiss. Starting a set uses that exercise's
prescribed rest value.

### Bottom Navigation

Use four tabs: Today, History, Progress, and Settings. Respect the iPhone bottom
safe area. Active state uses Action Blue; inactive state uses secondary text.

### Progress Charts

Use a white or dark grouped surface, thin neutral grid lines, and a restrained
multi-series palette. Always provide the current values and labels outside the
canvas so the chart is not the only source of information.

## Responsive Behavior

- Primary target: 375-430px wide iPhone screens.
- Minimum supported width: 320px.
- Keep set-entry columns stable with explicit grid tracks.
- At 760px and above, allow a centered 720px content column.
- At 1024px and above, progress and settings views may use two columns.
- Never scale text with viewport width.
- Respect env(safe-area-inset-top) and env(safe-area-inset-bottom).

## Accessibility

- Minimum touch target: 44x44px.
- Visible keyboard focus ring in Action Blue.
- Every icon-only control needs an accessible label and tooltip.
- Do not encode completion, sync state, or warnings with color alone.
- Numeric inputs use decimal or numeric input modes as appropriate.
- Respect prefers-reduced-motion and prefers-color-scheme.

## Product Copy

- Product-facing copy is concise Korean.
- Use observable language: "지난 3회 기록", "목표 RPE", "파일에 저장됨".
- Avoid medical conclusions and motivational filler.
- Codex recommendations must identify assumptions when profile, equipment, or
  workout history is incomplete.
