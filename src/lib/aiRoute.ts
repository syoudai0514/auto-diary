import { NextResponse } from 'next/server';
import { decryptSecret } from './crypto';
import { getUserById } from './userStore';

/**
 * Geminiを呼び出すAPIルート（transcribe / generate / diary/revise / profile/update）
 * が共通で使うヘルパー。認証済みユーザーのGemini APIキーの解決と、
 * Gemini呼び出し失敗時のエラーレスポンス整形をここに集約する。
 * Node実行のみを前提とする（middleware.ts からは import しないこと）。
 */

/**
 * ユーザーのアカウントから復号済みのGemini APIキーを取り出す。
 * 失敗時は呼び出し元がそのまま返せる NextResponse を返す:
 * - アカウントが見つからない（セッションだけ残っている）→ 401
 * - キー未登録 → 400 no_api_key
 * - 復号失敗（暗号鍵の変更・データ破損）→ 500 key_unreadable
 */
export async function resolveGeminiApiKey(
  userId: string,
): Promise<{ apiKey: string } | NextResponse> {
  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user.geminiKeyEncrypted) {
    return NextResponse.json(
      { error: 'no_api_key', message: 'Gemini APIキーが未設定です。設定画面から登録してください。' },
      { status: 400 },
    );
  }
  try {
    return { apiKey: decryptSecret(user.geminiKeyEncrypted) };
  } catch {
    // キー本体・理由の詳細はログに出さない
    console.error('[account] Gemini APIキーの復号に失敗');
    return NextResponse.json(
      {
        error: 'key_unreadable',
        message: '保存されたAPIキーを読み取れませんでした。設定画面から登録し直してください。',
      },
      { status: 500 },
    );
  }
}

/**
 * Gemini呼び出しが失敗したときの共通エラーレスポンス。
 * ステータス・APIからの失敗理由のみをログと応答に含める
 * （ユーザーの音声・本文は決して含めない）。
 */
export function aiErrorResponse(
  opts: { tag: string; code: string; messageBase: string },
  err: unknown,
): NextResponse {
  const status = statusFromError(err);
  const reason = errReason(err);
  console.error(
    `[${opts.tag}] failed:`,
    status,
    reason || (err instanceof Error ? err.name : 'UnknownError'),
  );
  return NextResponse.json(
    {
      error: opts.code,
      message: reason ? `${opts.messageBase}（${reason}）` : `${opts.messageBase}。`,
    },
    { status },
  );
}

function statusFromError(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = Number((err as { status?: unknown }).status);
    if (Number.isFinite(s) && s >= 400 && s < 600) return s;
  }
  return 502;
}

/** Gemini SDK のエラーメッセージ（API側の失敗理由。ユーザーの入力本文は含まれない）。 */
function errReason(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as Error).message).slice(0, 300);
  }
  return '';
}
