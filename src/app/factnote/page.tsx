'use client';

import { useEffect, useState } from 'react';
import { FactnoteHomeScreen } from '@/components/screens/factnote/HomeScreen';
import {
  getMeta,
  listFutureMemos,
  listRecords,
  META_LAST_BACKUP_AT,
  requestPersistentStorage,
  type PersistState,
} from '@/lib/factnote/db';
import { recoverStaleProcessingRecords, subscribeFactnoteJobs } from '@/lib/factnote/jobs';
import { dueReminders } from '@/lib/factnote/memoMatch';
import type { FutureSelfMemo, IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteHomePage() {
  const [records, setRecords] = useState<IncidentRecord[]>([]);
  const [persistState, setPersistState] = useState<PersistState>('unsupported');
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>(undefined);
  const [dueMemos, setDueMemos] = useState<FutureSelfMemo[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // iOSのIndexedDB退避対策として初回に永続化を要求する（依頼書 §21）
      const persist = await requestPersistentStorage();
      // タブ強制終了などで処理中のまま固まった記録を復旧する（データは保存済み）
      await recoverStaleProcessingRecords().catch(() => {});
      const [list, backup, memos] = await Promise.all([
        listRecords().catch(() => []),
        getMeta<string>(META_LAST_BACKUP_AT).catch(() => undefined),
        listFutureMemos().catch(() => []),
      ]);
      if (cancelled) return;
      setPersistState(persist);
      setRecords(list);
      setLastBackupAt(backup);
      setDueMemos(dueReminders(memos));
    })();
    // バックグラウンドの文字起こし・分析が完了したら最近の記録へ反映する
    const unsubscribe = subscribeFactnoteJobs((event) => {
      if (event.type !== 'progress') {
        listRecords()
          .then((list) => {
            if (!cancelled) setRecords(list);
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <FactnoteHomeScreen
      records={records}
      persistState={persistState}
      lastBackupAt={lastBackupAt}
      dueMemos={dueMemos}
      onCloseMemo={(memo) => setDueMemos((ms) => ms.filter((m) => m.id !== memo.id))}
    />
  );
}
