---
name: clean-ui-standard
description: The standard for building and reviewing UI code and visual/UX design across web, mobile, and desktop. Covers component responsibility, props/API design, semantic markup, design tokens, state/data flow, async states, accessibility primitives, effect hygiene, design systems, color/contrast, typography, spacing, elevation, motion, touch targets, dark mode, navigation, empty/loading/error states, forms, gestures, iconography, i18n, responsive layout, and micro-interactions. Use when writing or reviewing components, screens, markup, styles, SwiftUI/Compose/Flutter view code, a11y, dark mode, forms, motion, focus order, or alt text. It is also the rubric for reviewing UI code.
---

# Clean UI Standard

The one standard for UI work — **how the component is built** and **how it looks/behaves** — across web, mobile, and desktop. Apply as default unless the project's design system overrides; on conflict the project's tokens/rules win, and where it's silent this is the standard. The code counterpart to [[clean-code-standard]]. Name the tradeoff explicitly when you skip a default.

Two halves: **Part A — UI code** (engineering discipline) and **Part B — Visual & UX design** (the design playbook). Run the pre-ship checklist before shipping.

---

# Part A — UI code

## A1. Component structure & responsibility

**Do**
- One component answers one question: "what does this render?" Split when it renders multiple unrelated things.
- Separate logic from presentation: data-fetching/state in hooks/view-models/containers; markup in a pure, dumb view that takes props.
- Keep `render`/`build`/template pure — no side effects, no fetches, no mutation while rendering.
- Extract a child component at a real seam (a repeated row, a self-contained section), not mechanically at a line count.

**Don't**
- God components: a 600-line screen mixing fetch, business rules, and 8 sub-sections — split into composed children.
- Deeply nested inline JSX/markup (>3–4 levels) that hides structure — extract named children.
- `Manager`/`Wrapper`/`Helper` component names — name by what it renders (`UserCard`, `CheckoutSummary`).

## A2. Props & component API

**Do**
- Minimal, intentional props. Each prop earns its place; derive what you can instead of passing it.
- Composition over configuration: pass `children`/slots rather than a `variant`-explosion of booleans.
- Booleans are questions (`isDisabled`, `hasError`); collapse mutually-exclusive booleans into one `status`/`variant` union.
- Be explicit about controlled vs uncontrolled; document the single source of truth for each input.

**Don't**
- Boolean soup (`isPrimary` + `isSecondary` + `isDanger`) — use one `variant: 'primary' | 'secondary' | 'danger'`.
- Passing 12 props where `children` + 2 props would do.
- Leaking internals through props (`innerRef2`, `_internalState`) — fix the seam instead.
- Spreading `{...props}` blindly onto a DOM node when you don't control the shape.

## A3. Markup semantics

**Do**
- Real elements for real roles: `<button>` for actions, `<a>` for navigation, `<ul>/<li>` for lists, `<nav>/<main>/<header>`, `<label for>` tied to inputs.
- One logical `<h1>` per view; headings descend without skipping levels.
- Native control first; only build a custom one when the native one truly can't do the job.

**Don't**
- `<div onClick>` as a button — loses focus, keyboard, role, and Enter/Space for free.
- Div soup where a semantic element exists. Reach for `role="..."` only when no native element fits.
- Placeholder-as-label, or an input with no associated `<label>`.

## A4. Styling discipline

