import './onboarding.css';
import { FIRST_TRIP_STEPS, firstTripStepNumber, type FirstTripGuideState, type FirstTripStep } from '../onboarding';
import { formatLrd } from '../../shared/simulation';
import { escapeHtml } from './html';

export interface OnboardingViewContext {
  panel: string | null;
  mode: 'walking' | 'driving';
  vehicleName: string;
  vehicleDistance: number | null;
  destinationName: string | null;
  destinationDistance: number | null;
  tripAction: 'pickup' | 'complete' | null;
}

interface OnboardingViewCallbacks {
  onStart: () => void;
  onDismiss: () => void;
  onClose: () => void;
  onWallet: () => void;
}

const DEFAULT_CONTEXT: OnboardingViewContext = {
  panel: null, mode: 'walking', vehicleName: 'taxi', vehicleDistance: null,
  destinationName: null, destinationDistance: null, tripAction: null,
};

/** Accessible, non-modal presentation for the FirstTripGuide state machine. */
export class OnboardingView {
  private readonly root: HTMLElement;
  private state: FirstTripGuideState = { status: 'idle', step: 'move', tripId: null, passengerName: '', fareLrd: null };
  private context: OnboardingViewContext = { ...DEFAULT_CONTEXT };
  private minimized = false;
  private confirmExit = false;
  private targetSignature = '';

