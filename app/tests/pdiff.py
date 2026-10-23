"""Pixel difference of two screenshots (8-bit RGB), for the parity test.

usage: python3 pdiff.py a.png b.png [diff_out.png]
Prints one JSON object. The per-pixel difference is the max over R, G, B of |a - b| (stricter than a luma
difference); mean / p50 / p90 / p99 / p99.9 / max are taken over all pixels. If diff_out is given, writes the
difference image amplified x8 for eyeballing.
"""
import json
import sys

from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert('RGB')
b = Image.open(sys.argv[2]).convert('RGB')
if a.size != b.size:
    print(json.dumps({'error': 'size mismatch', 'a': a.size, 'b': b.size}))
    sys.exit(1)
r, g, bl = ImageChops.difference(a, b).split()
d = ImageChops.lighter(ImageChops.lighter(r, g), bl)          # max channel difference per pixel
h = d.histogram()
n = sum(h)
pct, cum = {}, 0
for i, c in enumerate(h):
    cum += c
    for p in (50, 90, 99, 99.9):
        if p not in pct and cum >= n * p / 100:
            pct[p] = i
out = {
    'size': a.size,
    'mean': round(sum(i * c for i, c in enumerate(h)) / n, 4),
    'p50': pct[50], 'p90': pct[90], 'p99': pct[99], 'p99.9': pct[99.9],
    'max': max(i for i, c in enumerate(h) if c),
    'px_gt4': sum(c for i, c in enumerate(h) if i > 4),
    'px_gt24': sum(c for i, c in enumerate(h) if i > 24),
}
print(json.dumps(out))
if len(sys.argv) > 3:
    d.point(lambda v: min(255, v * 8)).save(sys.argv[3])
