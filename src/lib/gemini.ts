import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';

/**
 * Gemini クライアントを生成する。
 * 各ユーザーが自分自身のGemini APIキーを持ち込む(BYOK)ため、呼び出し元は
 * リクエストごとに、認証済みユーザーのアカウントに保存された（復号済みの）
 * APIキーを明示的に渡す。クライアントの生成自体は軽量なため、モジュール単位で
 * キャッシュはしない。
 */
export function getGemini(apiKey: string): GoogleGenAI {
  if (!apiKey) {
    throw new Error('Gemini APIキーが指定されていません');
  }
  return new GoogleGenAI({ apiKey });
}

// gemini-2.0-flash 系は 2026-06-01 付けで廃止されたため、既定値は
// 無料枠が広い gemini-3.1-flash-lite にしている（環境変数で変更可）。
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

/**
 * 自分自身の出来事を客観視するための内省アプリ、という用途向けの安全設定。
 * Geminiの既定の閾値は、言い合いの描写や相手への不満（特に子どもが関係する場面や、
 * 深刻な衝突の描写）を実際の加害目的コンテンツと区別できず誤ってブロックすることがあり、
 * 分析結果が空文字で返って「分析に失敗しました」になる原因になっていた
 * （BLOCK_ONLY_HIGH でもなお誤ブロックが確認されたため BLOCK_NONE まで緩めている）。
 * このアプリはユーザー自身の体験の記録・分析用途に閉じており（第三者への攻撃文の生成は
 * 行わない）、むしろ危険性の兆候（暴力・自傷・子どもの安全等）自体をモデルに
 * safetyFlags として検出・提示させ、ユーザー自身の安全につなげる設計のため、
 * ブロックによって分析自体が止まってしまう方が実害が大きい。
 * BLOCK_NONE は閾値でのブロックを止めるだけで安全性評価（safetyRatings）自体は
 * 引き続き返るため、ブロック理由の診断ログには使える。
 */
export const REFLECTIVE_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export function chatModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export function transcribeModel(): string {
  return process.env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_MODEL;
}

/**
 * 1リクエストあたりの音声アップロード上限。
 * Vercel のサーバーレス関数はリクエストボディサイズに約4.5MBのプラットフォーム上限が
 * あり、それを超えるとこちらのコードに到達する前にリクエスト自体が拒否される。
 * そのため既定値は安全マージンを取って4MBにしている（それより大きい音声は
 * クライアント側で自動的にチャンク分割してから複数リクエストで送信する）。
 */
export function maxAudioBytes(): number {
  const n = Number(process.env.MAX_AUDIO_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 4 * 1024 * 1024; // 4MB
}

/** GenerateContentResponse からテキストを安全に取り出す（text は undefined になりうる）。 */
export function extractText(response: { text?: string }): string {
  return typeof response.text === 'string' ? response.text : '';
}

/**
 * 文字起こし呼び出しの出力トークン上限。無音区間などで文字起こしが暴走し
 * 出力が際限なく膨らむハルシネーションへの歯止め（正当な長い会話は十分収まる余裕を持たせる）。
 */
export const TRANSCRIBE_MAX_OUTPUT_TOKENS = 8192;

/** 同一行が連続する場合に残す最大回数。 */
const MAX_CONSECUTIVE_REPEATED_LINES = 10;

/**
 * 文字起こし結果の行単位の暴走的な繰り返しを畳み込む。
 * Gemini の音声文字起こしは、無音区間や聞き取りにくい箇所で同じ発言を
 * 際限なく繰り返すことがある（既知のハルシネーション挙動）。同一行が
 * MAX_CONSECUTIVE_REPEATED_LINES 回を超えて連続した場合のみ、先頭分だけ残す。
 */
export function collapseRepeatedLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const runLength = j - i;
    const keep = Math.min(runLength, MAX_CONSECUTIVE_REPEATED_LINES);
    for (let k = 0; k < keep; k++) result.push(lines[i]);
    i = j;
  }
  return result.join('\n');
}

/** 拡張子 → MIME タイプ。ブラウザが型を報告できない音声ファイル向けのフォールバック用。 */
const EXT_MIME_MAP: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mov: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  webm: 'audio/webm',
};

/** ブラウザが返す type が空・汎用的すぎるとみなすか。 */
function isGenericMimeType(type: string | undefined): boolean {
  return !type || type === 'application/octet-stream' || type === 'application/x-empty';
}

/**
 * 音声ファイルの MIME タイプを推定する。
 * iOS の「ファイル」アプリ経由（Shortcuts書き出し等）で選ばれたファイルは
 * ブラウザ側で正しい type を持たないことがあるため、拡張子からも補完する。
 */
export function guessAudioMimeType(filename: string, declaredType: string | undefined): string {
  if (!isGenericMimeType(declaredType)) return declaredType as string;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return EXT_MIME_MAP[ext] ?? 'audio/webm';
}
