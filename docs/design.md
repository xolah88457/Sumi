# Design notes

Sumi Paper: warm paper, ink and one muted-navy accent, set in a single serif. It
shares its vocabulary with the owner's other sites. The app is **light-first** and
follows the operating system until the user picks a theme (see Theme below). Tokens
live in `apps/web/src/app/globals.css`; charts resolve them at runtime
(`components/charts/tokens.ts`) so Recharts SVG props use the same theme values as
the rest of the interface.

## Principles

- One serif voice, hairlines instead of boxes, pills for actions, little ornament.
- Depth comes from 1px `--border` lines and surface steps (paper, ivory, sand), never
  shadows. Only floating layers (menus, popovers, tooltips, dialogs) use `--shadow-pop`.
- Motion is quiet and short. Hover and focus changes are colour or filter shifts.
- Hit targets are 40px by default and 44px on coarse pointers.

## Tokens

Keep the shadcn names so existing `bg-card` / `text-muted-foreground` utilities work;
the owner's names are exposed as aliases (`bg-paper`, `bg-ivory`, `bg-sand`).

| token                            | light     | dark      | role                                    |
| -------------------------------- | --------- | --------- | --------------------------------------- |
| `--background` (paper)           | `#fbfaf6` | `#171512` | page background                         |
| `--card`, `--popover` (ivory)    | `#fefdfb` | `#201d19` | raised surfaces, inputs, dialogs        |
| `--secondary`, `--accent` (sand) | `#ebe9e1` | `#2a2722` | quiet fill: active pill, hover, banners |
| `--muted`                        | `#f2f0e8` | `#24211d` | hover rows between paper and sand       |
| `--foreground`                   | `#363433` | `#ebe7dc` | text                                    |
| `--muted-foreground`             | `#6b6a64` | `#a8a499` | secondary text                          |
| `--border`, `--input`            | `#dcd9cd` | `#36322b` | hairlines                               |
| `--primary`, `--brand`, `--ring` | `#3a4b7c` | `#a3b2dd` | the single accent                       |

Dark is a warm near-black brown, and surfaces step up in lightness
(paper < ivory < sand). `--muted-foreground-on-sand` is a slightly darker muted ink
applied automatically to muted text inside `.bg-secondary` / `.bg-accent`, because
`#6b6a64` on sand is only 4.46:1.

## Shape

Cards, dialogs and popovers use `--radius` (14px, `rounded-xl`). Inputs and selects use
8px (`rounded-md`, `--radius-control`). Badges use 6px (`rounded-sm`). Buttons, tabs
and filter chips are pills (`rounded-full`, `--radius-pill`).

## Type

- Family: **Charis SIL** (SIL Open Font License 1.1), bundled in `app/fonts/` and loaded
  with `next/font/local`, so nothing is fetched at runtime. Stack:
  `"Charis SIL", Charter, "Bitstream Charter", Georgia, serif`. Licence text ships in
  `app/fonts/OFL-CharisSIL.txt` and `public/licenses/CharisSIL-OFL.txt`; it is listed in
  `desktop/THIRD-PARTY-NOTICES.md`.
- Headings are weight 400 with tight tracking; hierarchy comes from size. Buttons and
  active nav are 500.
- Figures use `.tnum`: the same serif with tabular lining numerals (Charis digits are
  fixed width). `font-mono` is for eyebrows, trade IDs and timestamps only.
- Scale tokens (`--type-xs` 13, `sm` 15, `md` 18, `lg` 21, `xl` 26, `2xl` 32, `d2` 44)
  are plain CSS variables and deliberately do not remap Tailwind's `text-*` sizes.
- Motion tokens: `--ease`, `--dur-fast` 120ms, `--dur-med` 180ms, `--dur-slow` 320ms.

## Theme

Light is the base `:root`; dark is the `.dark` class on `<html>`. The preference lives in
`localStorage["journal-theme-v1"]` as `"light"` or `"dark"`. With nothing stored the app
follows `prefers-color-scheme`, live, until the user picks one in the Appearance menu
(Light, Dark or System; System clears the stored value). A pre-paint script in
`lib/theme.ts` sets the class before first paint; if storage or `matchMedia` is
unavailable it falls back to light. The desktop window paints
`#fbfaf6` (or `#171512` when the OS is dark) behind the web view to avoid a flash.

## Components

`components/ui` holds the primitives (button, input, select, card, badge, tabs, table,
dialog, dropdown, tooltip, calendar, skeleton). Notes:

- `Card` has `variant="flat"` (top hairline, no box) for strips.
- `Badge` `profit` / `loss` chips repeat the state in the border: solid for win, dashed
  for loss.
- `PageHead` (eyebrow, h1, lede, actions), `KpiStrip` (hairline metric strip) and
  `EmptyState` (dashed box with one action) are the building blocks for page layouts.

## P&L color is never load-bearing

Trader convention demands green profit / red loss, and green/red is the classic
red-green colorblindness trap (validated: the pair fails CVD separation with ΔE ≈ 4,
far under the ≥ 8 target). The convention stays, so the design compensates by making
color pure reinforcement:

- Every P&L value renders as **signed text** (`+$171.00` / `−$102.50`) in ink tokens
- Bars grow from a **zero baseline**: direction is geometry
- Win/loss ship as **text chips** (`WIN` / `LOSS`) with a solid or dashed border, never
  colored dots alone
- Calendar cells print the number and trade count; the background tint scales with
  **magnitude** (lightness survives CVD), while sign lives in the printed number
- Markers differ by **shape and position** rather than color alone

## Palette

Categorical slots (`--series-1…8`), chart chrome, and surfaces follow a validated
8-slot palette with fixed assignment order (never cycled; ≥ 4 simultaneous series fold
to "Other"). Sequential encodings are single-hue lightness ramps. One value axis per
pane, never dual-axis.
