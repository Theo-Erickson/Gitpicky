import { GLOSSARY, type GlossaryEntry } from '../core/glossary';
import { h } from './dom';

function matches(entry: GlossaryEntry, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return [entry.term, entry.short, ...entry.aliases].some((t) => t.toLowerCase().includes(q));
}

/** The searchable glossary shown in the Learn tab. */
export function renderLearn(state: { query: string; open: string | null }, onChange: () => void): HTMLElement {
  const search = h('input', {
    type: 'search',
    class: 'learn-search',
    placeholder: 'Search git words (HEAD, rebase, stash…)',
    value: state.query,
  });
  const list = h('div', { class: 'learn-list' });

  const draw = () => {
    list.replaceChildren(
      ...GLOSSARY.filter((e) => matches(e, state.query)).map((entry) => {
        const isOpen = state.open === entry.id;
        return h(
          'article',
          { class: `learn-entry${isOpen ? ' open' : ''}`, id: `learn-${entry.id}` },
          h(
            'button',
            {
              class: 'learn-term',
              type: 'button',
              onclick: () => {
                state.open = isOpen ? null : entry.id;
                onChange();
              },
            },
            h('strong', null, entry.term),
            h('span', null, entry.short),
          ),
          isOpen
            ? h(
                'div',
                { class: 'learn-detail' },
                h('p', null, entry.explanation),
                entry.analogy ? h('p', { class: 'learn-analogy' }, h('em', null, 'Think of it like: '), entry.analogy) : null,
                entry.inPicture ? h('p', null, h('em', null, 'In the picture: '), entry.inPicture) : null,
                entry.command ? h('p', null, h('em', null, 'Usual command: '), h('code', null, entry.command)) : null,
                entry.caution ? h('p', { class: 'learn-caution' }, entry.caution) : null,
                entry.related.length
                  ? h(
                      'div',
                      { class: 'learn-related' },
                      'Related: ',
                      entry.related.map((id) => {
                        const rel = GLOSSARY.find((e) => e.id === id);
                        return rel
                          ? h(
                              'button',
                              {
                                class: 'chip',
                                type: 'button',
                                onclick: () => {
                                  state.open = id;
                                  state.query = '';
                                  onChange();
                                },
                              },
                              rel.term,
                            )
                          : null;
                      }),
                    )
                  : null,
              )
            : null,
        );
      }),
    );
  };

  search.addEventListener('input', () => {
    state.query = search.value;
    draw();
  });
  draw();
  return h('div', { class: 'learn' }, search, list);
}
