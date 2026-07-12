/**
 * 外部アプリ連携用の URL・テキスト生成ユーティリティ。
 * 純粋関数として実装し、単体テストで検証する。
 */

export interface SharePayload {
  title: string;
  body: string;
  tags: string[];
  createdAt: string; // ISO 8601
}

/** iOS ショートカット名。README の手順と一致させる。 */
export const SHORTCUT_NAME = '音声日記を保存';

/**
 * URLスキーム・共有シート・Shortcutsアクションのいずれにも対応していない
 * 日記アプリ向けのフォールバック用ショートカット名。README の手順と一致させる。
 * 中身は「アプリを開く」の1アクションのみ（本文はクリップボード経由で渡す）。
 */
export const OPEN_APP_SHORTCUT_NAME = '日記アプリを開く';

/**
 * URL の長さ制限（保守的な目安）。
 * iOS の shortcuts:// スキームは、Safari一般のURL長制限よりかなり手前
 * （数千文字程度）で起動自体が無反応・無言で失敗することがあるため、
 * 少し長い日記でも安全側に倒してクリップボード経由の代替方式に切り替える。
 */
export const URL_LENGTH_LIMIT = 2000;

/**
 * Appleジャーナル保存用ショートカットを起動する URL を生成する。
 * shortcuts://run-shortcut?name=<名前>&input=text&text=<URLエンコード済みJSON>
 */
export function buildShortcutUrl(payload: SharePayload): string {
  const json = JSON.stringify(shortcutJson(payload));
  const params = new URLSearchParams({
    name: SHORTCUT_NAME,
    input: 'text',
    text: json,
  });
  return `shortcuts://run-shortcut?${params.toString()}`;
}

/** ショートカットへ渡す JSON（辞書に変換される想定）。 */
export function shortcutJson(payload: SharePayload) {
  return {
    title: payload.title,
    body: payload.body,
    tags: payload.tags,
    createdAt: payload.createdAt,
  };
}

/** URL が長すぎてスキーム起動が失敗しそうかを判定する。 */
export function isShortcutUrlTooLong(payload: SharePayload): boolean {
  return buildShortcutUrl(payload).length > URL_LENGTH_LIMIT;
}

/**
 * Day One のURLスキームを生成する。
 * dayone://post?entry=<本文>&journal=<ジャーナル名>&tags=<タグ>
 * 日本語・改行・記号は encodeURIComponent により正しくエンコードされる。
 */
export function buildDayOneUrl(options: {
  title: string;
  body: string;
  tags: string[];
  journal?: string;
}): string {
  const { title, body, tags, journal } = options;
  // Day One はタイトル欄が独立していないため、1行目に見出しとして title を置く。
  const entry = title ? `${title}\n\n${body}` : body;
  const params = new URLSearchParams();
  params.set('entry', entry);
  if (journal) params.set('journal', journal);
  if (tags.length > 0) params.set('tags', tags.join(','));
  return `dayone://post?${params.toString()}`;
}

/**
 * 名前だけ指定してショートカットを起動する URL を生成する（入力データなし）。
 * URLスキームや共有シートに対応していないアプリを、Shortcutsの「アプリを開く」
 * アクション経由で開くためのフォールバックに使う。
 */
export function buildRunShortcutUrl(name: string): string {
  const params = new URLSearchParams({ name });
  return `shortcuts://run-shortcut?${params.toString()}`;
}

/** タイトルと本文をまとめた「全文コピー」用テキスト。 */
export function fullText(title: string, body: string): string {
  return title ? `${title}\n\n${body}` : body;
}

/** Web Share API 用のテキスト（title は共有シートのタイトルに、本文は text に）。 */
export function shareData(title: string, body: string): { title: string; text: string } {
  return { title: title || '音声日記', text: fullText(title, body) };
}
