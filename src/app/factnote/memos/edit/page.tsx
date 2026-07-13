'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AutoTextarea } from '@/components/screens/common';
import { FactnoteHeader, Section } from '@/components/screens/factnote/common';
import { factnoteMemoDraftApi } from '@/lib/factnote/api';
import { getFutureMemo, newFactnoteId, saveFutureMemo } from '@/lib/factnote/db';
import { MEMO_TEMPLATES } from '@/lib/factnote/memoMatch';
import {
  FUTURE_MEMO_TRIGGER_LABELS,
  type FutureMemoTriggerType,
  type FutureSelfMemo,
} from '@/lib/factnote/types';
import { ApiError } from '@/lib/api';

export default function MemoEditPage() {
  return (
    <Suspense>
      <MemoEditor />
    </Suspense>
  );
}

/** 未来メモの作成・編集（テンプレート選択・表示条件設定・AI下書き支援）。 */
function MemoEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [triggers, setTriggers] = useState<FutureMemoTriggerType[]>([]);
  const [priority, setPriority] = useState(3);
  const [existing, setExisting] = useState<FutureSelfMemo | null>(null);
  const [saving, setSaving] = useState(false);

  // AI下書き（保存前に必ず本人が確認・編集する — 自動保存しない）
  const [draftPurpose, setDraftPurpose] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const aiDraftRef = useRef<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (!editId) return;
    getFutureMemo(editId).then((m) => {
      if (!m) return;
      setExisting(m);
      setTitle(m.title);
      setBody(m.body);
      setTriggers(m.triggers.map((t) => t.type));
      setPriority(m.priority);
    });
  }, [editId]);

  function applyTemplate(key: string) {
    const t = MEMO_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setTitle(t.title);
    setBody(t.body);
    setTriggers(t.triggers.map((x) => x.type));
    aiDraftRef.current = null;
  }

  async function generateDraft() {
    if (!draftPurpose.trim()) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const draft = await factnoteMemoDraftApi(draftPurpose.trim());
      aiDraftRef.current = draft;
      setTitle(draft.title);
      setBody(draft.body);
    } catch (e) {
      setDraftError(e instanceof ApiError ? e.message : '下書きの生成に失敗しました。');
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const draft = aiDraftRef.current;
    const source: FutureSelfMemo['source'] = draft
      ? draft.title === title && draft.body === body
        ? 'ai_draft_approved'
        : 'ai_draft_user_edited'
      : (existing?.source ?? 'user_written');
    const memo: FutureSelfMemo = {
      id: existing?.id ?? newFactnoteId(),
      title: title.trim(),
      body,
      triggers: triggers.map((type) => ({ type })),
      priority,
      isEnabled: existing?.isEnabled ?? true,
      source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastShownAt: existing?.lastShownAt,
      remindAt: existing?.remindAt,
    };
    await saveFutureMemo(memo);
    router.push('/factnote/memos');
  }

  const triggerOptions = (Object.keys(FUTURE_MEMO_TRIGGER_LABELS) as FutureMemoTriggerType[]).filter(
    (t) => t !== 'manual',
  );

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title={existing ? 'メモを編集' : 'メモを作る'} backHref="/factnote/memos" />
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {!existing && (
          <Section title="テンプレートから始める">
            <div className="flex flex-wrap gap-2">
              {MEMO_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => applyTemplate(t.key)}
                  className="min-h-[44px] rounded-chip border border-border bg-surface px-3.5 text-[13px] active:opacity-70"
                >
                  {t.title}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="タイトル">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 全部自分が悪いと思った時"
            aria-label="メモのタイトル"
            className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </Section>

        <Section title="本文（冷静な時の自分の言葉で）">
          <AutoTextarea
            value={body}
            onChange={setBody}
            ariaLabel="メモの本文"
            className="min-h-[30dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[14px] leading-[1.9] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {aiDraftRef.current && (
            <p className="mt-2 rounded-card bg-warning-soft px-3 py-2 text-[12px] leading-relaxed">
              AIの下書きです。<strong>自分の言葉に書き直してから</strong>保存すると、動揺している時に受け入れやすくなります。
            </p>
          )}
        </Section>

        <Section title="AIに下書きを頼む（任意）">
          <div className="flex gap-2">
            <input
              value={draftPurpose}
              onChange={(e) => setDraftPurpose(e.target.value)}
              placeholder="例: 自分が全部悪いと思った時に読む文章"
              aria-label="下書きの目的"
              className="h-11 min-w-0 flex-1 rounded-card border border-border bg-surface px-3 text-[13.5px] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => void generateDraft()}
              disabled={drafting || !draftPurpose.trim()}
              className="h-11 shrink-0 rounded-full border border-border px-4 text-[13px] active:opacity-70 disabled:opacity-40"
            >
              {drafting ? '生成中…' : '下書きを作る'}
            </button>
          </div>
          {draftError && <p className="mt-2 text-[12px] text-error">{draftError}</p>}
        </Section>

        <Section title="表示する条件（複数可）">
          <div className="flex flex-wrap gap-2">
            {triggerOptions.map((t) => {
              const selected = triggers.includes(t);
              return (
                <button
                  key={t}
                  onClick={() =>
                    setTriggers(selected ? triggers.filter((x) => x !== t) : [...triggers, t])
                  }
                  aria-pressed={selected}
                  className={`min-h-[44px] rounded-chip border px-3.5 text-[13px] active:opacity-70 ${
                    selected ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface text-text'
                  }`}
                >
                  {FUTURE_MEMO_TRIGGER_LABELS[t]}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="優先度">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                aria-pressed={priority === p}
                className={`h-11 w-11 rounded-full border text-[14px] active:opacity-70 ${
                  priority === p ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
        <button
          onClick={() => void save()}
          disabled={saving || !title.trim() || !body.trim() || triggers.length === 0}
          className="mb-3 h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta disabled:opacity-40"
        >
          保存する
        </button>
      </div>
    </div>
  );
}