  constructor(parent: HTMLElement, private readonly callbacks: OnboardingViewCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'onboarding-guide';
    this.root.className = 'onboarding-guide';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'First-trip guide');
    this.root.hidden = true;
    parent.append(this.root);
    this.root.addEventListener('click', (event) => this.handleClick(event));
  }

  render(state: FirstTripGuideState) {
    const previous = this.state;
    this.state = { ...state };
    if (state.status === 'idle') {
      this.minimized = false;
      this.confirmExit = false;
    } else if (previous.status !== state.status) {
      this.confirmExit = false;
      if (state.status === 'complete') this.minimized = false;
    }
    this.draw();
  }

  setPanel(panel: string | null) {
    const changed = this.context.panel !== panel;
    this.context = { ...this.context, panel };
    if (panel && window.matchMedia('(max-width: 1180px)').matches && this.state.status === 'active') this.minimized = true;
    if (changed) this.draw();
  }

  update(context: Omit<OnboardingViewContext, 'panel'>) {
    this.context = { ...this.context, ...context };
    const contextLine = this.root.querySelector<HTMLElement>('[data-guide-context]');
    if (contextLine) {
      const copy = this.contextCopy();
      if (contextLine.textContent !== copy) contextLine.textContent = copy;
      contextLine.dataset.ready = String(this.isReadyForTripAction());
    }
    this.syncTargets();
  }

  private draw() {
    const { state } = this;
    this.root.hidden = state.status === 'idle';
    this.root.dataset.status = state.status;
    this.root.dataset.step = state.step;
    this.root.dataset.panel = this.context.panel ?? 'none';
    const hud = document.getElementById('hud');
    hud?.classList.toggle('onboarding-active', state.status === 'active');
    if (state.status === 'active') hud?.setAttribute('data-onboarding-step', state.step);
    else hud?.removeAttribute('data-onboarding-step');
    if (state.status === 'idle') {
      this.root.innerHTML = '';
      this.syncTargets();
      return;
    }
    if (this.minimized && state.status === 'active') {
      const number = firstTripStepNumber(state.step);
      this.root.innerHTML = `<button class="onboarding-minimized" data-guide-action="expand" aria-expanded="false">
        <span class="onboarding-mini-brand">TL</span><span><small>GUIDE · ${number}/${FIRST_TRIP_STEPS.length}</small><strong>${escapeHtml(stepTitle(state.step, state))}</strong></span><b>Expand</b>
      </button>`;
      this.syncTargets();
      return;
    }
    if (this.confirmExit && state.status === 'active') {
      this.root.innerHTML = `<div class="onboarding-card onboarding-exit-card">
        <span class="onboarding-kicker">LEAVE THE GUIDE?</span><h2>Your trip stays exactly as it is.</h2>
        <p>Exiting only closes the tutorial. It does not cancel your passenger, change your fare or affect your account progress.</p>
        <div class="onboarding-confirmation-actions"><button class="onboarding-primary" data-guide-action="continue">Continue guide</button><button class="onboarding-secondary" data-guide-action="confirm-exit">Exit guide</button></div>
      </div>`;
      document.querySelectorAll('.onboarding-target').forEach((element) => element.classList.remove('onboarding-target'));
      this.targetSignature = '';
      return;
    }
    if (state.status === 'welcome') {
      this.root.innerHTML = `<div class="onboarding-card">${this.header('DRIVER ONBOARDING', false)}
        <div class="onboarding-welcome-mark" aria-hidden="true">01<span>→</span>06</div>
        <h2>Learn by driving.<br>We’ll stay with you.</h2>
        <p>Complete one real passenger trip with short, contextual guidance—from your first steps to a fare recorded in your wallet.</p>
        <ul class="onboarding-benefits"><li>Six small, action-based milestones</li><li>Normal fares and gameplay throughout</li><li>Skip now and replay anytime in Settings</li></ul>
        <div class="onboarding-welcome-actions"><button class="onboarding-primary" data-guide-action="start">Start guided first trip <span aria-hidden="true">→</span></button><button class="onboarding-text" data-guide-action="skip">Skip guide</button></div></div>`;
      this.syncTargets();
      return;
    }
    if (state.status === 'complete') {
      this.root.innerHTML = `<div class="onboarding-card">${this.header('GUIDE COMPLETE', false)}
        <div class="onboarding-complete-icon" aria-hidden="true">✓</div><span class="onboarding-kicker">FIRST TRIP COMPLETE</span>
        <h2>You know the route now.</h2><p>You collected ${escapeHtml(state.passengerName)}, reached the destination and completed the full driving loop.</p>
        <div class="onboarding-fare"><small>SERVER-RECORDED FARE</small><strong>+${formatLrd(state.fareLrd ?? 0)}</strong><span>Added to your persistent citizen wallet</span></div>
        <div class="onboarding-welcome-actions"><button class="onboarding-primary" data-guide-action="close">Continue exploring <span aria-hidden="true">→</span></button><button class="onboarding-secondary" data-guide-action="wallet">View wallet</button></div></div>`;
      this.syncTargets();
      return;
    }

    const number = firstTripStepNumber(state.step);
    const percent = Math.round(number / FIRST_TRIP_STEPS.length * 100);
    this.root.innerHTML = `<div class="onboarding-card">${this.header(`FIRST TRIP · STEP ${number} OF ${FIRST_TRIP_STEPS.length}`, true)}
      <div class="onboarding-progress" role="progressbar" aria-label="First-trip guide progress" aria-valuemin="1" aria-valuemax="${FIRST_TRIP_STEPS.length}" aria-valuenow="${number}"><i style="width:${percent}%"></i></div>
      <span class="onboarding-kicker">${String(number).padStart(2, '0')} / ${stepKicker(state.step)}</span>
      <h2>${escapeHtml(stepTitle(state.step, state))}</h2><p>${stepBody(state.step, state, this.context)}</p>
      <div class="onboarding-context" data-guide-context data-ready="${this.isReadyForTripAction()}">${escapeHtml(this.contextCopy())}</div>
      <div class="onboarding-footer"><span>${stepKeys(state.step)}</span><button class="onboarding-text" data-guide-action="exit">Exit guide</button></div>
      <span class="sr-only" aria-live="polite">Step ${number} of ${FIRST_TRIP_STEPS.length}. ${escapeHtml(stepTitle(state.step, state))}</span></div>`;
    this.syncTargets();
  }

  private header(label: string, canMinimize: boolean) {
    return `<header class="onboarding-header"><span class="onboarding-brand">TL</span><strong>${label}</strong>${canMinimize ? '<button data-guide-action="minimize" aria-label="Minimize guide" aria-expanded="true">−</button>' : ''}</header>`;
  }

  private contextCopy() {
    const { state, context } = this;
    if (state.status !== 'active') return '';
    if (state.step === 'move') return 'WASD / arrow keys · touch: left joystick';
    if (state.step === 'vehicle') return context.vehicleDistance === null ? `Walk to your ${context.vehicleName}` : `${Math.max(0, Math.round(context.vehicleDistance))} m to your ${context.vehicleName}`;
    if (state.step === 'phone') return 'P · or select Phone in the HUD';
    if (state.step === 'request') return context.panel === 'phone' ? 'Dispatch → review → Accept request' : 'Reopen your phone or press J for Dispatch';
    if (this.isReadyForTripAction()) return state.step === 'pickup' ? 'Ready · press F to pick up' : 'Ready · press F to complete';
    if (context.mode !== 'driving') return 'Return to your vehicle to continue this trip';
    if (context.destinationDistance !== null) return `${Math.round(context.destinationDistance)} m to ${context.destinationName ?? (state.step === 'pickup' ? 'pickup' : 'destination')}`;
    return 'Follow the gold GPS route';
  }

  private isReadyForTripAction() {
    return (this.state.step === 'pickup' && this.context.tripAction === 'pickup')
      || (this.state.step === 'dropoff' && this.context.tripAction === 'complete');
  }

  private syncTargets() {
    const signature = `${this.state.status}:${this.state.step}:${this.context.panel}:${this.context.tripAction}`;
    if (signature !== this.targetSignature) {
      document.querySelectorAll('.onboarding-target').forEach((element) => element.classList.remove('onboarding-target'));
      this.targetSignature = signature;
    }
    if (this.state.status !== 'active') return;
    const selectors: string[] = [];
    if (this.state.step === 'move') selectors.push('[data-touch-joystick]');
    if (this.state.step === 'vehicle') selectors.push('#interaction-prompt');
    if (this.state.step === 'phone') selectors.push('.hud-actions [data-panel="phone"]', '.touch-controls [data-panel="phone"]');
    if (this.state.step === 'request') {
      if (this.context.panel === 'phone') {
        if (document.querySelector('#phone-content [data-accept-job]')) selectors.push('#phone-content [data-accept-job]');
        else selectors.push('#phone-content [data-phone-tab="dispatch"]');
      } else selectors.push('.hud-actions [data-panel="dispatch"]', '.hud-actions [data-panel="phone"]');
    }
    if (this.state.step === 'pickup' || this.state.step === 'dropoff') {
      if (this.isReadyForTripAction()) selectors.push('#trip-action');
      else selectors.push('.minimap-wrap', '#objective-card');
    }
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (selector === '#phone-content [data-accept-job]') elements[0]?.classList.add('onboarding-target');
      else elements.forEach((element) => element.classList.add('onboarding-target'));
    }
  }

  private handleClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-guide-action]');
    if (!button) return;
    const action = button.dataset.guideAction;
    if (action === 'start') this.callbacks.onStart();
    if (action === 'skip' || action === 'confirm-exit') this.callbacks.onDismiss();
    if (action === 'close') this.callbacks.onClose();
    if (action === 'wallet') this.callbacks.onWallet();
    if (action === 'exit') { this.confirmExit = true; this.draw(); }
    if (action === 'continue') { this.confirmExit = false; this.draw(); }
    if (action === 'minimize') { this.minimized = true; this.draw(); }
    if (action === 'expand') { this.minimized = false; this.draw(); }
  }
}

