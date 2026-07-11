import { beforeEach, vi } from 'vitest';

// テスト用の環境変数（実際のキーは使わない）
process.env.APP_PASSWORD = 'test-password-123';
process.env.AUTH_SECRET = 'test-secret-value-at-least-32-characters-long';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_MODEL = 'gpt-4o-mini';
process.env.TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

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
