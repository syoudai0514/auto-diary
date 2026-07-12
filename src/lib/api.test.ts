import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Diary } from './diary';
import { sampleAnalysis as sampleTalkAnalysis } from '@/test/fixtures/talkAnalysis';
import {
  transcribeAudio,
  generateDiaryApi,
  reviseDiaryApi,
  updateProfileApi,
  transcribeTalkAudio,
  analyzeTalkApi,
  login,
  signup,
  getGeminiKeyStatus,
  saveGeminiKey,
  ApiError,
} from './api';

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
      Promise.resolve(new Response(JSON.stringify({ diary: sampleDiary }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateDiaryApi('t', 'natural', '私は父です。妻はママと呼びます。');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.peopleContext).toBe('私は父です。妻はママと呼びます。');
  });

  it('未指定なら peopleContext は undefined のまま送信される', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ diary: sampleDiary }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateDiaryApi('t', 'natural');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.peopleContext).toBeUndefined();
  });
});

describe('APIクライアント: 応答のスキーマ検証', () => {
  it('欠けたフィールドを持つ diary 応答は invalid_response エラーになる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ diary: { title: 'only-title' } }), { status: 200 }),
        ),
      ),
    );
    const err = await generateDiaryApi('t', 'natural').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_response');
  });

  it('diary が欠落した応答も invalid_response エラーになる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    );
    const err = await reviseDiaryApi('t', sampleDiary, 'x', 'natural').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_response');
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

const sampleDiary: Diary = {
  title: '元のタイトル',
  body: '元の本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: [],
  rawTranscript: '元の文字起こし',
};

describe('APIクライアント: reviseDiaryApi', () => {
  it('transcript・currentDiary・instructionを送信し、修正後のdiaryを返す', async () => {
    const revised = { ...sampleDiary, title: '修正後のタイトル' };
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ diary: revised }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await reviseDiaryApi('元の文字起こし', sampleDiary, 'もっと短くして', 'natural');
    expect(result.title).toBe('修正後のタイトル');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.transcript).toBe('元の文字起こし');
    expect(body.currentDiary).toEqual(sampleDiary);
    expect(body.instruction).toBe('もっと短くして');
    expect(body.style).toBe('natural');
  });

  it('サーバーエラー時は ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'revision_failed', message: '失敗' }), { status: 502 }),
        ),
      ),
    );
    const err = await reviseDiaryApi('t', sampleDiary, 'x', 'natural').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('失敗');
  });
});

describe('APIクライアント: updateProfileApi', () => {
  it('現在のMarkdownと新しい入力を送信し、更新後のMarkdownを返す', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ markdown: '## 更新後' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await updateProfileApi('## 既存', '新しい情報');
    expect(result).toBe('## 更新後');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ currentMarkdown: '## 既存', newInput: '新しい情報' });
  });

  it('サーバーエラー時は ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'update_failed', message: '失敗' }), { status: 502 }),
        ),
      ),
    );
    const err = await updateProfileApi('', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('失敗');
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
    const err = await login('taro', 'bad').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_password');
  });
});

describe('APIクライアント: signup', () => {
  it('ユーザー名・パスワード・招待コードを送信する', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await signup('taro', 'a-long-password', 'invite-123');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ username: 'taro', password: 'a-long-password', inviteCode: 'invite-123' });
  });

  it('招待コードが違えば ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'invalid_invite' }), { status: 401 })),
      ),
    );
    const err = await signup('taro', 'a-long-password', 'wrong').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_invite');
  });
});

describe('APIクライアント: Gemini APIキーの登録状況', () => {
  it('getGeminiKeyStatus は hasKey を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ hasKey: true }), { status: 200 }))),
    );
    const result = await getGeminiKeyStatus();
    expect(result.hasKey).toBe(true);
  });

  it('saveGeminiKey は apiKey を送信する', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await saveGeminiKey('AIzaExampleKey');
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ apiKey: 'AIzaExampleKey' });
  });

  it('saveGeminiKey はサーバーエラー時に ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'invalid_key' }), { status: 400 })),
      ),
    );
    const err = await saveGeminiKey('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_key');
  });
});

describe('APIクライアント: 話し合い分析', () => {
  it('analyzeTalkApi は話者名を送信し、検証済みの分析結果を返す', async () => {
    const fetchMock = vi.fn((_url: RequestInfo, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ analysis: sampleTalkAnalysis }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeTalkApi('A: こんにちは\nB: やあ', '私', '妻');
    expect(result.verdict.leansToward).toBe('B');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.speakerA).toBe('私');
    expect(body.speakerB).toBe('妻');
    expect(body.transcript).toBe('A: こんにちは\nB: やあ');
  });

  it('analysis が壊れた応答は invalid_response エラーになる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ analysis: { title: 'だけ' } }), { status: 200 })),
      ),
    );
    const err = await analyzeTalkApi('t', 'A', 'B').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('invalid_response');
  });

  it('transcribeTalkAudio はテキストを返し、サーバーエラー時は ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ text: 'A: おはよう' }), { status: 200 }))),
    );
    const blob = new Blob(['x'], { type: 'audio/webm' });
    expect(await transcribeTalkAudio(blob, 'talk.webm')).toBe('A: おはよう');

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'transcription_failed', message: '失敗' }), { status: 502 }),
        ),
      ),
    );
    const err = await transcribeTalkAudio(blob, 'talk.webm').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('失敗');
  });
});
