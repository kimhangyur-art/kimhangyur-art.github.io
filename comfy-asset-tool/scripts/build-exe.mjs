// 화면 빌드(dist/)를 런처에 넣고 Windows용 exe를 만든다.
// 사용: npm run build:exe  →  release/캐릭터에셋공방.exe
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'launcher', 'web');
const out = join(root, 'release', '캐릭터에셋공방.exe');

rmSync(web, { recursive: true, force: true });
cpSync(join(root, 'dist'), web, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
execFileSync('go', ['build', '-trimpath', '-ldflags', '-H=windowsgui -s -w', '-o', out, '.'], {
  cwd: join(root, 'launcher'),
  stdio: 'inherit',
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
});
console.log(`만들었습니다: ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
