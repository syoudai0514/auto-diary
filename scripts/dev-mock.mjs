/**
 * お試し用のワンコマンド起動（外部サービス不要）:
 *
 *   npm run dev:mock
 *
 * - アカウントDB: Upstash互換のモックサーバー（e2e/mock-upstash.mjs を再利用。
 *   メモリ上のみ — 停止するとアカウントは消える）
 * - AI: AI_MOCK=1 で固定のモック応答（Gemini APIキー不要）
 * - 招待コード: demo-invite
 *
 * 起動後 http://localhost:3000 （事実ノートは /factnote）を開き、
 * 任意のユーザー名・パスワード + 招待コード demo-invite でサインアップする。
 * 本物のAIで試す場合は README の「ローカルで動かす」に従い .env.local を設定すること。
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { startMockUpstash } from '../e2e/mock-upstash.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

const MOCK_PORT = 8791;
const INVITE = 'demo-invite';

const mock = await startMockUpstash(MOCK_PORT);
console.log(`[dev:mock] mock upstash on http://localhost:${MOCK_PORT}（データはメモリ上のみ）`);
console.log(`[dev:mock] 招待コード: ${INVITE} / AIはモック応答（AI_MOCK=1）`);

const child = spawn(process.execPath, [nextBin, 'dev'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    AUTH_SECRET: 'dev-mock-secret-value-at-least-32-characters-long',
    ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    INVITE_CODE: INVITE,
    KV_REST_API_URL: `http://localhost:${MOCK_PORT}`,
    KV_REST_API_TOKEN: 'dev-mock-token',
    AI_MOCK: '1',
  },
});

const shutdown = () => {
  child.kill('SIGINT');
  void mock.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', (code) => {
  void mock.close();
  process.exit(code ?? 0);
});
