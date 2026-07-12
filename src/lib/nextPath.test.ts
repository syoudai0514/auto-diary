import { describe, it, expect } from 'vitest';
import { safeNextPath } from './nextPath';

describe('safeNextPath（オープンリダイレクト対策）', () => {
  it('同一オリジンの絶対パスはそのまま返す', () => {
    expect(safeNextPath('/settings')).toBe('/settings');
  });

  it('クエリ・ハッシュ付きのパスも維持される', () => {
    expect(safeNextPath('/settings?tab=1#section')).toBe('/settings?tab=1#section');
  });

  it('未指定・空文字は / を返す', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it('プロトコル相対URL（//evil.example）は / にフォールバックする', () => {
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('//evil.example/path')).toBe('/');
  });

  it('別オリジンの絶対URLは / にフォールバックする', () => {
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('http://evil.example/steal')).toBe('/');
  });

  it('相対パスでない不正な文字列は / にフォールバックする', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });
});
