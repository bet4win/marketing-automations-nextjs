'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/search-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { searchPeople } from '@/lib/people';
import { PeopleTable, type PersonSortKey } from '@/components/people-table';
import type { Person } from '@/lib/types';

export function PeopleView({
  people, eventCompanyIds, eventName, selectedId, onSelect, onOpenCompany,
  onAddPeople,
}: {
  people: Person[];
  /** Companies exhibiting at the currently selected event. */
  eventCompanyIds: Set<string>;
  eventName: string;
  selectedId: string | null;
  onSelect: (p: Person) => void;
  onOpenCompany: (companyId: string) => void;
  onAddPeople: () => void;
}) {
  const [query, setQuery] = useState('');
  const [thisEventOnly, setThisEventOnly] = useState(false);
  const [sortKey, setSortKey] = useState<PersonSortKey>('full_name');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const visible = useMemo(() => {
    const scoped = thisEventOnly
      ? people.filter((p) => eventCompanyIds.has(p.company_id))
      : people;
    const found = searchPeople(scoped, query);
    return [...found].sort((a, b) => {
      const av = (a[sortKey] ?? '') as string;
      const bv = (b[sortKey] ?? '') as string;
      return av.localeCompare(bv) * sortDir;
    });
  }, [people, eventCompanyIds, thisEventOnly, query, sortKey, sortDir]);

  const onSort = (k: PersonSortKey) => {
    if (k === sortKey) setSortDir((d) => (d * -1) as 1 | -1);
    else { setSortKey(k); setSortDir(1); }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-1.5">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search people — name, title, company, email"
          ariaLabel="Search people"
          className="h-7 w-[320px] text-xs"
        />
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="this-event-only"
            checked={thisEventOnly}
            onCheckedChange={(v) => setThisEventOnly(v === true)}
          />
          <Label htmlFor="this-event-only" className="text-[11px] text-muted-foreground">
            {eventName} only
          </Label>
        </div>
        <span className="text-xs text-muted-foreground">
          {visible.length} of {people.length} people
        </span>
        <Button variant="outline" size="sm" className="ml-auto h-7 text-xs"
          onClick={onAddPeople}>
          Add people
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          {people.length === 0 ? (
            <div className="mx-auto max-w-lg space-y-3 text-left">
              <p className="text-center font-medium text-foreground">No named people yet</p>
              <p className="text-[12.5px] leading-relaxed">
                Contact rows without a name are addresses, not people, so they are not
                listed here. Populating this section needs a source that supplies named
                individuals — Apollo&apos;s people API returns names, titles and profile
                URLs under licence, but it is not included in the current plan.
              </p>
              <p className="text-[12.5px] leading-relaxed">
                Until then, every company profile links straight to its LinkedIn
                People tab. Copy what you see there and use <b>Add people</b> —
                the paste is parsed into rows you review before anything is saved.
              </p>
            </div>
          ) : (
            'No people match this search.'
          )}
        </div>
      ) : (
        <PeopleTable
          people={visible}
          sortKey={sortKey} sortDir={sortDir} onSort={onSort}
          selectedId={selectedId} onSelect={onSelect}
          onOpenCompany={onOpenCompany}
        />
      )}
    </main>
  );
}
