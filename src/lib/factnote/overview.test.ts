import { describe, it, expect } from 'vitest';
import { buildMockAnalysis, buildMockOverallReviewPayload } from './fixtures';
import { applyAnalysisResult, createEmptyRecord, describeSourceType } from './newRecord';
import {
  analysisStatus,
  buildOverviewDigest,
  buildOverviewStats,
  estimateReanalysisMinutes,
  reanalysisTargets,
  recentMonths,
  resolveOverallReview,
} from './overview';
import { OverallReviewPayloadSchema } from './overallReview';
import { buildProfileSummary } from './aggregate';
import { createPersonFromName } from './persons';
import { INCIDENT_ANALYSIS_PROMPT_VERSION } from './prompts/incidentAnalysis';
import type { IncidentAnalysis, IncidentRecord, VerdictLeaning } from './types';

const NOW = new Date('2026-10-12T12:00:00Z');

function rec(daysAgo: number, patch: Partial<IncidentRecord> = {}): IncidentRecord {
  const at = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    ...createEmptyRecord('text', new Date(at)),
    id: patch.id ?? `r${daysAgo}`,
    occurredAt: at,
    rawText: '本文',
    people: [{ id: 'p1', displayName: '妻' }],
    ...patch,
  };
}

/** 最新基準の分析（判定を差し替えたもの）。 */
function v3(leaning: VerdictLeaning, patch: Partial<IncidentAnalysis> = {}): IncidentAnalysis {
  const base = buildMockAnalysis();
  return { ...base, verdict: { ...base.verdict!, leaning }, ...patch };
}

/** 旧基準（v2）の分析。判定も重さも持たない。 */
function legacy(): IncidentAnalysis {
  const base = buildMockAnalysis();
  return {
    ...base,
    verdict: undefined,
    promptVersion: 'v2',
    userImprovementPoints: base.userImprovementPoints.map(({ severity: _s, basis: _b, ...rest }) => rest),
    otherPartyProblemPoints: base.otherPartyProblemPoints.map(({ severity: _s, basis: _b, ...rest }) => rest),
    detectedPatterns: base.detectedPatterns.map(({ actor: _a, ...rest }) => rest),
  };
}

describe('判定基準のバージョンと再分析の対象', () => {
  it('analysisStatus は最新・旧基準・未分析を区別する（mock- 接頭辞は無視）', () => {
    expect(analysisStatus(rec(1))).toBe('none');
    expect(analysisStatus(rec(1, { analysis: legacy() }))).toBe('outdated');
    expect(analysisStatus(rec(1, { analysis: v3('user_more') }))).toBe('current');
    expect(
      analysisStatus(rec(1, { analysis: v3('comparable', { promptVersion: INCIDENT_ANALYSIS_PROMPT_VERSION }) })),
    ).toBe('current');
  });

  it("'outdated' は旧基準と未分析だけを古い順に返し、本文がない・処理中の記録は除く", () => {
    const records = [
      rec(1, { id: 'new-current', analysis: v3('user_more') }),
      rec(5, { id: 'old-legacy', analysis: legacy() }),
      rec(3, { id: 'none' }),
      rec(2, { id: 'empty', rawText: undefined }),
      rec(4, { id: 'busy', status: 'analyzing' }),
    ];
    expect(reanalysisTargets(records, 'outdated').map((r) => r.id)).toEqual(['old-legacy', 'none']);
    expect(reanalysisTargets(records, 'all').map((r) => r.id)).toEqual(['old-legacy', 'none', 'new-current']);
  });

  it('所要時間の目安は件数に比例し、0件は0分', () => {
    expect(estimateReanalysisMinutes(0)).toBe(0);
    expect(estimateReanalysisMinutes(1)).toBe(1);
    expect(estimateReanalysisMinutes(30)).toBe(10);
  });
});

