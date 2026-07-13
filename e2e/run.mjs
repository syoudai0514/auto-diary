/**
 * E2Eテストランナー。
 *
 *   npm run test:e2e            … 本番ビルド → サーバー起動 → 全フロー実行
 *   npm run test:e2e -- --skip-build   … 既存の .next を使う（ローカルでの繰り返し実行用）
 *
 * 外部サービスには一切依存しない:
 *  - アカウントDB: Upstash互換のモックサーバー（e2e/mock-upstash.mjs）
 *  - Gemini API:   各フロー内で page.route によりモック
 * ブラウザはplaywrightのchromiumを使う。パスを指定したい場合は
 * 環境変数 E2E_CHROMIUM_PATH を設定する（未設定ならplaywright既定の場所）。
 */
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { startMockUpstash } from './mock-upstash.mjs';
import { run as accountsFlow } from './flows/accounts.mjs';
import { run as reviseFlow } from './flows/revise.mjs';
import { run as appleGateFlow } from './flows/apple-gate.mjs';
import { run as talkFlow } from './flows/talk.mjs';
import { run as factnoteFlow } from './flows/factnote.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const INVITE = 'e2e-invite-code';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/login`);
      if (res.status < 500) return;
    } catch {
      /* まだ起動していない */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not become ready at ${base}`);
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');

  if (!skipBuild) {
    console.log('[e2e] building production bundle...');
    const build = spawnSync(process.execPath, [nextBin, 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error('next build failed');
  }

  const mockPort = await freePort();
  const appPort = await freePort();
  const base = `http://localhost:${appPort}`;

  console.log(`[e2e] starting mock upstash on :${mockPort}, app on :${appPort}`);
  const mock = await startMockUpstash(mockPort);

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'production',
    AUTH_SECRET: 'e2e-secret-value-at-least-32-characters-long',
    SESSION_DAYS: '7',
    ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    INVITE_CODE: INVITE,
    KV_REST_API_URL: `http://localhost:${mockPort}`,
    KV_REST_API_TOKEN: 'e2e-fake-token',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_TRANSCRIBE_MODEL: 'gemini-3.1-flash-lite',
  };
  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(appPort)], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`));

  // ダミー音声（内容は不問: transcribe はフロー内でモックされる）
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vd-e2e-'));
  const audioFile = path.join(tmpDir, 'tiny.webm');
  writeFileSync(audioFile, Buffer.alloc(2048, 1));

  let browser = null;
  let failed = false;
  try {
    await waitForServer(base);
    console.log('[e2e] server ready');

    const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});

    let contextCount = 0;
    const newPage = async () => {
      contextCount++;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      // フローごとに別IPを名乗り、IPベースのレート制限（signup等）を互いに独立させる
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.99.0.${contextCount}` });
      const page = await context.newPage();
      page.on('pageerror', (err) => console.log('  [pageerror]', err.message));
      return page;
    };

    const flows = [
      ['accounts', accountsFlow],
      ['revise', reviseFlow],
      ['apple-gate', appleGateFlow],
      ['talk', talkFlow],
      ['factnote', factnoteFlow],
    ];
    for (const [name, flow] of flows) {
      console.log(`[e2e] flow: ${name}`);
      try {
        await flow({ base, invite: INVITE, newPage, audioFile });
        console.log(`[e2e] flow ${name}: PASS`);
      } catch (err) {
        failed = true;
        console.error(`[e2e] flow ${name}: FAIL -`, err.message);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGKILL');
    await mock.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failed) {
    console.error('[e2e] RESULT: FAILED');
    process.exit(1);
  }
  console.log('[e2e] RESULT: ALL FLOWS PASSED');
}

main().catch((err) => {
  console.error('[e2e] runner error:', err);
  process.exit(1);
});
