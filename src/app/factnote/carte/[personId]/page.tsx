'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CarteScreen, type AiSummaryState } from '@/components/screens/factnote/CarteScreen';
import { factnoteProfileSummaryApi } from '@/lib/factnote/api';
import {
  buildProfileSummary,
  carteTargetRecords,
  summaryFingerprint,
} from '@/lib/factnote/aggregate';
import { getMeta, getPerson, listRecords, profileSummaryCacheKey, setMeta } from '@/lib/factnote/db';
import type { IncidentRecord, PersonProfile, ReviewPeriod } from '@/lib/factnote/types';
import { ApiError } from '@/lib/api';

/** AIへ送る集計テキスト（本文・実名は含めない）。 */
function statsTextOf(summary: ReturnType<typeof buildProfileSummary>): string {
  const lines = [
    `対象期間: ${summary.period} / 記録 ${summary.totalRecords}件`,
    `衝突 ${summary.conflictCount}件 / 良い出来事 ${summary.positiveEventCount}件 / 修復行動 ${summary.repairActionCount}件`,
    `謝罪 ${summary.apologyCount}件 / 感謝 ${summary.gratitudeCount}件 / 強い言葉 ${summary.strongLanguageCount}件 / 子ども同席 ${summary.childPresentCount}件`,
  ];
  const list = (label: string, items: { label: string; count: number }[]) => {
    if (items.length > 0) lines.push(`${label}: ${items.map((i) => `${i.label}(${i.count}件)`).join(' / ')}`);
  };
  list('よく出るテーマ', summary.commonThemes.slice(0, 5));
  list('よく出る表現', summary.commonExpressions.slice(0, 5));
  list('衝突の状況', summary.conflictPatterns.slice(0, 5));
  list('利用者側のパターン', summary.userPatterns);
  list('相手側のパターン', summary.otherPartyPatterns);
  if (summary.dataBiasWarnings.length > 0) {
    lines.push(`偏り警告: ${summary.dataBiasWarnings.join(' / ')}`);
  }
  return lines.join('\n');
}

export default function CartePage() {
  const params = useParams<{ personId: string }>();
  const router = useRouter();
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [records, setRecords] = useState<IncidentRecord[]>([]);
  const [period, setPeriod] = useState<ReviewPeriod>('3_months');
  const [aiSummary, setAiSummary] = useState<AiSummaryState>({
    text: '',
    loading: false,
    error: null,
    fromCache: false,
  });

  useEffect(() => {
    if (!params?.personId) return;
    Promise.all([getPerson(params.personId), listRecords()]).then(([p, all]) => {
      if (!p) {
        router.push('/factnote/carte');
        return;
      }
      setPerson(p);
      setRecords(all);
    });
  }, [params?.personId, router]);

  const targetRecords = useMemo(
    () => (person ? carteTargetRecords(records, person, period) : []),
    [records, person, period],
  );
  const summary = useMemo(
    () => (person ? buildProfileSummary(records, person, period) : null),
    [records, person, period],
  );

  // キャッシュ済みのAI講評（同一の記録セットなら再利用 — 差分更新）
  useEffect(() => {
    if (!person) return;
    const key = profileSummaryCacheKey(person.id, period, summaryFingerprint(targetRecords));
    setAiSummary({ text: '', loading: false, error: null, fromCache: false });
    getMeta<string>(key).then((cached) => {
      if (cached) setAiSummary({ text: cached, loading: false, error: null, fromCache: true });
    });
    // targetRecords は records/person/period から導出されるため依存はこの3つで足りる
  }, [person, period, targetRecords]);

  async function generateSummary() {
    if (!person || !summary) return;
    setAiSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const { summary: text } = await factnoteProfileSummaryApi(statsTextOf(summary));
      const key = profileSummaryCacheKey(person.id, period, summaryFingerprint(targetRecords));
      await setMeta(key, text);
      setAiSummary({ text, loading: false, error: null, fromCache: false });
    } catch (e) {
      setAiSummary((s) => ({
        ...s,
        loading: false,
        error: e instanceof ApiError ? e.message : '講評の生成に失敗しました。',
      }));
    }
  }

  if (!person || !summary) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[14px] text-text-tertiary">
        読み込み中…
      </div>
    );
  }

  return (
    <CarteScreen
      person={person}
      summary={summary}
      targetRecords={targetRecords}
      period={period}
      onPeriodChange={setPeriod}
      aiSummary={aiSummary}
      onGenerateSummary={() => void generateSummary()}
    />
  );
}
