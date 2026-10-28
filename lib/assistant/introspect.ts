import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The database as the assistant is told it is: read live from Postgres through `assistant_schema`
 * (docs/assistant.md), never written down in the app. Every table and view the user can read, its
 * columns and types, and the comments the migrations put on them, which carry the meaning.
 */

export interface SchemaColumn {
  name: string;
  type: string;
  comment: string | null;
}

export interface SchemaRelation {
  relation: string;
  kind: string;
  description: string | null;
  columns: SchemaColumn[];
}

/** A comment as one line, cut to `max` characters at a word. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

const SHORT_TYPES: [RegExp, string][] = [
  [/timestamp with time zone/g, 'timestamptz'],
  [/timestamp without time zone/g, 'timestamp'],
  [/character varying/g, 'varchar'],
  [/\bboolean\b/g, 'bool'],
  [/\binteger\b/g, 'int'],
];

function shortType(type: string): string {
  return SHORT_TYPES.reduce((t, [from, to]) => t.replace(from, to), type);
}

/**
 * Compact text for the system prompt: per relation, its kind and comment, its columns with types on
 * one line, then the columns that have a comment, one per line. Comments are trimmed; the model can
 * read the catalogue with sql when it needs more.
 */
export function formatSchema(relations: SchemaRelation[]): string {
  return relations
    .map((r) => {
      const head = `${r.relation} (${r.kind})${r.description ? `: ${oneLine(r.description, 240)}` : ''}`;
      const cols = r.columns.map((c) => `${c.name} ${shortType(c.type)}`).join(', ');
      const notes = r.columns
        .filter((c) => c.comment)
        .map((c) => `  · ${c.name}: ${oneLine(c.comment!, 140)}`);
      return [head, `  ${cols}`, ...notes].join('\n');
    })
    .join('\n');
}

/** Reads the schema the signed-in user can see. Throws with the database's message when it can't. */
export async function loadSchema(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc('assistant_schema');
  if (error) throw new Error(`Couldn't read the database schema: ${error.message}`);
  return formatSchema((data ?? []) as SchemaRelation[]);
}
