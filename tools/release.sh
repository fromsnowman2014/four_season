#!/bin/sh
# Build the single-file release from app/ and publish it as the site root (index.html).
# Run from anywhere; commit and push afterwards.
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs dist/snow.html
cp dist/snow.html index.html
echo "index.html <- dist/snow.html"