describe('全体の集計', () => {
  it('判定の内訳と重さは最新基準の分析だけから数える（旧基準は判定に混ぜない）', () => {
    const records = [
      rec(1, { analysis: v3('other_mainly'), isConflict: true }),
      rec(2, { analysis: v3('other_more'), isConflict: true }),
      rec(3, { analysis: v3('user_more'), isConflict: true }),
      rec(4, { analysis: legacy(), isConflict: true }),
      rec(5, { analysis: v3('not_applicable'), isPositiveEvent: true }),
    ];
    const stats = buildOverviewStats(records, NOW);
    expect(stats.analyzedCurrent).toBe(4);
    expect(stats.analyzedOutdated).toBe(1);
    expect(stats.leaningCounts.other_mainly).toBe(1);
    expect(stats.leaningCounts.other_more).toBe(1);
    expect(stats.leaningCounts.user_more).toBe(1);
    expect(stats.leaningCounts.not_applicable).toBe(1);
    expect(stats.judgedConflicts).toBe(3);
    // モック分析は 自分側=中程度1 / 相手側=軽微1。最新基準4件ぶんだけ数える
    expect(stats.severity.user.moderate).toBe(4);
    expect(stats.severity.other.minor).toBe(4);
    expect(stats.conflicts).toBe(4);
    expect(stats.positives).toBe(1);
  });

  it('カルテ除外の記録は集計に含めない', () => {
    const stats = buildOverviewStats(
      [rec(1, { analysis: v3('user_more') }), rec(2, { excludeFromCarte: true, analysis: v3('other_more') })],
      NOW,
    );
    expect(stats.total).toBe(1);
    expect(stats.excluded).toBe(1);
    expect(stats.leaningCounts.other_more).toBe(0);
  });

  it('パターンは主体（actor）で自分側/相手側に振り分ける — 記録者の一般化表現を相手側に数えない', () => {
    const userGeneralizes = v3('user_more', {
      detectedPatterns: [
        {
          id: 'x',
          type: 'generalization',
          actor: 'user',
          label: '一般化表現',
          description: '記録者が「いつも」と言った',
          evidenceIds: [],
          confidence: 'high',
        },
      ],
    });
    const stats = buildOverviewStats([rec(1, { analysis: userGeneralizes })], NOW);
    expect(stats.userPatterns.map((p) => p.label)).toContain('一般化表現');
    expect(stats.otherPatterns).toHaveLength(0);

    // 旧データ（actor なし）は従来どおり種類から推定する
    const old = buildOverviewStats([rec(1, { analysis: legacy() })], NOW);
    expect(old.otherPatterns.map((p) => p.label)).toContain('一般化表現');
    expect(old.userPatterns.map((p) => p.label)).toContain('約束忘れ');

    // 客観カルテ側の集計も同じ規則
    const person = createPersonFromName('妻', NOW);
    const summary = buildProfileSummary([rec(1, { analysis: userGeneralizes })], person, 'all', NOW);
    expect(summary.otherPartyPatterns).toHaveLength(0);
    expect(summary.userPatterns).toHaveLength(1);
  });

  it('月ごとの推移は直近6か月を古い順に、判定の向きも数える', () => {
    expect(recentMonths(NOW, 3)).toEqual(['2026-08', '2026-09', '2026-10']);
    const stats = buildOverviewStats(
      [
        rec(1, { analysis: v3('other_mainly'), isConflict: true }),
        rec(2, { analysis: v3('user_mainly'), isConflict: true }),
        rec(400, { isConflict: true }),
      ],
      NOW,
    );
    expect(stats.monthly).toHaveLength(6);
    const oct = stats.monthly[stats.monthly.length - 1];
    expect(oct.month).toBe('2026-10');
    expect(oct.conflicts).toBe(2);
    expect(oct.otherHeavier).toBe(1);
    expect(oct.userHeavier).toBe(1);
  });

  it('指紋は記録の更新で変わる（全体の見解の「更新できます」判定）', () => {
    const a = rec(1, { analysis: v3('user_more') });
    const s1 = buildOverviewStats([a], NOW).fingerprint;
    const s2 = buildOverviewStats([{ ...a, updatedAt: new Date().toISOString() }], NOW).fingerprint;
    expect(s1).not.toBe(s2);
  });
});