function stepKicker(step: FirstTripStep) {
  return ({ move: 'ORIENTATION', vehicle: 'YOUR VEHICLE', phone: 'CITIZEN OS', request: 'PASSENGER DISPATCH', pickup: 'PICKUP', dropoff: 'DESTINATION' })[step];
}

function stepTitle(step: FirstTripStep, state: FirstTripGuideState) {
  if (step === 'move') return 'Move through the district';
  if (step === 'vehicle') return 'Meet your taxi';
  if (step === 'phone') return 'Open your citizen phone';
  if (step === 'request') return 'Choose your first passenger';
  if (step === 'pickup') return `Collect ${state.passengerName || 'your passenger'}`;
  return 'Complete the trip';
}

function stepBody(step: FirstTripStep, state: FirstTripGuideState, context: OnboardingViewContext) {
  if (step === 'move') return 'Take a short walk using the movement controls. The guide advances from your actual movement, so you can learn at your own pace.';
  if (step === 'vehicle') return `Walk to your gold ${escapeHtml(context.vehicleName)}. When the entry prompt appears, press <kbd>E</kbd> or tap <strong>Enter / exit</strong>.`;
  if (step === 'phone') return 'Press <kbd>P</kbd> or select <strong>Phone</strong>. This is your workspace for dispatch, community tasks, Civic services, your wallet and garage.';
  if (step === 'request') return 'Open <strong>Dispatch</strong>, review the pickup, destination and server-reserved fare, then accept any open request. The guide will follow your choice.';
  if (step === 'pickup') return `Follow the gold GPS route to ${escapeHtml(state.passengerName || 'the passenger')}. Stop inside the pickup marker, then press <kbd>F</kbd> when <strong>Pick up passenger</strong> appears.`;
  return 'Your passenger is aboard. Follow the new gold route to the destination, stop, and press <kbd>F</kbd> to complete the trip. The server records the fare exactly once.';
}

function stepKeys(step: FirstTripStep) {
  if (step === 'move') return '<kbd>WASD</kbd> Move';
  if (step === 'vehicle') return '<kbd>E</kbd> Enter vehicle';
  if (step === 'phone') return '<kbd>P</kbd> Phone';
  if (step === 'request') return '<kbd>J</kbd> Dispatch';
  return '<kbd>F</kbd> Trip action';
}
