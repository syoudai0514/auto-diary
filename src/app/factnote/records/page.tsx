'use client';

import { useEffect, useState } from 'react';
import { FactnoteRecordsScreen } from '@/components/screens/factnote/RecordsScreen';
import { listRecords } from '@/lib/factnote/db';
import { subscribeFactnoteJobs } from '@/lib/factnote/jobs';
import type { IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteRecordsPage() {
  const [records, setRecords] = useState<IncidentRecord[]>([]);

  useEffect(() => {
    const load = () =>
      listRecords()
        .then(setRecords)
        .catch(() => setRecords([]));
    void load();
    // バックグラウンドの文字起こし・分析が完了したら一覧へ反映する
    return subscribeFactnoteJobs((event) => {
      if (event.type !== 'progress') void load();
    });
  }, []);

  return <FactnoteRecordsScreen records={records} />;
}
