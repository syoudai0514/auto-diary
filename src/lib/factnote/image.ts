'use client';

/**
 * 添付画像の前処理（依頼書 §2-1 / §8.4）。
 * 端末内（IndexedDB）に保存する前に長辺 ~1600px へ縮小し JPEG 圧縮して、
 * 保存容量を抑える（将来 Gemini の画像抽出へ送る場合の 4.5MB 上限対策も兼ねる）。
 * デコードできない形式（HEIC 等を非対応ブラウザで開いた場合）は原本のまま保存する。
 */

/** 拡張子から画像MIMEを推定（iOSファイルアプリ等で type が空になる対策。§2-6）。 */
export function guessImageMimeType(fileName: string, declaredType?: string): string {
  if (declaredType && declaredType.startsWith('image/')) return declaredType;
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
  };
  return map[ext] ?? 'image/jpeg';
}

function renameToJpg(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return `${base || 'image'}.jpg`;
}

export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_JPEG_QUALITY = 0.82;

export interface PreparedImage {
  blob: Blob;
  mimeType: string;
  fileName: string;
}

/**
 * 画像ファイルを保存用に整える。縮小・JPEG圧縮できたらそれを、
 * できなければ原本をそのまま返す（どちらでも保存はできる）。
 */
export async function prepareImageBlob(file: File): Promise<PreparedImage> {
  const declaredMime = guessImageMimeType(file.name, file.type);
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      throw new Error('no_canvas');
    }
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = Math.min(1, IMAGE_MAX_EDGE / longest);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_ctx');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY),
    );
    if (blob && blob.size > 0) {
      return { blob, mimeType: 'image/jpeg', fileName: renameToJpg(file.name) };
    }
  } catch {
    // デコード不可（HEICを非対応ブラウザで開いた等）→ 原本をそのまま保存
  }
  return { blob: file, mimeType: declaredMime, fileName: file.name };
}
