# DESIGN.md — Flow HTML runtime

Read this before changing the HTML player, glass controls, or iPhone preview.

## The screen is the product

The HTML remains edge-to-edge and visually untouched in Desktop mode. Editor chrome must never leak into fullscreen. The controls are a small, movable utility at the top-left, not a second application drawn over the website.

## Glass is transparency plus optical blur

Do **not** substitute a nearly opaque grey rectangle for glass. The page behind a panel must remain visibly present, but softly diffused.

- Dark HTML: near-black translucent glass (roughly 25–40% alpha), light text and **28–40px real** `backdrop-filter: blur(...) saturate(...)`. **Zero borders and zero inset hairlines.**
- Light HTML: translucent off-white glass (roughly 30–45% alpha), charcoal text, the **same real** backdrop blur. **Zero borders and zero inset hairlines.**
- The compact pill, expanded panel, selector trigger, open dropdown, selected row, and action controls must share one consistent optical system. Do not stack opaque backgrounds inside translucent containers.
- Backdrop brightness is part of readability; avoid creating a solid dark sheet to hide content. **No border, no 1px stroke, no inset border-like shadow and no hard focus ring** on runtime UI. Define the edge through soft *optical refraction*: a masked, 5px-wide perimeter with stronger backdrop blur and very low-opacity directional illumination. Feather that perimeter rather than drawing a crisp ring; leave the center visually transparent and use no `border` property.
- Context comes from the embedded page's computed background color via the existing sandbox message bridge, not the editor theme. Both theme variants need to be visibly different and tested against dark and light HTML.
- Keep **one authoritative set** of HTML runtime CSS rules. No accumulating overrides at the end of the stylesheet.

## Hierarchy and geometry

- Compact handle: about 170px wide, 39px tall, 14–16px radii, 12px text. Drag area and toggle are distinct hit targets.
- Expanded glass: about 252px wide, tight 10–12px interior spacing, 15–17px radii. Device switch, resolution, FPS, and compact actions only. No paragraphs or technical explanations.
- Custom dropdowns: optically matching glass, readable 11–12px labels, 32–36px rows, rounded 10–12px; menus float above other controls. No OS-native opaque select menu. **Hover and selection are dark black-opacity blur over dark HTML and off-white-opacity blur over light HTML. Never grey or solid selected backgrounds.**
- A dropdown menu is portaled as a sibling of the blurred panel, inside the HTML player root; it must blur the **page behind it**, not merely another already-blurred surface. Recalculate its fixed anchor position on scroll and resize.
- Icons: existing Hugeicons, 1.6–1.75 stroke; align to an optical grid. Mouse targets have `cursor: pointer`, while the drag grip uses `grab`.
- Motion: transform and opacity only, ~160–230ms with decelerating easing, spring for taps; honor `prefers-reduced-motion`. No animated blur, shadow, layout shift, or continuous decorations.
- Controls must not cover or intercept HTML beyond their small footprint. Hide remains available.

## iPhone-only light surface

When the Desktop/iPhone toggle is on **iPhone**, set only the outer player background to `#fafafa` (neutral-50) and the SVG frame/screen backing to `#f5f5f5` (neutral-100). Use the supplied SVG's light colors. This is unconditional for iPhone mode, not dependent on the HTML document's own theme. Do not recolor user HTML. **Desktop mode and every part of the top-left controls, FPS meter, dropdown, hover/tap animations and transitions must remain exactly as they were before PR #42.** No new animation or styling rules on the controls for this feature.

## iPhone: render the supplied SVG, not an invented phone

The supplied component is the specification. Render **exactly two SVG layers**, each `340 × 700` with `viewBox="0 0 340 700"`:

1. Frame path: `<rect x="9" y="9.5" width="322" height="681" rx="63" ry="63" strokeWidth="5" fill="transparent" />`. Use original dark/light stroke values (`#27272a` / `#000000`).
2. Content clipping box: left `17px`, top `17px`, width `306px`, height `667px`, `border-radius:49px`, top padding `44px`; render the **actual iframe** as its only content.
3. Island layer: `<rect x="122" y="24" width="96" height="28" rx="14" ry="14" />` (fill `#171717` / `#000000`; dark stroke `#262626`), and green camera `<circle cx="186" cy="38" r="2.8" fill="#07e00a" />`.

**No** synthetic bezel, extra circles, CSS island, faux home bar, background gradients, framed card, or decorative shadow. The whole original 340×700 artboard may scale *uniformly* to fit the window, but its interior must not stretch.

The embedded iframe has an actual **306px layout viewport** and a visible 623px content area. This is a faithful rendering of the supplied mockup, **not** a claim to emulate Safari, DPR, or an iPhone 17 Pro device size. Do not label it as a different iPhone model unless a genuine corresponding viewport is implemented.

## Implementation and release guardrails

- CSS lives in the one HTML runtime section in `src/styles.css`. Remove superseded rules rather than appending competing patches.
- Keep the HTML iframe sandbox, public routes, autosync and FPS bridge working.
- For iPhone frame preview, hide scrollbar *chrome* inside the sandboxed iframe without disabling mouse, touch or keyboard scrolling. On desktop, tint scrollbar thumbs dark over dark HTML and light over light HTML. Do not replace them with bright grey browser bars.
- Test dark and light glass variables, translucent backgrounds, **absence of any positive-width runtime border or inset strokes**, the masked refraction perimeter on the main pill, panel, custom dropdown and selectors (including fallback support), opacity-only hover/selected backgrounds, nonzero backdrop blur, fixed SVG frame geometry, removal of duplicate bezels, custom dropdown stacking, and iPhone scrollbar hiding with scrolling preserved.
- Run the complete CI suite and the production build. Merge only after checks pass and verify the exact production deployment commit.
