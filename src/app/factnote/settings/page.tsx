'use client';

import { useEffect, useState } from 'react';
import { FactnoteSettingsScreen } from '@/components/screens/factnote/SettingsScreen';
import { getPersistState, requestPersistentStorage, type PersistState } from '@/lib/factnote/db';
import { canShareBackup, exportAllAsJson, shareBackupJson } from '@/lib/factnote/exportData';
import {
  chooseAutoBackupDirectory,
  clearAutoBackupDirectory,
  getAutoBackupDirName,
  supportsDirectoryAutoBackup,
} from '@/lib/factnote/autoBackup';
import { loadFactnoteProfile, saveFactnoteProfile } from '@/lib/factnote/profile';
import { isSampleDataLoaded, loadSampleData, removeSampleData } from '@/lib/factnote/sampleData';

export default function FactnoteSettingsPage() {
  const [persistState, setPersistState] = useState<PersistState>('unsupported');
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profileMarkdown, setProfileMarkdown] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [autoBackupSupported, setAutoBackupSupported] = useState(false);
  const [autoBackupDir, setAutoBackupDir] = useState<string | null>(null);

  useEffect(() => {
    getPersistState().then(setPersistState);
    isSampleDataLoaded()
      .then(setSampleLoaded)
      .catch(() => setSampleLoaded(false));
    loadFactnoteProfile().then((p) => setProfileMarkdown(p.markdown));
    setCanShare(canShareBackup());
    setAutoBackupSupported(supportsDirectoryAutoBackup());
    getAutoBackupDirName()
      .then(setAutoBackupDir)
      .catch(() => setAutoBackupDir(null));
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
      profileMarkdown={profileMarkdown}
      canShare={canShare}
      autoBackupSupported={autoBackupSupported}
      autoBackupDir={autoBackupDir}
      onChooseAutoBackupDir={() =>
        run('自動保存フォルダの設定', async () => {
          const name = await chooseAutoBackupDirectory();
          setAutoBackupDir(name);
          return `保存先を「${name}」に設定しました。以降、記録を変更するたびに自動保存されます。`;
        })
      }
      onClearAutoBackupDir={() =>
        run('自動保存の解除', async () => {
          await clearAutoBackupDirectory();
          setAutoBackupDir(null);
          return '自動保存を解除しました。';
        })
      }
      onSaveProfile={(markdown) =>
        run('プロフィールの保存', async () => {
          const saved = await saveFactnoteProfile(markdown);
          setProfileMarkdown(saved.markdown);
          return 'プロフィールを保存しました。次回のAI処理から反映されます。';
        })
      }
      onExportJson={() =>
        run('エクスポート', async () => {
          const count = await exportAllAsJson();
          return `${count}件の記録をエクスポートしました。ファイルを安全な場所に保管してください。`;
        })
      }
      onShareJson={() =>
        run('バックアップの共有', async () => {
          const { shared, count } = await shareBackupJson();
          return shared
            ? `${count}件の記録を共有しました。「"ファイル"に保存」でiCloud Driveを選ぶとiCloudに保存されます。`
            : '共有をキャンセルしました。';
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
