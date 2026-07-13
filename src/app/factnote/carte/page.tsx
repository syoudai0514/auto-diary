'use client';

import { useCallback, useEffect, useState } from 'react';
import { CarteListScreen, type PersonListEntry } from '@/components/screens/factnote/CarteListScreen';
import { personMatchesRecord } from '@/lib/factnote/aggregate';
import { deletePerson, listPersons, listRecords, savePerson } from '@/lib/factnote/db';
import {
  createPersonFromName,
  mergePersons,
  splitAlias,
  suggestMerges,
  unassignedNames,
  type MergeSuggestion,
} from '@/lib/factnote/persons';
import type { IncidentRecord, PersonProfile } from '@/lib/factnote/types';

export default function CarteListPage() {
  const [entries, setEntries] = useState<PersonListEntry[]>([]);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);

  const reload = useCallback(async () => {
    const records = await listRecords().catch(() => [] as IncidentRecord[]);
    let persons = await listPersons().catch(() => [] as PersonProfile[]);
    // 記録に登場する未登録の名前を人物として自動抽出する
    for (const name of unassignedNames(records, persons)) {
      await savePerson(createPersonFromName(name));
    }
    persons = await listPersons();
    setEntries(
      persons.map((person) => {
        const matched = records.filter((r) => personMatchesRecord(person, r));
        return {
          person,
          recordCount: matched.length,
          lastRecordAt: matched[0] ? (matched[0].occurredAt ?? matched[0].createdAt) : undefined,
        };
      }),
    );
    setSuggestions(suggestMerges(persons));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <CarteListScreen
      entries={entries}
      suggestions={suggestions}
      onMerge={async (keep, merge) => {
        await savePerson(mergePersons(keep, merge));
        await deletePerson(merge.id);
        await reload();
      }}
      onSplitAlias={async (person, alias) => {
        const [updated, split] = splitAlias(person, alias);
        await savePerson(updated);
        await savePerson(split);
        await reload();
      }}
    />
  );
}
