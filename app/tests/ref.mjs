// The Phase-2 reference the valley-parity checks compare with, reproducible from the repository (polish: the copies
// under work/ are gitignored, so a fresh clone has none, and once tools/release.sh replaces the root index.html the
// live Phase-2 file exists nowhere else).
//   phase2Dir()  the Phase-2 app: git commit PHASE2_COMMIT ("Phase 2: four seasons and weather"), whose app/ is the
//                source of the live site (https://fourseason-lac.vercel.app/; that commit's root index.html is this
//                app bundled by tools/build.mjs). `git archive` extracts it once into <os tmp>/snow-ref-<commit>/
//                (written to a temporary name and renamed, so parallel runs never see a half-written copy; reused while
//                it exists). Without git history (a tarball), work/phase3/app-phase2 when present (the same files).
//                Returns the app directory (index.html + js/ ...), or null: callers FAIL then, never skip silently.
//   --ref FILE in the tests still overrides it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASE2_COMMIT = 'f311fc6';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let cached;
export function phase2Dir() {
  if (cached !== undefined) return cached;
  const dest = path.join(os.tmpdir(), `snow-ref-${PHASE2_COMMIT}`), app = path.join(dest, 'app');
  const complete = d => fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'js/main.js'));
  if (complete(app)) return (cached = app);
  try {
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });                  // (a damaged copy)
    const tmp = fs.mkdtempSync(dest + '-tmp-');
    const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', PHASE2_COMMIT, 'app'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar });
    try { fs.renameSync(tmp, dest); } catch { fs.rmSync(tmp, { recursive: true, force: true }); }   // (another run won)
    if (complete(app)) return (cached = app);
  } catch {}
  const local = path.join(ROOT, 'work/phase3/app-phase2');
  return (cached = complete(local) ? local : null);
}
