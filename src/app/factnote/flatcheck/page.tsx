'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FlatCheckResultScreen,
  FlatCheckScopeScreen,
} from '@/components/screens/factnote/FlatCheckScreen';
import { markMemoShown } from '@/components/screens/factnote/FutureMemoCard';
import { ErrorScreen, ProcessingScreen } from '@/components/screens/StatusScreens';
import { ApiError } from '@/lib/api';
import { withRetryOn429 } from '@/lib/retry';
import { factnoteFlatCheckApi } from '@/lib/factnote/api';
import {
  buildPastComparison,
  conflictsOnSameDay,
  detectDataBias,
  flatCheckPastRecords,
  personMatchesRecord,
} from '@/lib/factnote/aggregate';
import {
  getRecord,
  listFlatChecks,
  listFutureMemos,
  listPersons,
  listRecords,
  newFactnoteId,
  saveFlatCheck,
} from '@/lib/factnote/db';
import { pastStatsText } from '@/lib/factnote/flatCheck';
import { analysisSummaryForDiary } from '@/lib/factnote/generateFactnoteDiary';
import { matchMemos } from '@/lib/factnote/memoMatch';
import { sourceTextOf } from '@/lib/factnote/newRecord';
import type {
  FlatCheckResult,
  FlatCheckScope,
  FutureSelfMemo,
  IncidentRecord,
} from '@/lib/factnote/types';

export default function FlatCheckPage() {
  return (
    <Suspense>
      <FlatCheckFlow />
    </Suspense>
  );
}

type Step = 'loading' | 'scope' | 'running' | 'result' | 'error';

function FlatCheckFlow() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const recordId = searchParams.get('recordId') ?? '';

  const [step, setStep] = useState<Step>('loading');
  const [record, setRecord] = useState<IncidentRecord | null>(null);
  const [allRecords, setAllRecords] = useState<IncidentRecord[]>([]);
  const [result, setResult] = useState<FlatCheckResult | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [scope, setScope] = useState<FlatCheckScope>('current_and_3_months');
  const [memos, setMemos] = useState<FutureSelfMemo[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!recordId) {
      router.push('/factnote/records');
      return;
    }
    Promise.all([getRecord(recordId), listRecords()]).then(([r, all]) => {
      if (!r) {
        router.push('/factnote/records');
        return;
      }
      setRecord(r);
      setAllRecords(all);
      setStep('scope');
    });
  }, [recordId, router]);

  const pastCounts = useMemo(() => {
    const scopes: FlatCheckScope[] = [
      'current_only',
      'current_and_7_days',
      'current_and_30_days',
      'current_and_3_months',
      'current_and_all',
    ];
    return Object.fromEntries(
      scopes.map((s) => [s, record ? flatCheckPastRecords(allRecords, record.id, s).length : 0]),
    ) as Record<FlatCheckScope, number>;
  }, [record, allRecords]);

  /** おすすめ範囲: 直近3か月に記録が少なければ自動的に広げる（追加依頼 §11）。 */
  const recommended: FlatCheckScope =
    pastCounts.current_and_3_months >= 3 ? 'current_and_3_months' : 'current_and_all';

  async function showMatchedMemos(target: IncidentRecord, biasWarnings: string[], userIssues: number, otherIssues: number) {
    // 安全上の危険がある場合はメモを出さない（安全確認を優先。追加依頼 §25）
    if ((target.analysis?.safetyFlags.length ?? 0) > 0) {
      setMemos([]);
      return;
    }
    const all = await listFutureMemos();
    const matched = matchMemos(all, {
      record: target,
      text: sourceTextOf(target),
      emotions: target.emotions,
      conflictsToday: conflictsOnSameDay(allRecords, new Date(target.occurredAt ?? target.createdAt)),
      hasBiasWarning: biasWarnings.length > 0,
      userIssueCount: userIssues,
      otherIssueCount: otherIssues,
    }).slice(0, 2);
    for (const m of matched) await markMemoShown(m, target.id);
    setMemos(matched);
  }

  async function run(selectedScope: FlatCheckScope, force = false) {
    if (!record) return;
    setScope(selectedScope);

    // 同一条件のチェックは重複実行しない（追加依頼 §27）
    if (!force) {
      const history = await listFlatChecks(record.id);
      const cached = history.find(
        (f) => f.scope === selectedScope && f.createdAt >= record.updatedAt,
      );
      if (cached) {
        setResult(cached);
        setFromCache(true);
        await showMatchedMemos(
          record,
          cached.dataBiasWarnings,
          cached.userImprovementPoints.length,
          cached.otherPartyProblemPoints.length,
        );
        setStep('result');
        return;
      }
    }

    setStep('running');
    const past = flatCheckPastRecords(allRecords, record.id, selectedScope);
    const pastComparison = buildPastComparison(past);
    const biasWarnings = detectDataBias([record, ...past]);
    try {
      const check = await withRetryOn429(() =>
        factnoteFlatCheckApi({
          sourceText: sourceTextOf(record),
          analysisSummary: record.analysis ? analysisSummaryForDiary(record.analysis) : undefined,
          pastStats: pastStatsText(pastComparison, past.length),
          biasWarnings,
        }),
      );
      const persons = await listPersons();
      const person = persons.find((p) => personMatchesRecord(p, record));
      const assembled: FlatCheckResult = {
        id: newFactnoteId(),
        currentRecordId: record.id,
        personId: person?.id,
        scope: selectedScope,
        conciseConclusion: check.conciseConclusion,
        userImprovementPoints: check.userImprovementPoints,
        otherPartyProblemPoints: check.otherPartyProblemPoints,
        unknowns: check.unknowns,
        avoidJudgingFromThisIncident: check.avoidJudgingFromThisIncident,
        pastComparison,
        dataBiasWarnings: biasWarnings,
        improvingPoints: check.improvingPoints,
        aiMessage: check.aiMessage,
        createdAt: new Date().toISOString(),
        aiModel: check.aiModel,
        promptVersion: check.promptVersion,
      };
      await saveFlatCheck(assembled);
      setResult(assembled);
      setFromCache(false);
      await showMatchedMemos(
        record,
        biasWarnings,
        check.userImprovementPoints.length,
        check.otherPartyProblemPoints.length,
      );
      setStep('result');
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.message : 'フラットチェックに失敗しました。');
      setStep('error');
    }
  }

  if (step === 'loading' || !record) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[14px] text-text-tertiary">
        読み込み中…
      </div>
    );
  }

  if (step === 'scope') {
    return (
      <FlatCheckScopeScreen
        record={record}
        pastCounts={pastCounts}
        recommended={recommended}
        onRun={(s) => void run(s)}
      />
    );
  }

  if (step === 'running') {
    return (
      <ProcessingScreen
        title="今回と過去を比べています"
        subtitle="今回の記録の本文と、過去の集計値だけをAIに送っています"
        onCancel={() => setStep('scope')}
      />
    );
  }

  if (step === 'result' && result) {
    return (
      <FlatCheckResultScreen
        record={record}
        result={result}
        fromCache={fromCache}
        memos={memos}
        onCloseMemo={(memo) => setMemos((ms) => ms.filter((m) => m.id !== memo.id))}
        onRegenerate={() => void run(scope, true)}
      />
    );
  }

  return (
    <ErrorScreen
      message={errorMsg}
      canRetry
      onRetry={() => void run(scope, true)}
      onBack={() => router.push(`/factnote/records/${record.id}`)}
    />
  );
}
