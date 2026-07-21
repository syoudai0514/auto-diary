import { sourceTextOf } from './newRecord';
import {
  CONFIDENCE_LABELS,
  DIARY_MODE_LABELS,
  RECORD_SOURCE_LABELS,
  RESPONSIBILITY_JUDGMENT_LABELS,
  type AnalysisItem,
  type IncidentAnalysis,
  type IncidentRecord,
} from './types';

/**
 * 記録を Markdown へ書き出す（他のAI・エディタで内容を丸ごと分析できるように）。
 * 原本・本人の認識・AIの整理を見出しで分け、人間にもLLMにも読みやすい構成にする。
 */

function fmtDateTime(iso?: string): string {
  if (!iso) return '不明';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP');
}

function childrenLabel(record: IncidentRecord): string {
  switch (record.childrenPresent) {
    case 'yes':
      return record.childImpactTags.length > 0 ? record.childImpactTags.join('、') : 'いた';
    case 'no':
      return 'いなかった';
    case 'unknown':
      return '不明';
    default:
      return '未設定';
  }
}

function itemsToMd(items: AnalysisItem[]): string[] {
  if (items.length === 0) return ['- （なし）'];
  return items.map((it) => `- ${it.text}（${CONFIDENCE_LABELS[it.confidence]}）`);
}

function analysisToMd(a: IncidentAnalysis): string[] {
  const lines: string[] = [];
  lines.push('### AIによる分析', '');
  lines.push(`**最初の見解**: ${a.conciseView}`, '');

  lines.push('#### 確認できる事実', ...itemsToMd(a.verifiedFacts), '');
  lines.push('#### ユーザー本人の認識', ...itemsToMd(a.userClaims), '');
  lines.push('#### AIによる推測', ...itemsToMd(a.aiInferences), '');
  lines.push('#### 不明・確認できない点', ...itemsToMd(a.unknowns), '');
  lines.push('#### 自分側の改善点', ...itemsToMd(a.userImprovementPoints), '');
  lines.push('#### 相手側の問題点', ...itemsToMd(a.otherPartyProblemPoints), '');

  lines.push('#### バランスの取れた結論', a.balancedConclusion, '');

  if (a.responsibilityBreakdown.length > 0) {
    lines.push('#### 論点別の責任整理', '');
    lines.push('| 論点 | 自分側 | 相手側 | 判断 |', '| --- | --- | --- | --- |');
    for (const row of a.responsibilityBreakdown) {
      lines.push(
        `| ${row.topic} | ${row.userSide ?? '—'} | ${row.otherSide ?? '—'} | ${RESPONSIBILITY_JUDGMENT_LABELS[row.judgment]} |`,
      );
    }
    lines.push('');
  }

  if (a.nextActions.length > 0) {
    lines.push('#### 次回の具体的対応', ...a.nextActions.map((x, i) => `${i + 1}. ${x}`), '');
  }

  lines.push('#### 相手へ伝える短文');
  lines.push(`- やわらかい: ${a.replySuggestions.gentle}`);
  lines.push(`- 標準: ${a.replySuggestions.standard}`);
  lines.push(`- 境界線を明確にする: ${a.replySuggestions.firm}`, '');

  if (a.positiveActions.length > 0) {
    lines.push('#### 良い出来事', ...itemsToMd(a.positiveActions), '');
  }
  if (a.repairActions.length > 0) {
    lines.push('#### 修復行動', ...itemsToMd(a.repairActions), '');
  }
  if (a.detectedPatterns.length > 0) {
    lines.push(
      '#### 検出されたパターン（発言・行動）',
      ...a.detectedPatterns.map(
        (p) => `- **${p.label}**: ${p.description}（${CONFIDENCE_LABELS[p.confidence]}）`,
      ),
      '',
    );
  }
  if (a.safetyFlags.length > 0) {
    lines.push(
      '#### 安全に関わる注意',
      ...a.safetyFlags.map((f) => `- [${f.severity}] ${f.description}`),
      '',
    );
  }
  lines.push(
    `<sub>分析メタ: モデル ${a.aiModel} / プロンプト ${a.promptVersion} / ${fmtDateTime(a.generatedAt)}</sub>`,
    '',
  );
  return lines;
}

