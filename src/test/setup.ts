import { beforeEach, vi } from 'vitest';

// テスト用の環境変数（実際のキーは使わない）
process.env.AUTH_SECRET = 'test-secret-value-at-least-32-characters-long';
process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
process.env.GEMINI_TRANSCRIBE_MODEL = 'gemini-3.1-flash-lite';
process.env.ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.INVITE_CODE = 'test-invite-code';

// jsdom には matchMedia が無いので最低限のスタブを用意
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
