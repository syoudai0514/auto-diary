'use client';

/**
 * 大きな音声ファイルを、サーバーへ安全にアップロードできるサイズの
 * WAV チャンクに分割するユーティリティ。
 *
 * 音声コンテナ形式（webm/m4a/mp3 等）はバイト単位で単純に切り分けると
 * 壊れる（ヘッダー情報が失われ、デコードできなくなる）ため、
 * Web Audio API で一度 PCM にデコードしてから、各チャンクを
 * 自己完結した WAV として書き出す。
 */

const BYTES_PER_SAMPLE = 2; // 16bit PCM
const WAV_HEADER_BYTES = 44;

/** 指定のチャンネル数・サンプルレートで、目標バイト数に収まる最大サンプル数（チャンクあたり）。 */
export function samplesPerChunk(
  sampleRate: number,
  channels: number,
  targetBytes: number,
): number {
  const bytesPerFrame = BYTES_PER_SAMPLE * Math.max(1, channels);
  const usableBytes = Math.max(targetBytes - WAV_HEADER_BYTES, bytesPerFrame);
  return Math.max(1, Math.floor(usableBytes / bytesPerFrame));
}

/** 総サンプル数を、chunkSamples ごとの [start, end) 範囲リストに分割する。 */
export function chunkRanges(totalSamples: number, chunkSamples: number): Array<[number, number]> {
  if (totalSamples <= 0 || chunkSamples <= 0) return [];
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < totalSamples; start += chunkSamples) {
    ranges.push([start, Math.min(start + chunkSamples, totalSamples)]);
  }
  return ranges;
}

function writeAsciiString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Float32 PCM（チャンネルごとの配列、同じ長さ）から 16bit PCM WAV の Blob を作る。 */
export function encodeWav(channelData: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channelData.length);
  const numFrames = channelData[0]?.length ?? 0;
  const bytesPerFrame = BYTES_PER_SAMPLE * numChannels;
  const dataSize = numFrames * bytesPerFrame;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmtチャンクサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true); // バイトレート
  view.setUint16(32, bytesPerFrame, true); // ブロックアライン
  view.setUint16(34, 16, true); // ビット深度
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** decodeAudioData 相当の関数が満たすべき最小限のインターフェース（テストでモック可能にする）。 */
export interface DecodableAudioBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * 音声を、targetBytes 以下の WAV チャンク配列に分割する。
 * file.size が maxBytes 以下ならそのまま [file] を返す（分割不要）。
 */
export async function chunkAudioIfNeeded(
  file: Blob,
  maxBytes: number,
  decodeAudio: (arrayBuffer: ArrayBuffer) => Promise<DecodableAudioBuffer>,
  targetChunkBytes: number = maxBytes,
): Promise<Blob[]> {
  if (file.size <= maxBytes) return [file];

  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await decodeAudio(arrayBuffer);
  const channels = Math.max(1, audioBuffer.numberOfChannels);
  const perChunk = samplesPerChunk(audioBuffer.sampleRate, channels, targetChunkBytes);
  const ranges = chunkRanges(audioBuffer.length, perChunk);

  if (ranges.length === 0) return [file];

  return ranges.map(([start, end]) => {
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      channelData.push(audioBuffer.getChannelData(ch).slice(start, end));
    }
    return encodeWav(channelData, audioBuffer.sampleRate);
  });
}

/**
 * 音声のデコード先サンプルレート。話し声の文字起こし用途には十分な品質で、
 * 元がこれより高いサンプルレート（44.1kHz等）でも変換してデータ量を抑える
 * （decodeAudioData はデバイスの既定サンプルレートにアップサンプルすることがあり、
 * 何もしないとファイルサイズがかえって膨らんでしまうため）。
 */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * ブラウザの AudioContext を使って音声データをデコードし、モノラル・
 * TARGET_SAMPLE_RATE に統一して返す（実機用）。
 */
export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<DecodableAudioBuffer> {
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('このブラウザは音声の分割処理に対応していません');
  }

  const ctx = new AudioContextCtor();
  let raw: AudioBuffer;
  try {
    // decodeAudioData は渡した ArrayBuffer を detach することがあるため複製して渡す
    raw = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }

  if (raw.sampleRate === TARGET_SAMPLE_RATE && raw.numberOfChannels === 1) {
    return raw;
  }

  // OfflineAudioContext でモノラル・TARGET_SAMPLE_RATE にリサンプルする
  const targetLength = Math.max(1, Math.ceil(raw.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = raw;
  source.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
}