**Do**
- Design tokens / theme variables only for color, spacing, radius, type, elevation — never raw literals in components (roles in §B2–B5).
- Spacing from the scale (theme/utility constants), not magic pixel numbers sprinkled inline.
- Keep styles co-located with the component and consistent in mechanism (one of: utility classes / CSS modules / styled — don't mix three in one file).
- Theme-driven dark mode: style from semantic tokens so dark mode falls out for free.

**Don't**
- Hardcoded `#3b82f6`, `padding: 13px`, `z-index: 9999`, or inline `style={{color:'red'}}` for theme-able values.
- `!important` to win specificity — fix the cascade/selector instead.
- One-off magic-number breakpoints/spacing that don't match the system.
- Re-deriving the same computed style in five places — extract a token or class.

## A5. State & data flow

**Do**
- Colocate state with the component that uses it; lift only as high as the lowest common owner.
- Derive, don't duplicate: compute from props/state during render rather than mirroring into another state slot.
- Stable, identity-based `key`s on lists (entity id), so reconciliation and focus survive reorders.
- Reach for context / composition / a store when prop-drilling passes a value through 3+ uninterested layers.

**Don't**
- Index-as-key on reorderable/filterable lists — causes wrong-row state and input bugs.
- Mirrored state synced via effects (`useEffect(() => setFullName(first+last))`) — derive it inline.
- Prop-drilling the same value through many layers that only forward it.
- Mutating props or state in place; produce new values (respect the framework's immutability contract).

## A6. Render every state, with guard clauses

**Do**
- Handle all four async states explicitly in code — `loading` / `empty` / `error` / `content` — for every async surface (their UX in §B11).
- Guard-clause the states: return the loading/error/empty branch early, let the content path read flat — no deep nested ternaries.
- Keep conditional rendering legible: extract a `renderX()`/sub-component when a ternary grows past one condition.

**Don't**
- Render content assuming data is present (`data.map` when `data` can be `undefined`) — the empty/loading case is a code branch, not an afterthought.
- Nested ternary pyramids in JSX — replace with early returns or a small status `switch`.
- Swallow fetch errors into a blank screen; surface an error branch.

## A7. Accessibility, baked into the code

**Do**
- Pair every pointer handler with a keyboard path: prefer a real `<button>`/`<a>`; if custom, add role + `tabindex` + key handler.
- Give every icon-only control an accessible name (`aria-label`/`contentDescription`/`accessibilityLabel`); mark decorative images empty/null.
- Manage focus on route change, dialog open/close, and async content swaps; keep a visible focus ring.
- Use `aria-*` only to fill gaps native semantics can't; reflect real state (`aria-expanded`, `aria-busy`, `aria-invalid`).

**Don't**
- Ship a click target with no keyboard or screen-reader affordance.
- Sprinkle `aria-*` onto already-semantic elements (redundant `role="button"` on `<button>`).
- Trap or lose focus in modals/menus.

> Code-level a11y is non-negotiable; the contrast and target-size *values* to grade against are in §B6 and §B8.

## A8. Effects & lifecycle hygiene

**Do**
- Every subscription/listener/timer/observer has matching cleanup on unmount.
- Effect dependency lists are honest and complete; if an effect "shouldn't re-run", fix the dependency, don't lie to the linter.
- Dispose controllers/streams/animation handles (Flutter `dispose`, RxJS unsubscribe, AbortController on fetch).
- Run data fetching through the framework's data layer (loader/query hook), not ad-hoc in a render effect that waterfalls.

**Don't**
- `useEffect`/`onMounted` for state you can derive during render (see §A5).
- Leak listeners, intervals, or subscriptions across remounts.
- Sequential dependent fetches that block paint when they could parallelize or stream.
- Mutate the DOM directly around a framework that owns it, except through the sanctioned ref/escape hatch.

---

# Part B — Visual & UX design

Platform-agnostic design rules for UI a designer would be proud of. Apply as default unless the project's design system overrides.

## B1. Design principles
- One primary action per screen. Secondary = outlined/text/ghost buttons.
- Progressive disclosure: hide complexity behind "Advanced". Don't show 11 fields when 4 cover 90%.
- Feedback within 100ms: tap → ripple, submit → spinner, error → inline message.
- Destructive actions need undo snackbar (≥5s) OR confirmation — not both every time.
- Consistency > novelty: back/close and primary actions live in predictable spots.

## B2. Color system
- Theme tokens only — never raw hex in components. Hardcoded values break dark mode.
- Core roles: `primary/onPrimary/primaryContainer`, `secondary`, `tertiary`, `error`, `surface`, `surfaceVariant`, surface containers (low → highest), `outline/outlineVariant`.
- **Contrast (WCAG 2.2)**: body text ≥ 4.5:1; large text (18px+ or 14px+ bold) ≥ 3:1; UI components/icons/borders ≥ 3:1.
- Dark mode: ~gray-95 text on gray-10 background — never pure white on pure black.
- Semantic tokens for success/warning/status states — never inline. Respect `prefers-color-scheme`.

## B3. Typography
- Type-scale roles: `displayLarge/Medium/Small`, `headlineLarge/Medium/Small`, `titleLarge/Medium/Small`, `bodyLarge/Medium/Small`, `labelLarge/Medium/Small`.
- Screen title: `headlineSmall`/`titleLarge`. Section: `titleMedium`. Body: `bodyMedium`. Button/chip: `labelLarge`. Caption: `bodySmall`/`labelSmall`.
- **Never** < 3 font sizes per view or > 5 per app. **Min 12px**; body 14–16px. Support scaling to 200%. Test at 1.3× and 1.5×.
- No center-aligned paragraphs > 2 lines. RTL/complex scripts (Arabic, Hebrew, Thai, Devanagari): line-height ≥ 1.5–1.6.

## B4. Spacing & grid
- **8px baseline grid.** Multiples of 4 only: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.
- **Screen padding**: 16px phones; 24px+ tablets; 32–64px desktop. Content max-width 640–1280px, lines ≤ ~80 chars.
- Card inner: 16px. Card-to-card: 8px tight / 12px breathing. Sections: 24px apart; 32px before a CTA. Related items: 8px; unrelated: 16px+.

## B5. Elevation & shape
- **Elevation levels (dp)**: 0 flat · 1 cards at rest · 3 raised card/menu · 6 FAB/dialog · 8 nav drawer · 12 modal sheet.
- Prefer tonal elevation over heavy drop shadows. Dark mode: higher surfaces = lighter. Web: subtle `box-shadow` only.
- **Shape scale**: extraSmall 4px · small 8px · medium 12px · large 16px · extraLarge 28px. Cards = medium; chips = small; FAB = large; dialogs = extraLarge. Consistent per component type.

## B6. Touch / click targets
- **Min tap target**: 44×44px (Apple) / 48×48dp (Material) / 24px CSS (WCAG 2.5.8). Aim 44–48px. Visual icon can be 16–24px; hit area is still 44–48px.
- **8px min gap** between adjacent tap targets. Primary action: bottom 1/3 on mobile. Never destructive adjacent to "Cancel" without visual separation.

## B7. Motion & haptics
- **Durations**: 100ms ripple/hover · 150ms press · 200ms small enter/exit · 300ms container transform · 400ms full-screen nav. >500ms sluggish.
- Easing: ease-in-out standard; ease-out entering; ease-in exiting. Linear only for progress bars. Never block input. Respect `prefers-reduced-motion`.
- Haptics (mobile): long-press/confirm = short pulse; success = two short; error = one long. Never on scroll. Web `navigator.vibrate()` — generally avoid.

## B8. Accessibility (a11y) — non-negotiable
- Every image/icon/icon button: accessible label. Decorative: explicit empty/null label.
- Composite tappable rows: merge semantics so screen reader reads one label.
- Keyboard (web/desktop): Tab to every element; visible focus ring; `Esc` closes; `Enter`/`Space` activates; arrow keys for menus/lists.
- Color never the only signal: error = icon + label + "Error:" prefix. Live regions polite by default; assertive urgent only.
- State announcements: `aria-expanded`, `stateDescription`, `accessibilityValue`. Test with VoiceOver/TalkBack/NVDA — 90% of a11y bugs surface in 60s.

## B9. Dark mode
- Both modes first-class: every screen needs light + dark preview. Fix dark before merging.
- No pure white on pure black. Higher elevation = lighter surface in dark mode. Follow system; offer "Light / Dark / Auto" in settings.

## B10. Navigation patterns
- **Bottom nav (mobile) / sidebar (desktop)**: 3–5 destinations. Never > 5.
- Top app bar: title + back + 1–2 icons + overflow. System back = undo last navigation (never submit/confirm).
- Bottom sheet: contextual actions / forms < 5 fields. Dialog: destructive confirm / yes-no. Full-screen modal: flows > 5 fields.
- Snackbars (action-bearing) for transient feedback. Support predictive back / swipe-back (Android 13+, iOS edge).

## B11. State displays — empty / loading / error
Every async surface must handle all 4 (the code branches are §A6):
1. **Loading** — spinner <1s; **skeleton/shimmer** >1s (shapes must match content layout). Progress bar >10s.
2. **Empty** — illustration + heading + primary CTA. Never blank.
3. **Error** — icon + friendly copy + retry. No stack traces, no exception class names.
4. **Content** — actual data.

## B12. Forms
- Labels above inputs. Inline validation on blur, specific copy ("Username must be 3–64 chars, lowercase + digits").
- Correct keyboard type: `email`, `tel`, `number`, `decimal`, `password`, `search`, `url`. `Enter`/`IME Next` advances; last `Done` submits.
- Password: mask + visibility-toggle; never disable paste. Currency: right-align, thousand separators, clean digit string in state.
- Autofill hints: `autocomplete="email"`, `ContentType.EmailAddress`, `textContentType = .emailAddress`. Submit disabled until valid; explain why. Keyboard insets: push CTA up.

## B13. Lists & gestures
- **Virtualize >~10 items** (`LazyColumn`, `FlatList`, `react-window`). Stable keys. Leading icons align to top of first line.
- **Cursor-based pagination >100 items**. Swipe-to-dismiss → snackbar undo. Pull-to-refresh. Sticky headers for groups.
- Gestures: tap = primary; long-press/right-click = contextual; swipe = dismiss/reveal; drag = reorder; pinch = zoom. Every gesture needs a tap equivalent. No novel gestures.

## B14. Iconography & imagery
- One icon set + one style (filled OR outlined) app-wide. **Sizes**: 20px dense · 24px standard · 32px+ hero. Mirror direction-sensitive icons in RTL. Ship as vector.
- Image library with placeholder + error fallbacks. Lock aspect ratio (prevents CLS). `cover` crops; `contain` letterboxes; never `fill` (distorts). Lazy-load off-screen.

## B15. Content, localization & i18n
- Active voice, sentence case, specific error copy. No exclamation except celebrations. No dark patterns/confirmshaming.
- All strings in resource files. Platform plurals API. Locale-aware formatters for dates/currency. Placeholders not concatenation.
- RTL: start/end not left/right. Test in RTL pseudo-locale. **~30% string expansion** for German/French; test longest locale.

## B16. Responsive layout
- Smallest-first (360px). **Breakpoints**: 360 / 600 / 840 / 1240 / 1440.
- Safe areas: `env(safe-area-inset-*)` web; `WindowInsets` Android; `safeAreaInsets` iOS. Support both orientations.

## B17. Performance UX
- **First-paint <1s.** Show skeleton/splash immediately. **60fps = 16ms frame budget.** Virtualize, memoize, stable keys.
- **Debounce**: search 300ms; sliders 50ms. Prefetch one screen ahead. Optimistic UI with snackbar rollback.
- **30s spinner timeout** → show error. **Splash ≤ 2s** (platform native splash API).

## B18. Micro-interactions
- Confirmation pulse: scale 1.0 → 1.05 → 1.0. Stagger list entry: ~20ms between items. Success checkmark: draw-in. Number tickers: slide+fade.
- One or two moments per screen. Every element bouncing = chaos.

---

## Pre-ship checklist (the cheap-win audit)

**Code**
- [ ] No hardcoded colors / spacing / radii / z-index — tokens or scale constants only
- [ ] Actions are `<button>`, navigation is `<a>`; no `<div onClick>`
- [ ] Loading, empty, error, and content branches all exist for each async surface
- [ ] List keys are stable entity ids, never the array index on dynamic lists
- [ ] No state mirrored via effects that could be derived during render
- [ ] Components split at real seams; logic in hooks/view-models, markup stays dumb
- [ ] Props minimal; boolean explosions collapsed to a `variant`/`status` union
- [ ] Effects/subscriptions/controllers all have matching cleanup
- [ ] One styling mechanism per file; no `!important` specificity hacks

**Layout & scroll**
- [ ] Outer container scrolls if content could exceed viewport on smallest target
- [ ] Keyboard / IME doesn't cover the CTA (insets handled)
- [ ] Bottom/top padding accounts for system nav bar / home indicator / status bar / notch
- [ ] No layouts that break at 1.5× font scale on a 360px-wide viewport

**Touch / click & hit area**
- [ ] Every interactive element ≥ 44–48px on its smallest dimension; 8px min gap between targets
- [ ] Primary action in the thumb / cursor zone; hit area matches visual ripple/highlight bounds

**Visual**
- [ ] Both light AND dark previews exist and look intentional
- [ ] Text contrast ≥ 4.5:1 body, ≥ 3:1 large text and UI
- [ ] Elevation & corner radii consistent across cards / buttons / chips
- [ ] Icons all from the same set + style; direction-sensitive icons mirror in RTL

**Typography**
- [ ] Type-scale roles, not raw px/sp; ≤ 5 distinct sizes on one screen
- [ ] Left-aligned long paragraphs (not center); line height respects system defaults

**States & forms**
- [ ] Loading (skeleton if > 1s), empty (illustration + CTA), error (friendly copy + retry); no raw stack traces
- [ ] Labels above inputs; inline validation on blur with specific copy
- [ ] Correct keyboard / input type; password visibility toggle, paste allowed; autofill hints set
- [ ] Submit disabled when invalid, with supporting text explaining why

**Accessibility**
- [ ] Every icon / image has an accessible label (or explicit none for decorative)
- [ ] Composite clickable rows merge their semantics; no color-only signals
- [ ] Keyboard navigation works end-to-end with visible focus; state/value announcements on toggles/accordions/sliders
- [ ] Tested at system font scale 1.5×; screen reader read-through makes sense top-to-bottom

**Motion, content & interactions**
- [ ] Animations ≤ 400ms unless full-screen; no linear easing on UI motion; reduced-motion respected; no animation blocks input
- [ ] All strings localized; active voice, sentence case; pluralization via platform API; dates/currency locale-formatted
- [ ] Tap has ripple/highlight; destructive actions offer undo snackbar (≥ 5s); success feedback non-intrusive
- [ ] Long-press / right-click has a tap equivalent; Back / Esc goes back / closes (never submits)

---

## Anti-patterns — don't ship these

- ❌ **`<div onClick>` as a button.** Loses keyboard, focus, role — use `<button>`.
- ❌ **State mirrored through effects** that could be derived during render. Derive inline.
- ❌ **Index-as-key** on dynamic lists. Use a stable entity id.
- ❌ **Rainbow of buttons** (6 colors competing). One primary; neutrals for the rest.
- ❌ **Toasts for critical errors.** They auto-dismiss. Use snackbar with retry or a dialog.
- ❌ **Dialog-on-dialog.** Refactor the flow.
- ❌ **Infinite loading spinners** with no progress or timeout. Set 30s timeout + show error.
- ❌ **Hamburger menu on bottom-nav apps.** Pick one nav paradigm.
- ❌ **Bottom sheet taller than 90% screen.** Use full-screen modal instead.
- ❌ **Sticky header + sticky footer + FAB + bottom nav** all on one screen. Pick two.
- ❌ **Vibrate on every button.** Haptic fatigue — users disable it.
- ❌ **Locked orientation "because we only tested portrait".** Fix the layout.
- ❌ **Splash screen > 2s** on cold start. Use platform native splash API.
- ❌ **Dark patterns**: pre-checked upsells, "Cancel" disguised as secondary, confirmshaming. Don't.

---

## References

- [Material 3 design system](https://m3.material.io/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [Web.dev — UX patterns](https://web.dev/learn/)
- [Inclusive Components](https://inclusive-components.design/)
- [Refactoring UI](https://www.refactoringui.com/)
- [Nielsen Norman Group — UX research articles](https://www.nngroup.com/articles/)

When in doubt, ship the smaller, dumber component that passes the checklist.
