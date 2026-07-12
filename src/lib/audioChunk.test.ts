// @vitest-environment node
// jsdomのBlobはarrayBuffer()を実装していないため、Node組み込みのBlob/実装で検証する
// （実ブラウザのBlobは仕様通りarrayBuffer()を持つため、本番コードには影響しない）。
import { describe, it, expect } from 'vitest';
import {
  samplesPerChunk,
  chunkRanges,
  encodeWav,
  chunkAudioIfNeeded,
  type DecodableAudioBuffer,
} from './audioChunk';

describe('samplesPerChunk', () => {
  it('モノラル16kHzで妥当なサンプル数を返す', () => {
    // 16kHz mono 16bit: 32000 bytes/sec。目標3.5MBなら約109秒ぶん
    const n = samplesPerChunk(16000, 1, 3.5 * 1024 * 1024);
    expect(n).toBeGreaterThan(16000 * 100); // 100秒以上
    expect(n).toBeLessThan(16000 * 120); // 120秒未満
  });

  it('チャンネル数が多いほどサンプル数は減る', () => {
    const mono = samplesPerChunk(44100, 1, 1024 * 1024);
    const stereo = samplesPerChunk(44100, 2, 1024 * 1024);
    expect(stereo).toBeLessThan(mono);
  });

  it('極端に小さい目標バイト数でも最低1サンプルは返す', () => {
    expect(samplesPerChunk(44100, 2, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe('chunkRanges', () => {
  it('総サンプル数をchunkSamplesごとに分割する', () => {
    expect(chunkRanges(100, 30)).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
      [90, 100],
    ]);
  });

  it('ちょうど割り切れる場合、余りの空チャンクを作らない', () => {
    expect(chunkRanges(90, 30)).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
  });

  it('総サンプル数が0以下なら空配列', () => {
    expect(chunkRanges(0, 30)).toEqual([]);
    expect(chunkRanges(-1, 30)).toEqual([]);
  });

  it('chunkSamplesが0以下でも例外を投げず空配列を返す', () => {
    expect(chunkRanges(100, 0)).toEqual([]);
  });
});

describe('encodeWav', () => {
  it('正しいWAVヘッダーを書き込む', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav([samples], 16000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const text = (offset: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, offset, len));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2);
  });

  it('ステレオでは1フレームあたり4バイト（2ch×16bit）になる', async () => {
    const left = new Float32Array([0.1, 0.2]);
    const right = new Float32Array([-0.1, -0.2]);
    const blob = encodeWav([left, right], 44100);
    expect(blob.size).toBe(44 + 2 * 4);
  });

  it('サンプル値は -1..1 にクランプされる', async () => {
    const samples = new Float32Array([2, -2]);
    const blob = encodeWav([samples], 8000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

/** テスト用の疑似 AudioBuffer。 */
function fakeAudioBuffer(opts: {
  sampleRate: number;
  channels: Float32Array[];
}): DecodableAudioBuffer {
  return {
    numberOfChannels: opts.channels.length,
    sampleRate: opts.sampleRate,
    length: opts.channels[0]?.length ?? 0,
    getChannelData: (ch: number) => opts.channels[ch],
  };
}

describe('chunkAudioIfNeeded', () => {
  it('ファイルサイズが上限以下ならそのまま1つのBlobを返す（分割しない）', async () => {
    const file = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const decode = async () => {
      throw new Error('デコードは呼ばれないはず');
    };
    const result = await chunkAudioIfNeeded(file, 1000, decode);
    expect(result).toEqual([file]);
  });

  it('上限を超える場合はデコードして複数のWAVチャンクに分割する', async () => {
    const file = new Blob([new Uint8Array(2000)], { type: 'audio/webm' });
    // 16kHz mono, 5秒ぶん(80000サンプル) → 小さい目標バイト数で複数チャンクに分かれるはず
    const samples = new Float32Array(80000);
    const decode = async () => fakeAudioBuffer({ sampleRate: 16000, channels: [samples] });

    const chunks = await chunkAudioIfNeeded(file, 1000, decode, 20000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.type).toBe('audio/wav');
      expect(c.size).toBeLessThanOrEqual(20000 + 100); // ヘッダー分の余裕
    }
  });

  it('分割後の総サンプル数は元の長さと一致する', async () => {
    const file = new Blob([new Uint8Array(2000)], { type: 'audio/webm' });
    const samples = new Float32Array(50000).map((_, i) => Math.sin(i));
    const decode = async () => fakeAudioBuffer({ sampleRate: 16000, channels: [samples] });

    const chunks = await chunkAudioIfNeeded(file, 1000, decode, 30000);
    const totalDataBytes = chunks.reduce((sum, c) => sum + (c.size - 44), 0);
    expect(totalDataBytes).toBe(samples.length * 2); // 16bit mono
  });

  it('ステレオ音声でもチャンネルごとに正しく分割される', async () => {
    const file = new Blob([new Uint8Array(2000)]);
    const left = new Float32Array(1000).fill(0.5);
    const right = new Float32Array(1000).fill(-0.5);
    const decode = async () => fakeAudioBuffer({ sampleRate: 8000, channels: [left, right] });

    const chunks = await chunkAudioIfNeeded(file, 1000, decode, 500);
    expect(chunks.length).toBeGreaterThan(1);
    // 各チャンクは 4 バイト/フレーム（2ch×16bit）の倍数になっているはず
    for (const c of chunks) {
      expect((c.size - 44) % 4).toBe(0);
    }
  });
});
