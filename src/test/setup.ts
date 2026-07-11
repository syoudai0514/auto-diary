import { beforeEach, vi } from 'vitest';

// テスト用の環境変数（実際のキーは使わない）
process.env.APP_PASSWORD = 'test-password-123';
process.env.AUTH_SECRET = 'test-secret-value-at-least-32-characters-long';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'gemini-2.0-flash';
process.env.GEMINI_TRANSCRIBE_MODEL = 'gemini-2.0-flash';

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
