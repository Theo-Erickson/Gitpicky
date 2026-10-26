import { GLOSSARY } from '../core/glossary';
import { formatCommand, type Plan } from '../core/preview';
import { h } from './dom';

export const RISK_LABEL: Record<Plan['risk'], string> = {
  safe: 'Safe',
  careful: 'Be careful',
  destructive: 'Can lose work',
};

let open: HTMLElement | null = null;

export function closeDialog(): void {
  open?.remove();
  open = null;
}

function show(content: HTMLElement, onDismiss: () => void): void {
  closeDialog();
  const overlay = h('div', { class: 'overlay', onclick: (e: MouseEvent) => e.target === overlay && onDismiss() }, content);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onDismiss();
  });
  document.body.appendChild(overlay);
  open = overlay;
  (content.querySelector('input, textarea, button.primary') as HTMLElement | null)?.focus();
}

export interface PlanDialogOptions {
  plan: Plan;
  /** Shown above the summary, e.g. "Claude is asking to:". */
  source?: string;
  /** Why the change was requested (assistant proposals). */
  reason?: string;
  approveLabel?: string;
  onApprove(): Promise<{ ok: boolean; error?: string; log?: { command: string; output: string }[] }>;
  onCancel(): void;
  onLearn(id: string): void;
}

export function riskPill(risk: Plan['risk']): HTMLElement {
  return h('span', { class: `risk risk-${risk}` }, RISK_LABEL[risk]);
}

export function planBody(plan: Plan, onLearn: (id: string) => void): HTMLElement {
  return h(
    'div',
    { class: 'plan-body' },
    h('p', { class: 'plan-summary' }, plan.summary),
    plan.blockers.length
      ? h('div', { class: 'callout callout-blocker' }, h('strong', null, "Can't do this yet"), h('ul', null, plan.blockers.map((b) => h('li', null, b))))
      : null,
    plan.warnings.length
      ? h('div', { class: 'callout callout-warning' }, h('strong', null, 'Good to know'), h('ul', null, plan.warnings.map((w) => h('li', null, w))))
      : null,
    plan.steps.length
      ? h(
          'details',
          { class: 'plan-steps', open: true },
          h('summary', null, 'What Gitpicky will run'),
          h(
            'ol',
            null,
            plan.steps.map((s) => h('li', null, h('code', null, formatCommand(s.args)), h('span', { class: 'step-why' }, s.why))),
          ),
        )
      : null,
    plan.learn.length
      ? h(
          'div',
          { class: 'plan-learn' },
          h('span', null, 'New to these words? '),
          plan.learn.map((id) => {
            const entry = GLOSSARY.find((e) => e.id === id);
            return entry ? h('button', { class: 'chip', type: 'button', onclick: () => onLearn(id) }, entry.term) : null;
          }),
        )
      : null,
  );
}

export function showPlanDialog(opts: PlanDialogOptions): void {
  const { plan } = opts;
  const needsConfirm = plan.risk === 'destructive';
  const confirm = needsConfirm ? h('input', { type: 'checkbox', id: 'confirm-risk' }) : null;
  const approve = h('button', { class: `primary${plan.risk === 'destructive' ? ' danger' : ''}`, type: 'button' }, opts.approveLabel ?? 'Do it');
  const cancel = h('button', { type: 'button', onclick: () => opts.onCancel() }, 'Cancel');
  const result = h('div', { class: 'plan-result' });
  const blocked = plan.blockers.length > 0;
  const syncDisabled = () => {
    approve.toggleAttribute('disabled', blocked || (confirm !== null && !confirm.checked));
  };
  confirm?.addEventListener('change', syncDisabled);
  syncDisabled();

  approve.addEventListener('click', async () => {
    approve.setAttribute('disabled', '');
    approve.textContent = 'Working…';
    const outcome = await opts.onApprove();
    if (outcome.ok) return; // caller closes the dialog
    approve.textContent = 'Failed';
    cancel.textContent = 'Close';
    result.replaceChildren(
      h('div', { class: 'callout callout-blocker' }, h('strong', null, 'Git stopped with an error'), h('pre', null, outcome.error ?? 'Unknown error')),
    );
    if (outcome.error && /conflict/i.test(outcome.error)) {
      result.appendChild(
        h('p', null, 'This usually means both sides changed the same lines. ', h('button', { class: 'chip', type: 'button', onclick: () => opts.onLearn('conflict') }, 'What is a merge conflict?')),
      );
    }
  });

  const dialog = h(
    'div',
    { class: `dialog dialog-plan risk-border-${plan.risk}`, role: 'dialog', 'aria-modal': 'true' },
    opts.source ? h('div', { class: 'dialog-source' }, opts.source) : null,
    h('div', { class: 'dialog-head' }, h('h2', null, plan.title), riskPill(plan.risk)),
    opts.reason ? h('blockquote', { class: 'plan-reason' }, opts.reason) : null,
    planBody(plan, opts.onLearn),
    h('p', { class: 'preview-hint' }, blocked ? '' : 'The history behind this window shows how things will look afterwards (dashed = not real yet).'),
    result,
    confirm ? h('label', { class: 'confirm-row' }, confirm, " I understand this can't be undone.") : null,
    h('div', { class: 'dialog-actions' }, cancel, approve),
  );
  show(dialog, opts.onCancel);
}

export interface AskField {
  name: string;
  label: string;
  placeholder?: string;
  value?: string;
  hint?: string;
  type?: 'text' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
}

/** A small form dialog (Electron has no window.prompt). Resolves null when cancelled. */
export function ask(title: string, fields: AskField[], submitLabel = 'Next'): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const done = (value: Record<string, string> | null) => {
      closeDialog();
      resolve(value);
    };
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const form = h(
      'form',
      {
        class: 'dialog',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const values: Record<string, string> = {};
          for (const [name, input] of inputs) {
            values[name] = input instanceof HTMLInputElement && input.type === 'checkbox' ? String(input.checked) : input.value.trim();
          }
          done(values);
        },
      },
      h('div', { class: 'dialog-head' }, h('h2', null, title)),
      fields.map((f) => {
        let input: HTMLInputElement | HTMLSelectElement;
        if (f.type === 'select') {
          input = h('select', { name: f.name }, (f.options ?? []).map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
        } else if (f.type === 'checkbox') {
          input = h('input', { type: 'checkbox', name: f.name, checked: f.value === 'true' });
          inputs.set(f.name, input);
          return h('label', { class: 'field field-check' }, input, ` ${f.label}`, f.hint ? h('small', null, f.hint) : null);
        } else {
          input = h('input', { type: 'text', name: f.name, placeholder: f.placeholder ?? '', value: f.value ?? '', autocomplete: 'off', spellcheck: 'false' });
        }
        inputs.set(f.name, input);
        return h('label', { class: 'field' }, h('span', null, f.label), input, f.hint ? h('small', null, f.hint) : null);
      }),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'primary', type: 'submit' }, submitLabel)),
    );
    show(form, () => done(null));
  });
}
