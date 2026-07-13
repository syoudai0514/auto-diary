import { describe, it, expect } from 'vitest';
import {
  buildPastComparison,
  buildProfileSummary,
  carteTargetRecords,
  conflictsOnSameDay,
  detectDataBias,
  filterByPeriod,
  flatCheckPastRecords,
  personMatchesRecord,
  summaryFingerprint,
} from './aggregate';
import { createEmptyRecord } from './newRecord';
import { createPersonFromName, mergePersons, splitAlias, suggestMerges, unassignedNames } from './persons';
import { buildMockAnalysis } from './fixtures';
import { matchMemos, dueReminders, nextMorning, MEMO_TEMPLATES } from './memoMatch';
import type { FutureSelfMemo, IncidentRecord, PersonProfile } from './types';

const NOW = new Date('2026-07-13T12:00:00Z');

function rec(daysAgo: number, patch: Partial<IncidentRecord> = {}): IncidentRecord {
  const at = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    ...createEmptyRecord('text', new Date(at)),
    id: patch.id ?? `r${daysAgo}_${Math.random().toString(36).slice(2, 6)}`,
    occurredAt: at,
    people: [{ id: 'p1', displayName: '妻' }],
    ...patch,
  };
}

function person(name: string, aliases: string[] = []): PersonProfile {
  return { ...createPersonFromName(name, NOW), aliases };
}

describe('期間・人物フィルタ', () => {
  it('filterByPeriod は期間内の記録だけ返す', () => {
    const records = [rec(1), rec(20), rec(100)];
    expect(filterByPeriod(records, '7_days', NOW)).toHaveLength(1);
    expect(filterByPeriod(records, '30_days', NOW)).toHaveLength(2);
    expect(filterByPeriod(records, 'all', NOW)).toHaveLength(3);
  });

  it('personMatchesRecord は別名でも照合する', () => {
    const p = person('妻', ['ママ']);
    expect(personMatchesRecord(p, rec(1))).toBe(true);
    expect(
      personMatchesRecord(p, rec(1, { people: [{ id: 'x', displayName: 'ママ' }] })),
    ).toBe(true);
    expect(
      personMatchesRecord(p, rec(1, { people: [{ id: 'x', displayName: '上司' }] })),
    ).toBe(false);
  });

  it('carteTargetRecords は除外フラグ付きを集計しない', () => {
    const p = person('妻');
    const records = [rec(1), rec(2, { excludeFromCarte: true })];
    expect(carteTargetRecords(records, p, '30_days', NOW)).toHaveLength(1);
  });
});

describe('客観カルテのローカル集計', () => {
  const p = person('妻');
  const records = [
    rec(1, { isConflict: true, rawText: 'いつも全部わたしがやる、と言われた。車内で疲れていた。', emotions: ['疲労'] }),
    rec(3, { isConflict: true, rawText: '生活費の精算でまた揉めた', childrenPresent: 'yes' }),
    rec(5, { isPositiveEvent: true, isRepairAction: true, rawText: '帰りの運転を代わってくれて助かった。ありがとうと伝えた', analysis: buildMockAnalysis() }),
    rec(7, { rawText: '受け取りを忘れてごめんと謝った', analysis: buildMockAnalysis() }),
  ];

  it('件数集計が正しい', () => {
    const s = buildProfileSummary(records, p, '30_days', NOW);
    expect(s.totalRecords).toBe(4);
    expect(s.conflictCount).toBe(2);
    expect(s.positiveEventCount).toBe(1);
    expect(s.repairActionCount).toBe(1);
    expect(s.gratitudeCount).toBe(1);
    expect(s.apologyCount).toBe(1);
    expect(s.childPresentCount).toBe(1);
  });

  it('テーマ・表現・衝突パターンを抽出する', () => {
    const s = buildProfileSummary(records, p, '30_days', NOW);
    expect(s.commonThemes.some((t) => t.label === 'お金')).toBe(true);
    expect(s.commonExpressions.some((e) => e.label === '「いつも」')).toBe(true);
    const car = s.conflictPatterns.find((c) => c.label === '車内');
    expect(car?.count).toBe(1);
  });

  it('自分側・相手側のパターンを分けて集計する', () => {
    const s = buildProfileSummary(records, p, '30_days', NOW);
    // buildMockAnalysis は generalization（相手側）と forgotten_promise（自分側）を含む
    expect(s.otherPartyPatterns.some((x) => x.label === '一般化表現')).toBe(true);
    expect(s.userPatterns.some((x) => x.label === '約束忘れ')).toBe(true);
  });

  it('少ない件数では判断材料不足の警告が出る', () => {
    const s = buildProfileSummary(records, p, '30_days', NOW);
    expect(s.dataBiasWarnings.some((w) => w.includes('十分ではありません'))).toBe(true);
  });
});

