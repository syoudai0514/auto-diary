import { newFactnoteId } from './db';
import type { IncidentRecord, PersonProfile } from './types';

/**
 * 人物管理の純粋ロジック（追加依頼 §4）。
 * - 記録の people から人物を自動抽出する
 * - 別名の統合・分離
 * - 同一人物候補の提示（AIではなく同義語辞書によるローカル判定 —
 *   確定ではなく候補としてユーザーが承認する）
 */

/** 同一人物になりやすい呼び方のグループ（候補提示にのみ使用）。 */
const ALIAS_GROUPS: string[][] = [
  ['妻', 'ママ', '奥さん', '嫁', '配偶者'],
  ['夫', 'パパ', '旦那', '主人', '配偶者'],
  ['母', 'お母さん', '母親'],
  ['父', 'お父さん', '父親'],
  ['義母', 'お義母さん', '義理の母'],
  ['義父', 'お義父さん', '義理の父'],
  ['長男', '息子'],
  ['長女', '娘'],
];

export function personNames(person: PersonProfile): string[] {
  return [person.displayName, ...person.aliases];
}

/** 記録に登場する名前のうち、既存の人物に紐づかないものを列挙する。 */
export function unassignedNames(records: IncidentRecord[], persons: PersonProfile[]): string[] {
  const known = new Set(persons.flatMap(personNames));
  const names = new Set<string>();
  for (const r of records) {
    for (const p of r.people) {
      if (p.displayName.trim() && !known.has(p.displayName)) names.add(p.displayName);
    }
  }
  return Array.from(names);
}

/** 未登録の名前から新しい PersonProfile を作る。 */
export function createPersonFromName(name: string, now: Date = new Date()): PersonProfile {
  const iso = now.toISOString();
  return {
    id: newFactnoteId(),
    displayName: name,
    relationship: name,
    aliases: [],
    createdAt: iso,
    updatedAt: iso,
    mergedPersonIds: [],
  };
}

/**
 * 2人を統合する（keep に merge の名前をすべて別名として取り込む）。
 * 返り値は更新後の keep。merge 側は呼び出し元で削除する。
 */
export function mergePersons(
  keep: PersonProfile,
  merge: PersonProfile,
  now: Date = new Date(),
): PersonProfile {
  const names = new Set(keep.aliases);
  for (const name of personNames(merge)) {
    if (name !== keep.displayName) names.add(name);
  }
  return {
    ...keep,
    aliases: Array.from(names),
    mergedPersonIds: [...keep.mergedPersonIds, merge.id, ...merge.mergedPersonIds],
    updatedAt: now.toISOString(),
  };
}

/** 別名を分離して独立した人物に戻す。返り値は [更新後の元人物, 新しい人物]。 */
export function splitAlias(
  person: PersonProfile,
  alias: string,
  now: Date = new Date(),
): [PersonProfile, PersonProfile] {
  const updated: PersonProfile = {
    ...person,
    aliases: person.aliases.filter((a) => a !== alias),
    updatedAt: now.toISOString(),
  };
  return [updated, createPersonFromName(alias, now)];
}

export interface MergeSuggestion {
  a: PersonProfile;
  b: PersonProfile;
  reason: string;
}

/**
 * 同一人物の可能性がある組み合わせを提示する（確定はしない — 追加依頼 §4）。
 * 同義語グループに両者の名前が含まれる場合に候補とする。
 */
export function suggestMerges(persons: PersonProfile[]): MergeSuggestion[] {
  const suggestions: MergeSuggestion[] = [];
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const namesA = personNames(persons[i]);
      const namesB = personNames(persons[j]);
      const group = ALIAS_GROUPS.find(
        (g) => namesA.some((n) => g.includes(n)) && namesB.some((n) => g.includes(n)),
      );
      if (group) {
        suggestions.push({
          a: persons[i],
          b: persons[j],
          reason: `「${persons[i].displayName}」と「${persons[j].displayName}」は同じ人物ですか？`,
        });
      }
    }
  }
  return suggestions;
}
