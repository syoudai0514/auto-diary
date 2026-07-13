'use client';

import { useEffect, useState } from 'react';
import { FactnoteRecordsScreen } from '@/components/screens/factnote/RecordsScreen';
import { listRecords } from '@/lib/factnote/db';
import type { IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteRecordsPage() {
  const [records, setRecords] = useState<IncidentRecord[]>([]);

  useEffect(() => {
    listRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, []);

  return <FactnoteRecordsScreen records={records} />;
}