describe('記録の偏り検出', () => {
  it('衝突ばかりで良い出来事がないと警告する', () => {
    const records = [0, 1, 2, 3, 4, 5].map((d) => rec(d, { isConflict: true }));
    expect(detectDataBias(records).some((w) => w.includes('衝突した出来事が中心'))).toBe(true);
  });

  it('良い出来事が混ざっていれば衝突中心の警告は出ない', () => {
    const records = [
      ...[0, 1, 2].map((d) => rec(d, { isConflict: true })),
      ...[3, 4, 5].map((d) => rec(d, { isPositiveEvent: true })),
    ];
    expect(detectDataBias(records).some((w) => w.includes('衝突した出来事が中心'))).toBe(false);
  });
});

describe('フラットチェックの範囲と過去比較', () => {
  it('current_only は過去記録なし、期間指定は現在の記録を除外して返す', () => {
    const current = rec(0, { id: 'current' });
    const records = [current, rec(2), rec(40)];
    expect(flatCheckPastRecords(records, 'current', 'current_only', NOW)).toHaveLength(0);
    const past7 = flatCheckPastRecords(records, 'current', 'current_and_7_days', NOW);
    expect(past7).toHaveLength(1);
    expect(past7[0].id).not.toBe('current');
    expect(flatCheckPastRecords(records, 'current', 'current_and_all', NOW)).toHaveLength(2);
  });

  it('過去比較は件数と根拠記録IDを持つ', () => {
    const past = [
      rec(1, { rawText: 'いつも全部と言われた', analysis: buildMockAnalysis() }),
      rec(2, { isRepairAction: true }),
      rec(3, { isPositiveEvent: true }),
    ];
    const items = buildPastComparison(past);
    const repair = items.find((i) => i.id === 'pc_repair');
    expect(repair?.count).toBe(1);
    expect(repair?.recordIds).toHaveLength(1);
    expect(items.some((i) => i.label.includes('いつも'))).toBe(true);
  });

  it('summaryFingerprint は記録の更新で変わる', () => {
    const a = rec(1, { id: 'a' });
    const f1 = summaryFingerprint([a]);
    const f2 = summaryFingerprint([{ ...a, updatedAt: new Date().toISOString() }]);
    expect(f1).not.toBe(f2);
    expect(summaryFingerprint([a])).toBe(f1);
  });
});