/** 1件の記録を Markdown に変換する。 */
export function recordToMarkdown(record: IncidentRecord): string {
  const lines: string[] = [];
  lines.push(`# ${record.title || '無題の記録'}`, '');

  // メタ情報
  lines.push('## 記録情報', '');
  lines.push(`- 入力形式: ${RECORD_SOURCE_LABELS[record.sourceType]}`);
  lines.push(`- 発生日時: ${fmtDateTime(record.occurredAt)}`);
  lines.push(`- 入力日時: ${fmtDateTime(record.createdAt)}`);
  if (record.location) lines.push(`- 場所: ${record.location}`);
  if (record.people.length > 0)
    lines.push(`- 関係者: ${record.people.map((p) => p.displayName).join('、')}`);
  lines.push(`- 子どもの同席: ${childrenLabel(record)}`);
  if (record.emotions.length > 0) lines.push(`- 感情: ${record.emotions.join('、')}`);
  if (record.tags.length > 0) lines.push(`- タグ: ${record.tags.join('、')}`);
  const flags = [
    record.isPositiveEvent ? '良い出来事' : null,
    record.isConflict ? '衝突' : null,
    record.isRepairAction ? '修復行動' : null,
  ].filter(Boolean);
  if (flags.length > 0) lines.push(`- 分類: ${flags.join('、')}`);
  if (record.attachments.length > 0) {
    const imgCount = record.attachments.filter((a) => a.mimeType.startsWith('image/')).length;
    const audioCount = record.attachments.filter(
      (a) => a.mimeType.startsWith('audio/') || a.mimeType.startsWith('video/'),
    ).length;
    const parts: string[] = [];
    if (imgCount > 0) parts.push(`画像${imgCount}枚`);
    if (audioCount > 0) parts.push(`音声${audioCount}件`);
    lines.push(`- 添付: ${parts.join('、') || `${record.attachments.length}件`}（本文には含まれません）`);
  }
  lines.push('');

  // 原本（ユーザー入力・文字起こし）
  lines.push('## 原本', '');
  if (record.rawText) {
    lines.push('### ユーザーが入力した原文', '', record.rawText, '');
  }
  if (record.transcript) {
    lines.push('### AIによる文字起こし', '', '```', record.transcript, '```', '');
  }
  if (record.correctedTranscript) {
    lines.push('### 修正済み文字起こし（ユーザー修正）', '', record.correctedTranscript, '');
  }
  if (!record.rawText && !record.transcript && !record.correctedTranscript) {
    const src = sourceTextOf(record);
    if (src) lines.push(src, '');
    else lines.push('（本文なし）', '');
  }

  // 分析
  if (record.analysis) {
    lines.push('## 分析', '');
    lines.push(...analysisToMd(record.analysis));
  }

  // 日記
  if (record.diaryVersions.length > 0) {
    lines.push('## 日記', '');
    for (const d of record.diaryVersions) {
      const tag = d.editedByUser ? '・ユーザー編集済み' : '';
      lines.push(`### ${d.title}`, '', `_${DIARY_MODE_LABELS[d.mode]}${tag}_`, '', d.body, '');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** 複数の記録を1つの Markdown ドキュメントにまとめる。 */
export function recordsToMarkdown(records: IncidentRecord[], now: Date = new Date()): string {
  const head = [
    '# 事実ノート エクスポート',
    '',
    `- 出力日時: ${now.toLocaleString('ja-JP')}`,
    `- 記録件数: ${records.length}件`,
    '',
    '> このファイルは事実ノートの記録を Markdown で書き出したものです。',
    '> 原本・本人の認識・AIの整理を区別して記載しています。',
    '',
    '---',
    '',
  ].join('\n');
  const body = records.map((r) => recordToMarkdown(r)).join('\n---\n\n');
  return head + body;
}
