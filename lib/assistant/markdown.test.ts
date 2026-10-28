import { describe, expect, it } from 'vitest';
import { parseBlocks } from './markdown';

describe('answer markdown', () => {
  it('reads headings, lists and paragraphs', () => {
    expect(parseBlocks('## Top\n- one\n- two\n\nDone.')).toEqual([
      { type: 'heading', text: 'Top' },
      { type: 'list', ordered: false, items: ['one', 'two'] },
      { type: 'paragraph', text: 'Done.' },
    ]);
  });

  it('reads a table and what follows it', () => {
    const text = 'Here:\n| Company | Stand |\n|---|:---:|\n| Kiron | A10 |\n| Pariplay | B2 |\nThat is all.';
    expect(parseBlocks(text)).toEqual([
      { type: 'paragraph', text: 'Here:' },
      { type: 'table', head: ['Company', 'Stand'], rows: [['Kiron', 'A10'], ['Pariplay', 'B2']] },
      { type: 'paragraph', text: 'That is all.' },
    ]);
  });

  it('keeps a lone pipe line that is not a table as text', () => {
    expect(parseBlocks('| not a table |')).toEqual([{ type: 'paragraph', text: '| not a table |' }]);
  });
});