describe('AI総評へ渡すダイジェスト', () => {
  it('記録の本文は含めず、判定・重さ・番号付きの要約を古い順に並べる', () => {
    const records = [
      rec(1, { id: 'b', title: '新しい記録', rawText: '本文の秘密の語句', analysis: v3('other_more') }),
      rec(9, { id: 'a', title: '古い記録', rawText: '本文の秘密の語句', analysis: legacy() }),
      rec(3, { id: 'c', title: '未分析' }),
    ];
    const stats = buildOverviewStats(records, NOW);
    const digest = buildOverviewDigest(records, stats);
    expect(digest.text).not.toContain('秘密の語句');
    expect(digest.refs).toEqual(['a', 'b']);
    expect(digest.text).toContain('#1');
    expect(digest.text).toContain('古い記録');
    expect(digest.text).toContain('旧基準の分析・判定なし');
    expect(digest.text).toContain('判定: 相手側がやや重い');
    expect(digest.text).toContain('(中程度)');
    expect(digest.text).not.toContain('未分析［');
  });

  it('上限を超えたら新しい記録だけを列挙し、その旨を書く', () => {
    const records = Array.from({ length: 5 }, (_, i) => rec(i + 1, { id: `r${i}`, analysis: v3('user_more') }));
    const digest = buildOverviewDigest(records, buildOverviewStats(records, NOW), 2);
    expect(digest.includedCount).toBe(2);
    expect(digest.refs).toEqual(['r1', 'r0']);
    expect(digest.text).toContain('新しい 2件だけ');
  });
});

describe('AI総評の後処理', () => {
  it('#番号を記録IDへ変換し、範囲外の番号と重複を捨て、件数上限を守る', () => {
    const payload = OverallReviewPayloadSchema.parse(buildMockOverallReviewPayload());
    payload.userRecurringIssues[0].refs = [1, 1, 2, 99, 0];
    payload.userFocus = ['a', 'b', 'c', 'd', ' '];
    const review = resolveOverallReview(payload, {
      refs: ['rec-a', 'rec-b'],
      aiModel: 'm',
      promptVersion: 'v1',
      fingerprint: 'fp',
      includedCount: 2,
      outdatedCount: 0,
      now: NOW,
    });
    expect(review.userRecurringIssues[0].recordIds).toEqual(['rec-a', 'rec-b']);
    expect(review.otherRecurringIssues[0].suggestion).toContain('その日の件に限定');
    expect(review.interactionCycle).toContain('止められます');
    expect(review.userFocus).toEqual(['a', 'b', 'c']);
    expect(review.fingerprint).toBe('fp');
    expect(review.generatedAt).toBe(NOW.toISOString());
  });

  it('直し方・悪循環が欠けた応答（旧形式）でも受け入れる', () => {
    const raw = buildMockOverallReviewPayload() as Record<string, unknown>;
    delete raw.interactionCycle;
    (raw.otherRecurringIssues as Array<Record<string, unknown>>).forEach((i) => delete i.suggestion);
    const parsed = OverallReviewPayloadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const review = resolveOverallReview(parsed.data, {
        refs: ['a'],
        aiModel: 'm',
        promptVersion: 'v2',
        fingerprint: 'f',
        includedCount: 1,
        outdatedCount: 0,
      });
      expect(review.interactionCycle).toBeUndefined();
      expect(review.otherRecurringIssues[0].suggestion).toBeUndefined();
    }
  });

  it('傾向の値が想定外でも「判断材料が不足」に寄せて全体は受け入れる', () => {
    const raw = { ...buildMockOverallReviewPayload(), relationshipTrend: 'great', responsibilityTendency: '??' };
    const parsed = OverallReviewPayloadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.relationshipTrend).toBe('insufficient_data');
      expect(parsed.data.responsibilityTendency).toBe('insufficient_data');
    }
  });
});

describe('再分析時の記録への反映', () => {
  it('直前の分析を previousAnalysis に1世代だけ残す', () => {
    const first = rec(1, { analysis: legacy() });
    const next = applyAnalysisResult(first, {
      analysis: v3('user_more'),
      title: 't',
      isConflict: true,
      isPositiveEvent: false,
      isRepairAction: false,
    });
    expect(next.previousAnalysis?.promptVersion).toBe('v2');
    expect(next.analysis?.verdict?.leaning).toBe('user_more');
    const third = applyAnalysisResult(next, {
      analysis: v3('other_more'),
      title: 't',
      isConflict: true,
      isPositiveEvent: false,
      isRepairAction: false,
    });
    expect(third.previousAnalysis?.verdict?.leaning).toBe('user_more');
  });

  it('記録の形式をAIへ伝える（録音なら双方の発言、文章なら相手の発言は記憶）', () => {
    expect(describeSourceType({ sourceType: 'voice_recording', transcript: 'A: …' })).toContain('録音の文字起こし');
    expect(describeSourceType({ sourceType: 'text' })).toContain('記録者の記憶');
    expect(describeSourceType({ sourceType: 'voice_recording' })).toContain('記録者が書いた文章');
  });
});
