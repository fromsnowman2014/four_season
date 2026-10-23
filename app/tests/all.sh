#!/bin/sh
# Every check, from the project root: static checks, the node sim tests, browser smoke, the contract hooks, the
# chrome / pointer interaction checks, phones and tablets (sizing, portrait framing, resize sequences, touch, the
# pop-over on a phone, the quality ladder on a 60 Hz display), the Phase-2 behaviour test (transitions, seasons,
# drag-only wind, determinism, the Phase-1 anchor regression, a one-year soak at speed 8), then the performance gate
# (uncapped fps >= 60 per weather at 1920x1080 dpr 2; run it on a quiet machine). Args are passed to phase2.mjs
# (e.g. --out DIR, --only year).
# tests/parity.mjs (pixel parity against stage 0a) is retired as a gate since stage 2a: Phase 2 changes the image by
# design; phase2.mjs keeps the Phase-1 anchor query as a visual regression against its goldens.
set -e
cd "$(dirname "$0")/../.."
node app/tests/check.mjs
node app/tests/sim.mjs --quiet
node app/tests/smoke.mjs
node app/tests/hooks.mjs
node app/tests/interact.mjs
node app/tests/mobile.mjs
node app/tests/phase2.mjs "$@"
node app/tests/fps.mjs
