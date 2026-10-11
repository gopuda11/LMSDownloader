# Implementation plan

Owner requested immediate implementation; native execution in this session.

1. Add tests for documents.js attachment recognition, exact HTTPS host policy, Canvas ID extraction, filenames and response-size bounds. Run failing, implement, run green.
2. Pin and bundle browser libraries locally with esbuild; preserve dependencies and third-party licenses. Add sandbox entry with PPTX ZIP validation and direct legacy PPT parsing, no external relationships, sequential rendering, progress, preview, cancellation and image PDF output.
3. Add converter tab UI and parent controller. Fetch only validated Dankook URLs/Canvas metadata with credentials and bounded response; send buffers only to own sandbox; validate message source/job. Permit local file input and cancel. Save via downloads API, revoke blobs after completion.
4. Add popup document scanner and separate material cards; avoid lesson reload when only attachments exist. Keep existing video flows and permissions. Update manifest sandbox CSP and version 1.3.0, package allowlist and README.
5. Run all tests/build. Use real Chromium extension and synthetic PPTX for output page count, Korean rendering, rejected external relationships, corrupt/legacy files and cancellation. Self-review source and licenses, verify ZIP, push and create release; report live-school retrieval limitation.

Review focus: opaque sandbox script loading, Canvas redirect/metadata bounds, external OOXML resources, output memory and conversion cancellation, MIME/login error handling.

Validation completed: 20 Node tests; scripts/check-browser.py exercised real Chromium conversion of PPT/PPTX (2 pages each), cancellation/restart, malformed and external resources, and controlled school-origin module mapping/file download. Actual logged-in school retrieval remains unverified. Offscreen animation scheduling and data/blob CSP requirements were reproduced and fixed.
