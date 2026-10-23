// =====================================================================================
//  GLSL: the cloud pass (stage-1 owner: lane C). Half resolution, temporally accumulated volumetric cloud slab.
//  Stores premultiplied cloud light + transmittance and an opacity-weighted cloud distance (km); the analytic sky is
//  evaluated in the shading pass so clouds can be composited over the sky or the far peaks. The march stops at the
//  terrain (G0's hit distance through the GBUF chunk, bound by render.js like every other pass: during a resize rebake
//  the baked rows read the new buffer and the rest the old one, aspect-remapped), so only cloud in front of a ridge is
//  accumulated: near cumulus can drift in front of the massif without a halo of the cloud behind it, and pixels whose
//  terrain is nearer than the slab (the right wall, the mid ridge) skip the march altogether.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.FS_SKY = `
uniform sampler2D uPrev, uPrevD;
uniform float uBlend, uFrame, uSteps;
uniform float uSkyResp;      // 1 on a jump of the cloud inputs: restart the temporal accumulation this frame
layout(location = 0) out vec4 o;    // premultiplied cloud radiance (with aerial perspective), transmittance
layout(location = 1) out vec4 oD;   // x: mean cloud distance (km) * cloud opacity (premultiplied so bilinear/temporal
                                    // filtering stays consistent; km keeps the >65 km far field inside half-float range)
