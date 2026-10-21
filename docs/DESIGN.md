# Design System

The product's visual language mirrors **lio.ai** — fitting, since both products serve procurement. Design tokens were extracted from <https://lio.ai> with the `designlang` MCP on 2026-10-21 and adapted below.

- Machine-readable tokens: [design/tokens.json](../design/tokens.json) (W3C DTCG format)
- Ready-to-import CSS variables: [design/tokens.css](../design/tokens.css) (light + dark mode)
- Accessibility score of the extracted system: **100** — keep it that way (the measured pairs below are all AAA; any new color pairing must be checked against them).

## Design intent

lio.ai reads as: a **flat**, high-contrast editorial system — white canvas (78% of painted area), black typography (21%), a single light-blue accent (`#bbddff`), light-weight serif display type, pill-shaped buttons, hairline borders instead of heavy shadows. Our app should read the same way: calm, document-like procurement software, not a dashboard crammed with chrome.

**Material: flat.** Depth comes from background shifts (`#ffffff` → `#f0f0f0`) and the inset hairline shadow — not from drop shadows or glass effects.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Primary / action | `#bbddff` | Primary buttons, focus rings, active states, highlighted rows |
| Page surface | `#ffffff` | App canvas |
| Raised surface | `#f0f0f0` | Cards, table headers, input backgrounds on tint |
| Inverted surface | `#010203` | Header band, primary CTA on marketing-style moments, footer |
| Text body | `#000000` (`#1c1c1c` muted) | All body copy |
| Link | `#0000ee` | Inline links (classic link blue, as on lio.ai) |
| Min-contrast border | `#767676` | Input borders, subtle dividers |

Primary ramp for status/data states: `--color-primary-50 … 950` (`#e4f8ff` → `#12202d`). Neutral ramp: `--color-neutral-50 … 950`.

**Measured, AAA-validated pairs** (re-use these; do not invent new fg/bg combos without checking):

| Role | bg | fg | Contrast |
|------|----|----|----------|
| surface.page | `#ffffff` | `#000000` | 21:1 |
| surface.raised | `#f0f0f0` | `#000000` | 18.4:1 |
| action.primary | `#bbddff` | `#000000` | 14.9:1 |

**Status colors** (nothing in lio.ai's palette suggests loud status colors — keep them in-system):

| Status | Treatment |
|--------|-----------|
| Open | neutral outline pill — transparent bg, `1px` `#767676` border, black text |
| In Progress | tint pill — `--color-primary-100` bg, black text |
| Closed | inverted pill — `#1c1c1c` bg, white text |

## Typography

lio.ai's families (Reckless Standard, STK Bureau Sans, ABC Diatype) are **licensed commercial fonts** and must not be committed to the repo. Substitutions keep the same character:

| lio.ai family | Our substitute (Google Fonts) | Role |
|---|---|---|
| Reckless Standard Light (serif, weight 200) | **Newsreader** (200–300) | Display headings, page titles |
| STK Bureau Sans (grotesque) | **Inter** | UI: labels, inputs, buttons, tables, body |
| Reckless Standard Light Italic | Newsreader italic | Occasional emphasis, quotes |

Named scale (ratio 1.125, "major second"; weights are part of the look — the lightness is the brand):

| Role | Size | Weight | Line height | Use |
|------|------|--------|-------------|-----|
| h1 | 64px | 200 | 1.1 | Landing / empty-state hero |
| title-1 | 52px | 200 | 1.1 | Major section titles |
| h2 | 44px | 200 | 1.1 | Section headings |
| h3 | 36px | 200 | 1.1 | Card/form titles |
| body-sm | 30px | 200 | 1.4 | Standfirst / intro copy |
| h5 | 22px | 300 | 1.1 | Sub-headings |
| h6 | 18px | 300 | 1.1 | Minor headings |
| micro | 16px | 400 | 1.3 | Default body in content areas |
| ui | 14px | 300 | 1.4 | Form controls (lio.ai input size) |
| sm | 12px | 400 | 1.3 | Buttons, table meta, status pills, captions |

Headings are Title Case and sentence-balanced; tracking runs slightly negative at small sizes (`-0.56px` at 14px), normal at display sizes.

## Layout

- Content column **1280px**, gutters **80px** desktop (16px minimum at phone width), full-bleed shell.
- Section rhythm: **80px** vertical padding between major sections.
- Spacing scale: 1 / 8 / 10 / 15 / 20 / 28 / 38 / 44 / 61 / 80px.
- App surfaces (form, tables) can tighten the rhythm to 20–28px between related groups — the 80px rhythm is for page-level separation.

## Shape & elevation

- Radius scale: **2px** (inputs, default controls), **6px** (chips), **20px** (cards/panels), **50px** (pill buttons — lio.ai's signature button shape), 99px (fully round avatars/badges).
- Shadows: `--shadow-inset` (hairline + faint shadow, cards) and `--shadow-elevated` (`rgba(0,0,0,0.12) 0 3px 5px`, modals/popovers only). Nothing above that.

## Components

Derived from lio.ai's detected component styles, adapted to askLio's surfaces:

### Buttons

| Variant | Spec |
|---------|------|
| Primary (pill) | `#bbddff` bg, black text, radius 50px, 12px/400, height ≥ 40px for app use |
| Secondary (pill) | `rgba(0,0,0,0.2)` bg, black text, radius 40px (destructive/quiet on dark bands) |
| Dark band CTA | `#010203` bg, white text, radius 50px |
| Ghost (on dark) | transparent, `rgba(255,255,255,0.5)` text, 14px/300 |
| Danger/quiet variant (app-native) | transparent bg, 1px `#767676` border, black text, radius 50px |

### Inputs

lio.ai inputs are **flat, borderless-on-dark or minimal-border-on-light**: white bg, `#767676` border, radius 2px, 14px/300 black text. For our forms:

- Label above field, 12px/400, black; field white bg, `1px` `#767676` border, radius 2px.
- Focus: `2px` `#bbddff` ring, border unchanged.
- Error: `1px` `#c03535`-scale border (the one place out-of-system color is allowed — errors must be unambiguous) with the message in 12px/400 below the field.
- Disabled: `#f0f0f0` bg, `#767676` text.

### Cards / request list

- Radius 20px, `#ffffff` bg, `--shadow-inset`; on `#f0f0f0` sections, invert (white cards on grey).
- Order lines render as a hairline-bordered table: 12px/400 header in `#767676`, 14px/300 values.
- Status pill per [Status colors](#color).

### Navigation

Minimal top band, like lio.ai: flat, padding 20px vertical, wordmark left, text links 14px/300, current view indicated by weight/underline rather than background.

## Do's and Don'ts (from the lio.ai analysis, adopted)

**Do**
- Keep the material flat: background shifts and hairlines over shadows.
- Keep ≤ 2 font families (Newsreader + Inter), weights doing the hierarchy work.
- Write headings in Title Case, balanced length; address the user as "you".
- Use verbs like "Create request", "Submit" in CTAs.
- Check every color pair against the AAA pairs table.

**Don't**
- Don't import lio.ai's licensed fonts (Reckless Standard, STK Bureau Sans) into the repo.
- Don't stack drop shadows or gradients — one shadow level only (`--shadow-elevated`).
- Don't add a second accent color; the palette is white / black / `#bbddff`.
- Don't exceed ~80 characters per line in body copy.

## Dark mode

Dark tokens are already defined in [design/tokens.css](../design/tokens.css): page `#010203`, raised `#1c1c1c`, text white, primary stays `#bbddff` (it holds AAA on dark). Ship both; the app should support `prefers-color-scheme` plus an explicit `data-theme` override.