import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio, generateDiaryApi, login, ApiError } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** signal を尊重して abort 時に AbortError で reject する fetch モック。 */
function abortableFetch() {
  return vi.fn((_url: RequestInfo, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  });
}

describe('APIクライアント: 通信エラー', () => {
  it('fetch が失敗すると network エラーになる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('failed to fetch'))),
    );
    await expect(generateDiaryApi('t', 'natural')).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('サーバーが 500 を返すと ApiError になる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'generation_failed', message: '失敗' }), {
            status: 502,
          }),
        ),
      ),
    );
    const err = await generateDiaryApi('t', 'natural').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('失敗');
  });
});

describe('APIクライアント: peopleContext（登場人物の補足情報）', () => {
  it('指定した peopleContext をリクエストボディに含めて送信する', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ diary: { title: 't', body: 'b' } }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateDiaryApi('t', 'natural', '私は父です。妻はママと呼びます。');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.peopleContext).toBe('私は父です。妻はママと呼びます。');
  });

  it('未指定なら peopleContext は undefined のまま送信される', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ diary: { title: 't', body: 'b' } }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateDiaryApi('t', 'natural');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.peopleContext).toBeUndefined();
  });
});

describe('APIクライアント: タイムアウト', () => {
  it('generate がタイムアウトすると 408 timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortableFetch());
    const p = generateDiaryApi('t', 'natural', undefined, 50);
    const expectation = expect(p).rejects.toMatchObject({ code: 'timeout', status: 408 });
    await vi.advanceTimersByTimeAsync(60);
    await expectation;
  });

  it('transcribe がタイムアウトすると 408 timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortableFetch());
    const blob = new Blob(['x'], { type: 'audio/webm' });
    const p = transcribeAudio(blob, 'a.webm', 50);
    const expectation = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60);
    await expectation;
  });
});

describe('APIクライアント: レート制限', () => {
  it('429 は Retry-After ヘッダーを retryAfter に反映する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'too_many_requests' }), {
            status: 429,
            headers: { 'Retry-After': '12' },
          }),
        ),
      ),
    );
    const err = await generateDiaryApi('t', 'natural').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(12);
  });

  it('Retry-After が無い場合は undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'x' }), { status: 500 }))),
    );
    const err = await generateDiaryApi('t', 'natural').catch((e) => e);
    expect(err.retryAfter).toBeUndefined();
  });
});

describe('APIクライアント: login', () => {
  it('401 を投げ返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'invalid_password' }), { status: 401 })),
      ),
    );
    const err = await login('bad').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_password');
  });
});
