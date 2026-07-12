import http from 'http';

/**
 * Upstash Redis REST API の最小互換モックサーバー（E2Eテスト専用）。
 * @upstash/redis クライアントは POST / にコマンド配列(JSON)を送り、
 * { result } を受け取る（文字列はbase64エンコード）。
 * アプリが使う get / set(NX対応) / incr / expire のみ実装している。
 */
export function startMockUpstash(port) {
  const store = new Map();

  const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let command;
      try {
        command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }
      const [cmd, ...args] = command;
      let result = null;
      if (cmd === 'get') {
        const val = store.get(args[0]);
        result = val === undefined ? null : b64(val);
      } else if (cmd === 'set') {
        const [key, value, ...opts] = args;
        if (opts.includes('nx') && store.has(key)) {
          result = null;
        } else {
          store.set(key, value);
          result = 'OK';
        }
      } else if (cmd === 'incr') {
        const next = (Number(store.get(args[0])) || 0) + 1;
        store.set(args[0], String(next));
        result = next;
      } else if (cmd === 'expire') {
        // モックではTTLを追跡しない（テストは1プロセス内で完結するため不要）
        result = 1;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      resolve({
        store,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
