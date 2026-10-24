#!/bin/sh
# Every check, from the project root: static checks, the node sim tests, browser smoke, the contract hooks, the
# chrome / pointer interaction checks, phones and tablets (sizing, portrait framing, resize sequences, touch, the
# pop-over on a phone, the quality ladder on a 60 Hz display), the Phase-2 behaviour test (transitions, seasons,
# drag-only wind, determinism, the Phase-1 anchor regression, a one-year soak at speed 8), then the performance gate
# (uncapped fps >= 60 at 1920x1080 dpr 2 for every weather in both scenes and every hazard in both scenes; run it on a
# quiet machine). Phase 3 adds the multi-scene test (valley parity with the Phase-2 copy: git commit f311fc6, extracted by
# tests/ref.mjs, so git and the repository history are needed; the
# house, the program prewarm and switching without leaks, the hazards in the valley, the event scheduler, the
# single-file bundle) and the house / hazards lanes' own tests. Args are passed to phase2.mjs (e.g. --out DIR, --only year).
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
node app/tests/scenes.mjs
node app/tests/house.mjs
node app/tests/hazards.mjs
node app/tests/phase2.mjs "$@"
node app/tests/fps.mjs