float cloudD(vec3 p, bool hi) {
  vec2 q = p.xz + uCloudOff;
  float shape = cloudCover(q);                                      // 0..1 inside cloud fields
  // Phase 1 renders only the far cumulus field: behind the left massif (19 km+, so its summit stays clear) and, to
  // the right of centre, from ~13 km so a bank floats over the mid-wall ridge. Cumulus weather opens the cut to the
  // whole sky band (uCloudP)
  vec2 dv = p.xz - uCamPos.xz;
  float dn = length(dv);
  float cut = mix(uCloudP.x, uCloudP.y, smoothstep(uCloudQ.w, uCloudQ.w + mix(0.3, 0.1, uCumulus), dv.x / max(dn, 1.0)));
  shape *= smoothstep(cut, cut + uCloudP.z, dn);
  // cumulus thin out beyond ~16 km, so the near towers stand apart against blue sky instead of a stacked white wall
  shape *= 1.0 - 0.6 * uCumulus * smoothstep(16000.0, 32000.0, dn);
  // undulating base height; the near grey deck (uCloudQ.z: overcast / rain, not a snow curtain) also gets a ragged
  // ~800 m base (it hangs on the slopes in tatters instead of slicing the summits along one straight line)
  float deck = uCloudQ.z * (1.0 - uCumulus);
  float cb = uCloudQ.x + uCloudP.w * (tnoise(q * 0.00025 + 1.0) - 0.5) + 420.0 * deck * (tnoise(q * 0.0012 + 4.2) - 0.5);
  float h = (p.y - cb) / (uCloudQ.y - cb);
  vec3 r = vec3(q.x, p.y * 1.2, q.y) * mix(0.0011, 0.0023, uCumulus);     // cumulus: billows finer than the cells
  // billowy detail: |2n-1| octaves give rounded cauliflower bulges with creases between them (Phase 1). Cumulus
  // (stage 2b): softer heaps: the second octave is half a smooth bulge, and the ~36 m creases fade with distance
  // (beyond ~8 km they are below the half-res pixel and only speckle the cloud)
  float o2 = tnoise3(r * 2.1 + 3.7);
  float n = tnoise3(r) * 0.5 + mix(abs(o2 * 2.0 - 1.0), o2, 0.5 * uCumulus) * 0.28;
  float fine = 1.0 - uCumulus * smoothstep(5000.0, 14000.0, dn);
  n += hi ? abs(tnoise3(r * 4.4 + 1.1) * 2.0 - 1.0) * 0.14 + abs(tnoise3(r * 9.3 + 5.3) * 2.0 - 1.0) * 0.08 * fine + 0.04 * (1.0 - fine)
          : 0.11;
  // towers: Phase 1 tall cores (0.18 + 0.82 sqrt(shape) of the slab); cumulus: flat-based domes ~300-900 m tall.
  // (stage 2b) Inside a cumulus cell the coverage saturates, so a top set by the 2D cell alone is one flat plateau over
  // vertical walls (pillars, seen from the side): a smooth ~800 m noise heaps the cell into several domes, and the 3D
  // detail sets the top too (the cloud's surface is an iso-surface of the billows: cauliflower tops and bulging flanks)
  float heap = uCumulus > 0.001 ? 0.5 + 0.5 * tnoise(q * 0.0012 + vec2(2.2, 7.9)) : 0.8;
  float topC = (0.07 + 0.42 * sqrt(shape)) * heap * 1.25 * clamp(0.4 + 1.05 * (n - 0.3), 0.3, 1.0);
  float top = mix(0.18 + 0.82 * sqrt(shape), topC, uCumulus);
  float prof = smoothstep(0.0, mix(0.04, 0.012, uCumulus) + 0.14 * deck, h) * smoothstep(top, top * mix(0.3, 0.6, uCumulus), h);
  float d = shape * prof * (1.0 + 0.6 * uOvercast) - (1.0 - n) * mix(0.58, 0.8, uCumulus) + mix(0.06, 0.17, uCumulus);
  // cumulus: a soft outline (x6) around a dense core (up to x2.4 inside), so the edges are wispy and the body solid
  return sat(d * mix(4.5, 6.0, uCumulus)) * (1.0 + 1.4 * uCumulus * smoothstep(0.12, 0.4, d));
}
// terrain distance under this half-res pixel: the farthest of its canvas texels, so at a silhouette the sky wins
// (the cloud behind the ridge is kept for the sky texels; the shading pass rejects it on the terrain texels). On the
// first load the unbaked rows read as sky (hidden behind the reveal edge)
float terrainT(vec2 uv) {
  vec2 e = 0.25 / uRes;
  float t = 0.0;
  for (int i = 0; i < 4; i++) t = max(t, G0(uv + e * vec2(i == 1 || i == 3 ? 1.0 : -1.0, i >= 2 ? 1.0 : -1.0)).x);
  return t > 60000.0 ? 1e9 : t;
}
void main() {
  vec3 rd = camRay(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uRes;
  float T = 1.0; vec3 acc = vec3(0.0);
  float tHit = -1.0, tSum = 0.0, wSum = 0.0;   // opacity-weighted mean cloud distance (stable under temporal blending)
  float CB = uCloudQ.x, CT = uCloudQ.y;
  float t0 = (CB - uCamPos.y) / max(rd.y, 1e-4);
  float tTer = terrainT(uv);
  if (rd.y > 0.02 && t0 < min(45000.0, tTer)) {
    float t1 = min(min((CT - uCamPos.y) / rd.y, t0 + mix(28000.0, 20000.0, uCumulus)), tTer);
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.6180339);
    float steps = uSteps;
    float span = t1 - t0;
    // cumulus: steps grow along the ray (t = t0 + span (u + k u^2) / (1 + k), u = (i + jit) / steps), so the near,
    // large clouds get ~2x the samples of the hazy far field
    float kq = 0.8 * uCumulus;
    float mu = dot(rd, uSunDir);
    // dual-lobe Henyey-Greenstein: forward silver lining + soft back scatter
    float g1 = 0.7, g2 = -0.25;
    float ph = 0.75 * (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5) + 0.25 * (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5);
    ph = ph / 12.566 * 3.0 + 0.6;
    for (int i = 0; i < 48; i++) {
      if (float(i) >= steps || T < 0.02) break;
      float u = (float(i) + jit) / steps;
      float tt = t0 + span * (u + kq * u * u) / (1.0 + kq);
      float dt = span * (1.0 + 2.0 * kq * u) / ((1.0 + kq) * steps);
      vec3 p = uCamPos + rd * tt;
      float d = cloudD(p, true);
      if (d > 0.001) {
        if (tHit < 0.0) tHit = tt;
        // light march toward the sun (3 taps)
        float ls = mix(1.0, 0.6, uCumulus);       // cumulus are smaller: shorter taps resolve their self-shadowing
        float ld = (cloudD(p + uSunDir * 160.0 * ls, false) * 160.0 + cloudD(p + uSunDir * 480.0 * ls, false) * 320.0 + cloudD(p + uSunDir * 1100.0 * ls, false) * 600.0) * ls;
        float sig = 0.0045;
        float Tl = exp(-ld * sig * mix(0.9, 1.5, uCumulus));   // cumulus: deeper self-shadowing, sculpted flanks
        float powder = 1.0 - exp(-d * 4.0);
        float h = (p.y - CB) / (CT - CB);
        // darker, bluer bases against bright lit tops: cumulus, not a flat cotton bank (cumulus fill only the lower
        // half of the slab, so their ambient gradient is compressed into it)
        vec3 amb = mix(uSkyAmb * vec3(0.55, 0.62, 0.78) * mix(0.6, 0.42, uCumulus), uSkyAmb * 1.3 + vec3(0.05), smoothstep(0.0, mix(0.6, 0.4, uCumulus), h));
        vec3 L = uSunCol * Tl * ph * mix(mix(0.5, 0.78, uCumulus), 1.0, powder) * 1.35 + amb;
        float a = 1.0 - exp(-d * sig * dt);
        acc += T * a * L;
        tSum += T * a * tt; wSum += T * a;
        T *= 1.0 - a;
      }
    }
    if (wSum > 1e-4) tHit = tSum / wSum;
    // aerial perspective on the clouds (haze in front of the cloud only; the sky behind gets its own)
    if (tHit > 0.0) { vec4 f = fogAt(tHit, rd); acc = acc * f.a + f.rgb * (1.0 - T); }
  }
  vec4 prev = texture(uPrev, uv);
  float prevD = texture(uPrevD, uv).x;
  // cumulus accumulate a little longer (their soft volumes need more samples; the camera is fixed and they drift
  // slowly); a reset (uBlend 1) and a jump (uSkyResp) still restart at once
  float b = uBlend >= 1.0 ? 1.0 : max(uBlend * (1.0 - 0.4 * uCumulus), uSkyResp);
  o = mix(prev, vec4(acc, T), b);
  oD = vec4(mix(prevD, max(tHit, 0.0) * 0.001 * (1.0 - T), b), 0.0, 0.0, 1.0);
}
`;
  S.glsl.progs.sky = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'FS_SKY'] };
})(window.SNOW);
