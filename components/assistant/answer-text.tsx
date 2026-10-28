'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import { parseBlocks } from '@/lib/assistant/markdown';

/**
 * A model's answer as React elements, from a small markdown subset: `#` headings, `-`/`*`/`1.`
 * lists, `**bold**`, `` `code` `` and paragraphs. Model output is untrusted (names in the data are
 * external input and can carry a prompt injection), so nothing is ever rendered as HTML, and a
 * `[text](url)` link shows as its text only.
 */

// `**bold**`, `` `code` ``, or `[text](destination)`, which renders as its text.
const INLINE = /\*\*(.+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g;

function renderInline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) out.push(text.slice(last, index));
    const [, bold, code, label] = match;
    const k = `${key}${index}`;
    if (bold !== undefined) out.push(<strong key={k}>{renderInline(bold, `${k}.`)}</strong>);
    else if (code !== undefined) out.push(<code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">{code}</code>);
    else out.push(<Fragment key={k}>{label}</Fragment>);
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AnswerText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <h3 key={i} className="pt-1 text-sm font-semibold first:pt-0">
              {renderInline(block.text)}
            </h3>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {block.head.map((h, j) => (
                      <th key={j} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j} className="border-t border-border">
                      {row.map((c, k) => (
                        <td key={k} className="px-2 py-1 align-top">
                          {renderInline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
