import { escapeHtml } from './html';

export interface ConfirmationDetail {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface ConfirmationRequest {
  kicker?: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  details?: ConfirmationDetail[];
}

interface PendingConfirmation {
  resolve: (confirmed: boolean) => void;
  previousFocus: HTMLElement | null;
  appWasInert: boolean;
}

/** Accessible modal confirmation; the caller still performs the authoritative mutation. */
export class ConfirmationView {
  private readonly root: HTMLDivElement;
  private pending: PendingConfirmation | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'confirmation-layer';
    this.root.hidden = true;
    this.root.innerHTML = `<div class="confirmation-backdrop" data-confirmation-cancel></div>
      <section class="confirmation-card" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-body">
        <span class="confirmation-kicker" data-confirmation-kicker></span>
        <h2 id="confirmation-title" data-confirmation-title></h2>
        <p id="confirmation-body" data-confirmation-body></p>
        <dl class="confirmation-details" data-confirmation-details></dl>
        <div class="confirmation-actions"><button type="button" class="confirmation-cancel" data-confirmation-cancel></button><button type="button" class="confirmation-accept" data-confirmation-accept></button></div>
        <small class="confirmation-note">No action is sent until you confirm. The server validates the final state.</small>
      </section>`;
    parent.append(this.root);
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-confirmation-cancel]')) this.settle(false);
      if (target.closest('[data-confirmation-accept]')) this.settle(true);
    });
    // Capture Escape even if a busy renderer has not produced a focus frame yet.
    // This also prevents the underlying panel's global Escape shortcut from closing.
    document.addEventListener('keydown', (event) => this.handleKeydown(event), true);
  }

  open(request: ConfirmationRequest): Promise<boolean> {
    if (this.pending) return Promise.resolve(false);
    return new Promise((resolve) => {
      const app = document.getElementById('app');
      this.pending = { resolve, previousFocus: document.activeElement as HTMLElement | null, appWasInert: app?.inert ?? false };
      if (app) app.inert = true;
      this.root.hidden = false;
      this.root.dataset.tone = request.tone ?? 'default';
      const card = this.root.querySelector<HTMLElement>('.confirmation-card')!;
      card.setAttribute('role', request.tone === 'danger' ? 'alertdialog' : 'dialog');
      this.text('[data-confirmation-kicker]', request.kicker ?? 'REVIEW ACTION');
      this.text('[data-confirmation-title]', request.title);
      this.text('[data-confirmation-body]', request.body);
      this.text('button[data-confirmation-cancel]', request.cancelLabel ?? 'Keep current state');
      this.text('[data-confirmation-accept]', request.confirmLabel);
      const details = this.root.querySelector<HTMLElement>('[data-confirmation-details]')!;
      details.innerHTML = (request.details ?? []).map((detail) => `<div class="${detail.emphasis ? 'emphasis' : ''}"><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd></div>`).join('');
      details.hidden = !request.details?.length;
      this.root.querySelector<HTMLButtonElement>('[data-confirmation-accept]')?.focus({ preventScroll: true });
    });
  }

  private text(selector: string, value: string) {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.pending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.settle(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    if (!buttons.length) return;
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    if (!this.root.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private settle(confirmed: boolean) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.root.hidden = true;
    const app = document.getElementById('app');
    if (app) app.inert = pending.appWasInert;
    pending.previousFocus?.focus();
    pending.resolve(confirmed);
  }
}
