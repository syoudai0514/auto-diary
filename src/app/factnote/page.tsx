'use client';

import { useEffect, useState } from 'react';
import { FactnoteHomeScreen } from '@/components/screens/factnote/HomeScreen';
import {
  getMeta,
  listRecords,
  META_LAST_BACKUP_AT,
  requestPersistentStorage,
  type PersistState,
} from '@/lib/factnote/db';
import type { IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteHomePage() {
  const [records, setRecords] = useState<IncidentRecord[]>([]);
  const [persistState, setPersistState] = useState<PersistState>('unsupported');
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // iOSのIndexedDB退避対策として初回に永続化を要求する（依頼書 §21）
      const persist = await requestPersistentStorage();
      const [list, backup] = await Promise.all([
        listRecords().catch(() => []),
        getMeta<string>(META_LAST_BACKUP_AT).catch(() => undefined),
      ]);
      if (cancelled) return;
      setPersistState(persist);
      setRecords(list);
      setLastBackupAt(backup);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FactnoteHomeScreen records={records} persistState={persistState} lastBackupAt={lastBackupAt} />
  );
}
