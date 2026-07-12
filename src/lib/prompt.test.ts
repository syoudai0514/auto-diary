import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

describe('buildSystemPrompt', () => {
  it('絶対に守るルールが含まれる', () => {
    const p = buildSystemPrompt('natural');
    expect(p).toContain('話していない事実を追加しない');
    expect(p).toContain('一人称');
  });

  it('文体ごとに異なる指示が入る', () => {
    expect(buildSystemPrompt('factual')).toContain('事実中心の記録');
    expect(buildSystemPrompt('summary')).toContain('短い要約');
  });

  it('peopleContext 未指定なら補足セクションを含まない', () => {
    const p = buildSystemPrompt('natural');
    expect(p).not.toContain('書き手・登場人物についての補足情報');
  });

  it('peopleContext を指定すると補足セクションに本文が含まれる', () => {
    const ctx = '私は4人家族の父です。妻はママ、子どもは長男・長女と呼びます。';
    const p = buildSystemPrompt('natural', ctx);
    expect(p).toContain('書き手・登場人物についての補足情報');
    expect(p).toContain(ctx);
    expect(p).toContain('勝手に作り出したり');
  });

  it('peopleContext が空白のみなら補足セクションを含まない', () => {
    const p = buildSystemPrompt('natural', '   ');
    expect(p).not.toContain('書き手・登場人物についての補足情報');
  });

  it('peopleContext の前後の空白はトリムされる', () => {
    const p = buildSystemPrompt('natural', '  4人家族の父  ');
    expect(p).toContain('----- 補足情報ここから -----\n4人家族の父\n----- 補足情報ここまで -----');
  });
});

describe('buildUserPrompt', () => {
  it('文字起こしをそのまま含める', () => {
    const p = buildUserPrompt('今日は散歩した');
    expect(p).toContain('今日は散歩した');
    expect(p).toContain('文字起こしここから');
  });
});
