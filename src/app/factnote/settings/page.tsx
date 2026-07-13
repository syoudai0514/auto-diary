'use client';

import { useEffect, useState } from 'react';
import { FactnoteSettingsScreen } from '@/components/screens/factnote/SettingsScreen';
import { getPersistState, requestPersistentStorage, type PersistState } from '@/lib/factnote/db';
import { exportAllAsJson } from '@/lib/factnote/exportData';
import { isSampleDataLoaded, loadSampleData, removeSampleData } from '@/lib/factnote/sampleData';

export default function FactnoteSettingsPage() {
  const [persistState, setPersistState] = useState<PersistState>('unsupported');
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getPersistState().then(setPersistState);
    isSampleDataLoaded()
      .then(setSampleLoaded)
      .catch(() => setSampleLoaded(false));
  }, []);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(`${label}に失敗しました。${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FactnoteSettingsScreen
      persistState={persistState}
      sampleLoaded={sampleLoaded}
      busy={busy}
      message={message}
      onExportJson={() =>
        run('エクスポート', async () => {
          const count = await exportAllAsJson();
          return `${count}件の記録をエクスポートしました。ファイルを安全な場所に保管してください。`;
        })
      }
      onLoadSample={() =>
        run('サンプル投入', async () => {
          const count = await loadSampleData();
          setSampleLoaded(true);
          return `サンプルデータ${count}件を投入しました。`;
        })
      }
      onRemoveSample={() =>
        run('サンプル削除', async () => {
          const count = await removeSampleData();
          setSampleLoaded(false);
          return `サンプルデータ${count}件を削除しました。`;
        })
      }
      onRequestPersist={() =>
        run('永続化の要求', async () => {
          const state = await requestPersistentStorage();
          setPersistState(state);
          return state === 'granted' ? '保存の永続化が有効になりました。' : '永続化は許可されませんでした。';
        })
      }
    />
  );
}
