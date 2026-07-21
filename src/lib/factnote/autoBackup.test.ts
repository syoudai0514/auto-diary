import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { maybeAutoBackup, supportsDirectoryAutoBackup } from './autoBackup';

describe('フォルダ自動保存', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('非対応ブラウザでは supportsDirectoryAutoBackup が false', () => {
    // jsdom の window に showDirectoryPicker は無い
    expect(supportsDirectoryAutoBackup()).toBe(false);
  });

  it('非対応ブラウザでは maybeAutoBackup が unsupported を返す（何も書き込まない）', async () => {
    expect(await maybeAutoBackup()).toBe('unsupported');
  });

  it('対応ブラウザでもフォルダ未設定なら no_dir を返す', async () => {
    vi.stubGlobal('window', {
      ...globalThis.window,
      showDirectoryPicker: () => Promise.resolve({ name: 'x' }),
    });
    expect(supportsDirectoryAutoBackup()).toBe(true);
    expect(await maybeAutoBackup()).toBe('no_dir');
  });
});
