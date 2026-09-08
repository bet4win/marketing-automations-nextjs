import { GRADES, emailsOf } from './domain';
import type { Contact, EventRow, Lead } from './types';

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const COLUMNS = [
  'Event', 'Company', 'Category', 'Group', 'Confidence', 'Reach', 'Reach source',
  'HQ city', 'HQ country', 'Website', 'Zone', 'Booth',
  'Contact name', 'Contact title', 'Contact email', 'Name confidence',
  'All emails', 'Phones', 'LinkedIn',
  'Apollo industry', 'Apollo employees', 'Apollo revenue',
  'Event status', 'Priority', 'Owner', 'Starred', 'Notes',
  'Company status', 'Company note',
];

export function toCsv(leads: Lead[], contactsBy: Record<string, Contact[]>, event: EventRow) {
  const rows = leads.map((l) => {
    const contacts = contactsBy[l.company_id] ?? [];
    const emails = emailsOf(contacts);
    const best = emails[0];
    return [
      event.name, l.name, l.category_label, l.category_group, l.category_confidence,
      l.reach, l.reach_source, l.hq_city, l.hq_country,
      l.domain ? `https://${l.domain}` : '',
      (l.zones ?? []).join('; '), (l.booths ?? []).join(' '),
      best?.full_name ?? '', best?.job_title ?? '', best?.email ?? '',
      best?.full_name ? GRADES[best.attribution ?? 'unattributed'].label : '',
      emails.map((c) => c.email).join('; '),
      contacts.filter((c) => c.phone).map((c) => c.phone).join('; '),
      l.linkedin_url ?? '',
      l.apollo_industry ?? '', l.apollo_employees ?? '', l.apollo_revenue ?? '',
      l.event_status ?? 'new', l.priority ?? '', l.owner ?? '',
      l.starred ? 'yes' : '', l.notes ?? '',
      l.company_status ?? '', l.company_note ?? '',
    ].map(esc).join(',');
  });
  // BOM so Excel reads it as UTF-8.
  return `﻿${[COLUMNS.map(esc).join(','), ...rows].join('\r\n')}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