describe('人物管理', () => {
  it('未登録の名前を列挙し、人物を作成できる', () => {
    const records = [rec(1), rec(2, { people: [{ id: 'x', displayName: '上司' }] })];
    const persons = [person('妻')];
    expect(unassignedNames(records, persons)).toEqual(['上司']);
  });

  it('統合で別名が引き継がれ、照合できる', () => {
    const keep = person('妻');
    const merge = person('ママ', ['奥さん']);
    const merged = mergePersons(keep, merge, NOW);
    expect(merged.aliases).toEqual(expect.arrayContaining(['ママ', '奥さん']));
    expect(merged.mergedPersonIds).toContain(merge.id);
    expect(personMatchesRecord(merged, rec(1, { people: [{ id: 'x', displayName: '奥さん' }] }))).toBe(true);
  });

  it('分離で別名が独立した人物になる', () => {
    const p = person('妻', ['ママ']);
    const [updated, split] = splitAlias(p, 'ママ', NOW);
    expect(updated.aliases).toEqual([]);
    expect(split.displayName).toBe('ママ');
  });

  it('同義語グループから統合候補を提示する（確定しない）', () => {
    const suggestions = suggestMerges([person('妻'), person('ママ'), person('上司')]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toContain('同じ人物ですか');
  });
});

describe('未来の自分からのメモ: 表示条件', () => {
  function memo(patch: Partial<FutureSelfMemo>): FutureSelfMemo {
    return {
      id: 'm1',
      title: 't',
      body: 'b',
      triggers: [],
      priority: 1,
      isEnabled: true,
      source: 'user_written',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      ...patch,
    };
  }

  it('強い言葉・感情・離婚語句で一致する', () => {
    const m = memo({ triggers: [{ type: 'strong_language' }] });
    expect(matchMemos([m], { text: '死んでほしいと言われた', now: NOW })).toHaveLength(1);
    expect(matchMemos([m], { text: '穏やかな一日', now: NOW })).toHaveLength(0);

    const anger = memo({ triggers: [{ type: 'anger' }] });
    expect(matchMemos([anger], { emotions: ['怒り'], now: NOW })).toHaveLength(1);

    const divorce = memo({ triggers: [{ type: 'divorce_keyword' }] });
    expect(matchMemos([divorce], { text: 'もう離婚したい', now: NOW })).toHaveLength(1);
  });

  it('深夜条件は22時以降に一致する', () => {
    const m = memo({ triggers: [{ type: 'late_night' }] });
    const night = new Date('2026-07-13T23:00:00');
    const noon = new Date('2026-07-13T12:00:00');
    expect(matchMemos([m], { now: night })).toHaveLength(1);
    expect(matchMemos([m], { now: noon })).toHaveLength(0);
  });

  it('同日複数衝突・偏り警告の条件が動く', () => {
    const multi = memo({ triggers: [{ type: 'multiple_conflicts_same_day' }] });
    expect(matchMemos([multi], { conflictsToday: 2, now: NOW })).toHaveLength(1);
    expect(matchMemos([multi], { conflictsToday: 1, now: NOW })).toHaveLength(0);

    const bias = memo({ triggers: [{ type: 'data_bias_warning' }] });
    expect(matchMemos([bias], { hasBiasWarning: true, now: NOW })).toHaveLength(1);
  });

  it('無効化したメモと直近表示済みのメモは表示されない', () => {
    const disabled = memo({ triggers: [{ type: 'anger' }], isEnabled: false });
    expect(matchMemos([disabled], { emotions: ['怒り'], now: NOW })).toHaveLength(0);

    const shown = memo({
      triggers: [{ type: 'anger' }],
      lastShownAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    });
    expect(matchMemos([shown], { emotions: ['怒り'], now: NOW })).toHaveLength(0);
  });

  it('優先度の高い順に返す', () => {
    const low = memo({ id: 'low', priority: 1, triggers: [{ type: 'anger' }] });
    const high = memo({ id: 'high', priority: 5, triggers: [{ type: 'anger' }] });
    const matched = matchMemos([low, high], { emotions: ['怒り'], now: NOW });
    expect(matched.map((m) => m.id)).toEqual(['high', 'low']);
  });

  it('明日の朝の再表示予約と期限判定', () => {
    const at = nextMorning(new Date('2026-07-13T23:30:00'));
    expect(at.startsWith('2026-07-14')).toBe(true);
    const m = memo({ remindAt: new Date(NOW.getTime() - 1000).toISOString() });
    expect(dueReminders([m], NOW)).toHaveLength(1);
    expect(dueReminders([memo({ remindAt: undefined })], NOW)).toHaveLength(0);
  });

  it('テンプレートは5種類あり本文とトリガーを持つ', () => {
    expect(MEMO_TEMPLATES).toHaveLength(5);
    for (const t of MEMO_TEMPLATES) {
      expect(t.title).toBeTruthy();
      expect(t.body.length).toBeGreaterThan(20);
      expect(t.triggers.length).toBeGreaterThan(0);
    }
  });
});

describe('同日衝突カウント', () => {
  it('同じ日の衝突だけ数える', () => {
    const records = [
      rec(0, { isConflict: true }),
      rec(0, { isConflict: true }),
      rec(1, { isConflict: true }),
      rec(0, { isPositiveEvent: true }),
    ];
    expect(conflictsOnSameDay(records, NOW)).toBe(2);
  });
});
