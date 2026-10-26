import { describe, expect, it } from 'vitest';
import { GLOSSARY, formatEntry, lookupTerm } from '../src/core/glossary';

describe('glossary', () => {
  it('has unique ids and valid related links', () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY) for (const r of e.related) expect(ids).toContain(r);
  });

  it('finds terms by id, name and alias', () => {
    expect(lookupTerm('HEAD')?.id).toBe('head');
    expect(lookupTerm('detached head')?.id).toBe('detached-head');
    expect(lookupTerm('origin')?.id).toBe('remote');
    expect(lookupTerm('git stash')?.id).toBe('stash');
    expect(lookupTerm('reset --hard')?.id).toBe('reset');
    expect(lookupTerm('banana')).toBeNull();
  });

  it('formats entries as markdown', () => {
    const text = formatEntry(lookupTerm('rebase')!);
    expect(text).toContain('**Rebase**');
    expect(text).toContain('Careful:');
    expect(text).toContain('Related: Merge, Force push');
  });
});
