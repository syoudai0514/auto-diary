/** ミリ秒を mm:ss にフォーマット。 */
export function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 秒を「x分y秒」/「y秒」形式に。表示用。 */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

/** ISO 日時を「M月D日」形式に。 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** バイト数を人が読みやすい単位（B/KB/MB）に。表示用。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 複数音声ファイルの文字起こし結果を1つの文章にまとめる。
 * 空・空白のみの結果（無音のファイルなど）は除外し、段落として空行区切りで連結する。
 */
export function combineTranscripts(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}
