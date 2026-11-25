# Flow: PDF page efficiency and Share refinement

## Evidence
The supplied screenshot shows a five-page export with only one body line on page five. The original PDF/Markdown is not attached, so the exact document cannot be reproduced. The current PDFMake definition reserves 100pt in vertical margins, uses generous block margins and line heights, and has no final-page occupancy check. The screenshot also shows a dense share dialog with a browser-default accent checkbox and muted monospace URL. Current design.md requires borderless-first, quiet neutral controls, meaningful focus, darkening hover in dark mode and lightening hover in light mode.

## Implementation
1. Keep A4, selectable text, syntax colors, real links, page numbering, images and heading orphan protection. Tighten vertical rhythm without shrinking text. Use a bounded compact preset that adjusts only vertical margins and line heights, preserving horizontal measure and font sizes.
2. Inspect the actual generated PDF's last-page text geometry (exclude running header/footer). If a multi-page export has only a few body lines near the top of the final page, generate one compact candidate from the same parsed Markdown and image assets. Use it only if its actual page count falls. If inspection or retry fails, retain the valid first PDF. Do not crop pages, delete text, or force arbitrary documents into a fixed page count.
3. Refine Markdown Share dialog only: compact borderless tonal surface, brighter Geist sans URL (not mono), title-aligned Phosphor globe, neutral custom accessible consent checkbox with Phosphor check, text-only Copy link with existing fixed-width copied transition, restrained Create link, Done, dotted revoke, distinct theme-specific hover and focus. Keep consent and server synchronization logic unchanged; do not modify hosted HTML controls.
4. Test real generated PDF page counts and text preservation on a synthetic near-boundary fixture; check no retry for ordinary/full tails and safe fallback. Extend UI assertions for font, consent, alignment and theme tokens. Run existing full CI, production build and PR checks, merge only after success, verify main SHA. Browser appearance and original-document page count are not established by unit tests.

## Acceptance
No missing content, clipped glyphs, false save status, changed share authorization, or decorative outlines. At most one compaction retry; page count decreases only when the real render fits. Document remains legible. Existing features and unrelated design remain unchanged.
