import { describe, it, expect } from 'vitest';
import type { Diary } from './diary';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildProfileUpdateSystemPrompt,
  buildProfileUpdateUserPrompt,
  buildReviseSystemPrompt,
  buildReviseUserPrompt,
  buildTalkTranscribePrompt,
  buildTalkAnalysisSystemPrompt,
  buildTalkAnalysisUserPrompt,
} from './prompt';

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

describe('buildProfileUpdateSystemPrompt', () => {
  it('Markdownのみ出力・情報保持・捏造禁止のルールを含む', () => {
    const p = buildProfileUpdateSystemPrompt();
    expect(p).toContain('Markdown');
    expect(p).toContain('保持する');
    expect(p).toContain('捏造しない');
  });
});

describe('buildProfileUpdateUserPrompt', () => {
  it('現在のプロフィールと新しい入力を両方含める', () => {
    const p = buildProfileUpdateUserPrompt('## 家族構成\n- 妻', '子どもが生まれました');
    expect(p).toContain('## 家族構成\n- 妻');
    expect(p).toContain('子どもが生まれました');
  });

  it('現在のプロフィールが空でも壊れない', () => {
    const p = buildProfileUpdateUserPrompt('', '私は父です');
    expect(p).toContain('まだ何も登録されていません');
    expect(p).toContain('私は父です');
  });

  it('前後の空白はトリムされる', () => {
    const p = buildProfileUpdateUserPrompt('  既存  ', '  新規  ');
    expect(p).toContain('----- 現在のプロフィールここから -----\n既存\n');
    expect(p).toContain('----- 新しい情報ここから -----\n新規\n');
  });
});

const sampleDiary: Diary = {
  title: '元のタイトル',
  body: '元の本文',
  facts: ['散歩した'],
  feelings: ['楽しかった'],
  interpretations: [],
  nextActions: [],
  tags: ['散歩'],
  rawTranscript: '元の文字起こし',
};

describe('buildReviseSystemPrompt', () => {
  it('修正依頼に従うこと・無関係な部分は保持することを明示する', () => {
    const p = buildReviseSystemPrompt('natural');
    expect(p).toContain('修正依頼');
    expect(p).toContain('保つ');
    expect(p).toContain('基づかない内容を、勝手に追加・推測しない');
  });

  it('文体ごとに異なる指示が入る', () => {
    expect(buildReviseSystemPrompt('emotion')).toContain('感情整理');
    expect(buildReviseSystemPrompt('summary')).toContain('短い要約');
  });

  it('peopleContext を指定すると補足セクションが含まれる', () => {
    const p = buildReviseSystemPrompt('natural', '私は父です');
    expect(p).toContain('書き手・登場人物についての補足情報');
    expect(p).toContain('私は父です');
  });

  it('peopleContext 未指定なら補足セクションを含まない', () => {
    expect(buildReviseSystemPrompt('natural')).not.toContain('書き手・登場人物についての補足情報');
  });
});

describe('buildReviseUserPrompt', () => {
  it('文字起こし・現在の日記・修正依頼をすべて含める', () => {
    const p = buildReviseUserPrompt('元の文字起こし', sampleDiary, 'もっと明るいトーンにして');
    expect(p).toContain('元の文字起こし');
    expect(p).toContain('元のタイトル');
    expect(p).toContain('元の本文');
    expect(p).toContain('もっと明るいトーンにして');
  });

  it('修正依頼の前後の空白はトリムされる', () => {
    const p = buildReviseUserPrompt('t', sampleDiary, '  短くして  ');
    expect(p).toContain('----- 修正依頼ここから -----\n短くして\n----- 修正依頼ここまで -----');
  });
});

describe('buildTalkTranscribePrompt', () => {
  it('話者分離と正確な書き起こしを指示する', () => {
    const p = buildTalkTranscribePrompt();
    expect(p).toContain('A: ');
    expect(p).toContain('B: ');
    expect(p).toContain('推測で補わない');
    expect(p).toContain('最初に発言した人物をA');
  });
});

describe('buildTalkAnalysisSystemPrompt', () => {
  it('率直な判定と行動単位の評価・安全配慮を含む', () => {
    const p = buildTalkAnalysisSystemPrompt();
    expect(p).toContain('率直');
    expect(p).toContain('「どちらも悪い」で濁さない');
    expect(p).toContain('人格・性格を断定しない');
    expect(p).toContain('暴力・脅迫');
    expect(p).toContain('safetyNote');
  });

  it('peopleContext を渡すと補足情報セクションが入る', () => {
    const p = buildTalkAnalysisSystemPrompt('私は父です。');
    expect(p).toContain('私は父です。');
  });

  it('peopleContext 未指定なら補足情報セクションは入らない', () => {
    const p = buildTalkAnalysisSystemPrompt();
    expect(p).not.toContain('書き手・登場人物についての補足情報');
  });
});

describe('buildTalkAnalysisUserPrompt', () => {
  it('話者名と文字起こしを含む', () => {
    const p = buildTalkAnalysisUserPrompt('A: おはよう\nB: おはよう', '私', '妻');
    expect(p).toContain('話者Aは「私」');
    expect(p).toContain('話者Bは「妻」');
    expect(p).toContain('A: おはよう');
  });

  it('話者名の前後の空白はトリムされる', () => {
    const p = buildTalkAnalysisUserPrompt('t', '  私  ', ' 夫 ');
    expect(p).toContain('話者Aは「私」');
    expect(p).toContain('話者Bは「夫」');
  });
});
