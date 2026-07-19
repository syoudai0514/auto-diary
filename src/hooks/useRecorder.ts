'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderError = 'permission' | 'unsupported' | 'unknown' | null;

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  error: RecorderError;
}

/** MediaRecorder がサポートする最適な音声 mime を選ぶ。 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* noop */
    }
  }
  return undefined;
}

/** 拡張子を mime から推定（サーバーへ渡すファイル名用）。 */
export function extForMime(mime: string | undefined): string {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/** getUserMedia 例外を RecorderError 種別へ分類する（テスト可能な純関数）。 */
export function classifyRecorderError(err: unknown): Exclude<RecorderError, null> {
  // DOMException は環境により instanceof Error が false になるため name を直接読む
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  return 'unknown';
}

/** 録音に必要な API が使えるか。 */
export function hasRecorderSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

export interface RecorderOptions {
  /**
   * 録音中に一定間隔で「ここまでの音声」のBlobを渡す。
   * タブの強制終了・クラッシュ時にも直近の保存分まで音声を残すための救済用。
   * コールバック内で IndexedDB 等へ保存することを想定。
   */
  onPartial?: (blob: Blob) => void;
  /** onPartial の呼び出し間隔（ミリ秒。既定 15000）。 */
  partialIntervalMs?: number;
}

/**
 * ブラウザマイク録音フック。
 * 録音・一時停止・再開・停止（Blob取得）・経過時間・権限エラーを扱う。
 */
export function useRecorder(options?: RecorderOptions) {
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    elapsedMs: 0,
    error: null,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);
  const optionsRef = useRef<RecorderOptions | undefined>(options);
  optionsRef.current = options;
  const partialTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const clearPartialTimer = () => {
    if (partialTimerRef.current) {
      clearInterval(partialTimerRef.current);
      partialTimerRef.current = null;
    }
  };

  const startPartialTimer = useCallback(() => {
    clearPartialTimer();
    if (!optionsRef.current?.onPartial) return;
    const interval = optionsRef.current.partialIntervalMs ?? 15_000;
    partialTimerRef.current = setInterval(() => {
      const onPartial = optionsRef.current?.onPartial;
      if (!onPartial || chunksRef.current.length === 0) return;
      try {
        onPartial(new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' }));
      } catch {
        /* 部分保存の失敗は録音本体に影響させない */
      }
    }, interval);
  }, []);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startTick = useCallback(() => {
    clearTick();
    startedAtRef.current = Date.now();
    tickRef.current = setInterval(() => {
      const elapsed = accumulatedRef.current + (Date.now() - startedAtRef.current);
      setState((s) => ({ ...s, elapsedMs: elapsed }));
    }, 200);
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState({ status: 'idle', elapsedMs: 0, error: 'unsupported' });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
        stopTracks();
        resolveStopRef.current?.(blob);
        resolveStopRef.current = null;
      };
      recorderRef.current = rec;
      accumulatedRef.current = 0;
      rec.start(250);
      startTick();
      startPartialTimer();
      setState({ status: 'recording', elapsedMs: 0, error: null });
      return true;
    } catch (err: unknown) {
      stopTracks();
      setState({ status: 'idle', elapsedMs: 0, error: classifyRecorderError(err) });
      return false;
    }
  }, [startTick, startPartialTimer]);

  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.pause();
      accumulatedRef.current += Date.now() - startedAtRef.current;
      clearTick();
      setState((s) => ({ ...s, status: 'paused' }));
    }
  }, []);

  const resume = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'paused') {
      rec.resume();
      startTick();
      setState((s) => ({ ...s, status: 'recording' }));
    }
  }, [startTick]);

  /** 録音を停止し Blob を返す。 */
  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      clearTick();
      clearPartialTimer();
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      if (rec.state === 'recording') {
        accumulatedRef.current += Date.now() - startedAtRef.current;
      }
      resolveStopRef.current = resolve;
      setState((s) => ({ ...s, status: 'stopped', elapsedMs: accumulatedRef.current }));
      rec.stop();
    });
  }, []);

  /** 録音を破棄してリセット（Blob は返さない）。 */
  const cancel = useCallback(() => {
    clearTick();
    clearPartialTimer();
    const rec = recorderRef.current;
    resolveStopRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    stopTracks();
    chunksRef.current = [];
    accumulatedRef.current = 0;
    recorderRef.current = null;
    setState({ status: 'idle', elapsedMs: 0, error: null });
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle', elapsedMs: 0, error: null });
    accumulatedRef.current = 0;
  }, []);

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      clearTick();
      clearPartialTimer();
      stopTracks();
    };
  }, []);

  return {
    ...state,
    mimeType: mimeRef.current,
    start,
    pause,
    resume,
    stop,
    cancel,
    reset,
  };
}
