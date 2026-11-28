# Draw AI review

Configure `TYPESAFE_API_KEY` and a private `FLOW_DRAW_ACCESS_KEY` of at least 24 characters in the deployment environment. Redeploy. Enter the private Draw access key (not the TypeSafe API key) in Draw's AI review panel. It is held only in page memory.

Upload screenshots, optionally describe what is wrong, and choose Review all. Each request sends a resized JPEG to TypeSafe's Jev 1.14 System One API. The original screenshots never need to leave the browser for manual editing or export. Jev's image and Box support is experimental; screenshot evidence cannot establish hidden backend bugs. The model returns independent presence decisions and candidate boxes. The application validates normalized geometry, gates on heuristic thresholds, deduplicates overlapping findings, and converts accepted targets to editable sketch arrows. Thresholds are not calibrated against Flow's screenshot corpus yet.

Review uses two concurrent requests, cancellation, per-image failures, and bounded in-memory caching. It does not replace manual annotations; it skips images edited while inference was active. Existing suggestions are replaced only after a successful review. Export all includes annotated screenshots and, when available, review.json with issue categories, target coordinates and the user's intent. No generated code is executed.

Official API: https://docs.typesafe.ai/images and https://docs.typesafe.ai/primitives/box . Run node scripts/test-draw-review.mjs for mocked contract tests; live provider inference needs credentials and a representative labeled screenshot dataset. Profile actual navigation separately before promising latency improvements.
