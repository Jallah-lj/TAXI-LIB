import './phone.css';
import './feedback.css';
import type {
  CharacterAppearance, CitizenTaskState, LedgerEntry, LifestyleState, PlayerProfile, PlayerVehicle,
  TaxiJob, TaxiTrip, Wallet, WorldBootstrap,
} from '../shared/types';
import {
  MAX_PROPERTY_LEVEL, MAX_VEHICLE_UPGRADE_LEVEL, PROPERTY_CATALOG, VEHICLE_CATALOG, VEHICLE_PAINT_FINISHES,
  VEHICLE_UPGRADES, propertyUpgradeCost, vehiclePaint, vehicleUpgradeCost,
  type VehicleUpgradeKind, type VehicleVisualKind,
} from '../shared/catalog';
import { getLocation, type WorldLocation } from '../shared/world';
import { CITIZEN_TASKS, currentCitizenTaskStep, getCitizenTaskDefinition } from '../shared/tasks';
import { formatGameTime, formatLrd } from '../shared/simulation';
import type { HomeHUDState, HUDState } from './game';
import type { HomeRoomId } from '../shared/homes';
import { PHONE_CONTACTS, PhoneSystem, type PhoneAction, type PhoneCallSnapshot } from './systems/phone';
import { Dealership, type PurchaseVehicleDetail } from './showroom/dealership';
import { escapeHtml } from './ui/html';
import { renderCivicView } from './ui/civic-view';
import type { CivicIncident, CivicPanelTarget, CivicSection, CivicState, PlayerSafetyState } from '../shared/civic';
import type { Point2 } from '../shared/world';
import {
  applyQualityPreset, BRIGHTNESS_MAX, BRIGHTNESS_MIN, QUALITY_PROFILES,
  type ClientSettings, type GraphicsQuality, type GraphicsSettings, type RenderScale,
} from './settings';
import {
  NotificationCenter, type AppNotification, type NotificationActionType, type NotificationCategory,
  type NotificationFilter, type NotificationInput, type NotificationTone,
} from './notifications';
import { INITIAL_CONNECTION_STATUS, connectionPhaseLabel, type ConnectionStatus } from './connection';
import {
  appendSocialMessage, citizenActivityLabel, socialRosterSignature,
  type NearbyCitizen, type SocialChatMessage,
} from './social';
import { ConfirmationView, type ConfirmationRequest } from './ui/confirmation-view';

export type PhoneTab = 'home' | 'calls' | 'vehicles' | 'homes' | 'garage' | 'wallet' | 'dispatch' | 'tasks' | 'civic';
type AuthDetail = { handle: string; password: string; displayName?: string };

interface UIEventMap {
  login: AuthDetail;
  register: AuthDetail;
  enter: undefined;
  customize: undefined;
  appearance: CharacterAppearance;
  logout: undefined;
  'accept-job': string;
  'cancel-trip': undefined;
  'trip-request': undefined;
  waypoint: string;
  chat: string;
  conversation: boolean;
  panel: string | null;
  settings: ClientSettings;
  'replay-onboarding': undefined;
  'load-wallet': undefined;
  'refresh-jobs': undefined;
  'accept-task': string;
  'accept-civic-task': { templateId: string; incidentId: string };
  'report-civic': string;
  'load-civic': undefined;
  'civic-waypoint': { key: string; locationId: string; x: number; z: number; label: string };
  'cancel-task': string;
  'buy-property': string;
  'upgrade-property': string;
  'buy-vehicle': PurchaseVehicleDetail;
  'upgrade-vehicle': { vehicleId: string; kind: VehicleUpgradeKind };
  'select-vehicle': string;
  'access-property': string;
  'visit-room': HomeRoomId;
  'leave-home': undefined;
  'home-lights': undefined;
  lights: undefined;
  reconnect: undefined;
  reauthenticate: undefined;
  wave: undefined;
}

export class UI {
  private readonly listeners = new Map<keyof UIEventMap, Set<(detail: never) => void>>();
  private readonly phone = new PhoneSystem((call) => this.renderPhoneCall(call));
  private readonly notifications = new NotificationCenter();
  private readonly confirmation: ConfirmationView;
  private readonly dealership: Dealership;
  private profile: PlayerProfile | null = null;
  private world: WorldBootstrap | null = null;
  private lifestyle: LifestyleState | null = null;
  private jobs: TaxiJob[] = [];
  private activeTrip: TaxiTrip | null = null;
  private activePanel: string | null = null;
  private previousFocus: HTMLElement | null = null;
  private phoneTab: PhoneTab = 'home';
  private call: PhoneCallSnapshot | null = null;
  private ledger: LedgerEntry[] | null = null;
  private walletLoading = false;
  private walletError = '';
  private taskBusy = false;
  private taskError = '';
  private civicBusy = false;
  private civicError = '';
  private civicSection: CivicSection = 'services';
  private civicDepartmentId?: CivicPanelTarget['departmentId'];
  private civicIncidentId?: string;
  private civicSiteId?: string;
  private localPosition: Point2 | null = null;
  private phoneEnvironmentKey = '';
  private commerceBusy = false;
  private localDriving = false;
  private localInsideHome = false;
  private localHomeId: string | null = null;
  private homePanelId: string | null = null;
  private notificationFilter: NotificationFilter = 'all';
  private connection: ConnectionStatus = { ...INITIAL_CONNECTION_STATUS };
  private socialPlayers: NearbyCitizen[] = [];
  private socialSignature = '';
  private chatHistory: SocialChatMessage[] = [];
  private chatSequence = 0;
  private onlineCount = 0;
  private menuTimer?: ReturnType<typeof setTimeout>;

  constructor(private settings: ClientSettings) {
    this.el('app').innerHTML = shell();
    this.confirmation = new ConfirmationView(document.body);
    this.dealership = new Dealership(this.el('app'), {
      onPurchase: (detail) => this.emit('buy-vehicle', detail),
      onSelect: (vehicleId) => this.emit('select-vehicle', vehicleId),
      onOpenGarage: () => this.openPhone('garage'),
    }, this.settings.graphics);
    this.syncSettingsControls();
    this.bindEvents();
  }

  on<K extends keyof UIEventMap>(event: K, listener: (detail: UIEventMap[K]) => void) {
    let handlers = this.listeners.get(event);
    if (!handlers) { handlers = new Set(); this.listeners.set(event, handlers); }
    handlers.add(listener as (detail: never) => void);
  }

  private emit<K extends keyof UIEventMap>(event: K, detail: UIEventMap[K]) {
    this.listeners.get(event)?.forEach((listener) => (listener as (value: UIEventMap[K]) => void)(detail));
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing interface element #${id}`);
    return element as T;
  }

  private bindChatComposer(formId: string, inputId: string) {
    const input = this.input(inputId);
    input.addEventListener('focus', () => this.emit('conversation', true));
    input.addEventListener('blur', () => this.emit('conversation', false));
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') input.blur(); });
    this.el<HTMLFormElement>(formId).addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (this.connection.phase !== 'online') {
        this.notify({ category: 'connection', tone: 'error', title: 'Chat is unavailable offline', message: 'Your draft is still here. Reconnect to the district before sending.', action: { type: 'reconnect', label: 'Reconnect' } });
        return;
      }
      this.emit('chat', text);
      input.value = '';
    });
  }

  private bindEvents() {
    document.querySelectorAll<HTMLButtonElement>('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => {
      const login = button.dataset.authTab === 'login';
      this.el('login-form').hidden = !login;
      this.el('register-form').hidden = login;
      document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
      this.authError();
    }));
    this.el<HTMLFormElement>('login-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.emit('login', { handle: this.input('login-handle').value.trim(), password: this.input('login-password').value });
    });
    this.el<HTMLFormElement>('register-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.emit('register', {
        displayName: this.input('register-name').value.trim(), handle: this.input('register-handle').value.trim(),
        password: this.input('register-password').value,
      });
    });
    this.el<HTMLFormElement>('character-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      this.emit('appearance', { skin: Number(data.get('skin')), hair: Number(data.get('hair')), top: Number(data.get('top')), bottom: Number(data.get('bottom')) });
    });
    this.bindChatComposer('chat-form', 'chat-input');
    this.bindChatComposer('social-chat-form', 'social-chat-input');
    this.el('app').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.uiAction === 'enter') this.emit('enter', undefined);
      if (button.dataset.uiAction === 'customize') this.emit('customize', undefined);
      if (button.dataset.uiAction === 'logout') this.emit('logout', undefined);
      if (button.hasAttribute('data-replay-onboarding')) this.emit('replay-onboarding', undefined);
      if (button.hasAttribute('data-reconnect')) this.emit('reconnect', undefined);
      if (button.hasAttribute('data-reauthenticate')) this.emit('reauthenticate', undefined);
      if (button.hasAttribute('data-social-wave')) this.emit('wave', undefined);
      if (button.dataset.notificationAction) this.handleNotificationAction(button.dataset.notificationAction as NotificationActionType);
      if (button.dataset.notificationFilter) {
        this.notificationFilter = button.dataset.notificationFilter as NotificationFilter;
        this.renderNotifications();
      }
      if (button.hasAttribute('data-mark-notifications-read')) {
        this.notifications.markAllRead();
        this.updateNotificationBadge();
        this.renderNotifications();
      }
      if (button.hasAttribute('data-clear-notifications')) {
        this.notifications.clear();
        this.updateNotificationBadge();
        this.renderNotifications();
      }
      if (button.hasAttribute('data-dismiss-toast')) button.closest('.toast')?.remove();
      if (button.dataset.panel) this.openPanel(button.dataset.panel);
      if (button.hasAttribute('data-close-panels')) this.closePanels();
      if (button.dataset.acceptJob) this.emit('accept-job', button.dataset.acceptJob);
      if (button.hasAttribute('data-cancel-trip')) this.emit('cancel-trip', undefined);
      if (button.dataset.location) this.emit('waypoint', button.dataset.location);
      if (button.hasAttribute('data-refresh-jobs')) this.emit('refresh-jobs', undefined);
      if (button.hasAttribute('data-lights')) this.emit('lights', undefined);
      if (button.hasAttribute('data-leave-home')) this.emit('leave-home', undefined);
      if (button.hasAttribute('data-home-lights')) this.emit('home-lights', undefined);
      if (button.dataset.room) this.emit('visit-room', button.dataset.room as HomeRoomId);
    });
    this.el('trip-action').addEventListener('click', () => this.emit('trip-request', undefined));
    this.el('phone-panel').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-phone-tab]');
      if (button) this.navigatePhone(button.dataset.phoneTab as PhoneTab, button);
    });
    this.el('phone-tabs').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(this.el('phone-tabs').querySelectorAll<HTMLButtonElement>('button[data-phone-tab]'));
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const target = tabs[next]!;
      target.focus();
      this.navigatePhone(target.dataset.phoneTab as PhoneTab, target);
    });
    this.el('phone-content').addEventListener('click', (event) => this.handlePhoneClick(event));
    this.el('panel-backdrop').addEventListener('click', () => this.closePanels());
    this.input('quality').addEventListener('change', () => {
      this.settings = {
        ...this.settings,
        graphics: applyQualityPreset(this.settings.graphics, this.input('quality').value as GraphicsQuality),
      };
      this.commitSettings();
    });
    this.input('brightness').addEventListener('input', () => {
      this.updateGraphics({ brightness: Number(this.input('brightness').value) });
    });
    this.input('render-scale').addEventListener('change', () => {
      this.updateGraphics({ renderScale: Number(this.input('render-scale').value) as RenderScale });
    });
    this.input('shadows').addEventListener('change', () => {
      this.updateGraphics({ shadows: this.input('shadows').checked });
    });
    this.input('reduced-motion').addEventListener('change', () => {
      this.updateGraphics({ reducedMotion: this.input('reduced-motion').checked });
    });
    this.input('volume').addEventListener('input', () => {
      this.settings = { ...this.settings, volume: Number(this.input('volume').value) };
      this.commitSettings();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.activePanel) this.closePanels();
      if (event.ctrlKey || event.metaKey || event.altKey || this.isTyping()) return;
      if (event.code === 'KeyP' && !event.repeat) this.openPhone();
      if (event.code === 'KeyM' && !event.repeat && !this.el('hud').hidden) this.openPanel('map');
      if (event.code === 'KeyJ' && !event.repeat && !this.el('hud').hidden) this.openPanel('dispatch');
      if (event.code === 'Enter' && !event.repeat && !this.el('hud').hidden && !this.activePanel) {
        event.preventDefault();
        this.input('chat-input').focus();
      }
    });
  }

  private updateGraphics(patch: Partial<GraphicsSettings>) {
    this.settings = { ...this.settings, graphics: { ...this.settings.graphics, ...patch } };
    this.commitSettings();
  }

  private commitSettings() {
    this.syncSettingsControls();
    this.dealership.setGraphicsSettings(this.settings.graphics);
    this.emit('settings', this.settings);
  }

  private syncSettingsControls() {
    const { graphics, volume } = this.settings;
    this.input('quality').value = graphics.quality;
    this.input('brightness').value = String(graphics.brightness);
    this.input('render-scale').value = String(graphics.renderScale);
    this.input('shadows').checked = graphics.shadows;
    this.input('reduced-motion').checked = graphics.reducedMotion;
    this.input('volume').value = String(volume);
    this.el('brightness-output').textContent = `${graphics.brightness}%`;
    this.el('volume-output').textContent = `${volume}%`;
    this.el('graphics-summary').textContent = `${graphics.quality[0]!.toUpperCase()}${graphics.quality.slice(1)} · ${graphics.renderScale}% resolution · shadows ${graphics.shadows ? 'on' : 'off'}`;
    this.el('rain-summary').textContent = QUALITY_PROFILES[graphics.quality].rainFraction < 1 ? 'Reduced rain particles' : 'Full rain particles';
    document.documentElement.dataset.reducedMotion = String(graphics.reducedMotion);
  }

  private navigatePhone(tab: PhoneTab, source?: HTMLElement) {
    if (tab === 'vehicles') { this.openPanel('showroom'); return; }
    this.phoneTab = tab;
    if (tab !== 'tasks') this.taskError = '';
    if (tab !== 'civic') this.civicError = '';
    this.el('phone-content').scrollTop = 0;
    this.renderPhone();
    this.loadPhoneTab(tab);
    if (source?.closest('#phone-content')) requestAnimationFrame(() => this.el('phone-content').focus({ preventScroll: true }));
  }

  private loadPhoneTab(tab: PhoneTab) {
    if (tab === 'wallet') this.requestWallet();
    if (tab === 'dispatch') this.emit('refresh-jobs', undefined);
    if (tab === 'civic') this.emit('load-civic', undefined);
  }

  private input(id: string) { return this.el<HTMLInputElement>(id); }
  private isTyping() { return document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement; }

  ready() {
    this.el('loading').classList.add('done');
    if (this.settings.graphics.reducedMotion) this.el('loading').hidden = true;
    else setTimeout(() => { this.el('loading').hidden = true; }, 450);
  }

  authBusy(busy: boolean) {
    document.querySelectorAll<HTMLButtonElement>('.auth-form button').forEach((button) => { button.disabled = busy; });
    this.el('auth-view').setAttribute('aria-busy', String(busy));
  }

  authError(message = '') {
    this.el('auth-error').textContent = message;
    const registerError = document.querySelector('[data-register-error]');
    if (registerError) registerError.textContent = message;
  }

  showLobby(profile: PlayerProfile, world: WorldBootstrap) {
    clearTimeout(this.menuTimer);
    this.profile = profile;
    this.setWorld(world);
    this.closePanels();
    this.el('menu-screen').hidden = false;
    this.el('menu-screen').classList.remove('leaving');
    this.el('world-shade').classList.remove('game-active');
    this.el('hud').hidden = true;
    this.el('auth-view').hidden = true;
    this.el('lobby-view').hidden = false;
    this.renderLobby();
  }

  private setWorld(world: WorldBootstrap) {
    this.world = world;
    this.lifestyle = world;
    this.jobs = world.jobs;
    this.activeTrip = world.activeTrip;
    this.updateWallet(world.wallet);
    this.updateJobs(world.jobs, world.activeTrip);
  }

  private renderLobby() {
    if (!this.profile || !this.world || !this.lifestyle) return;
    const selected = this.lifestyle.vehicles.find((vehicle) => vehicle.id === this.lifestyle!.selectedVehicleId) ?? this.lifestyle.vehicles[0];
    this.el('lobby-view').innerHTML = `<p class="card-kicker">CITIZEN LOBBY</p><h2>Welcome, ${escapeHtml(this.profile.displayName)}.</h2>
      <p class="card-subtitle">${escapeHtml(this.world.disclaimer)}</p>
      <div class="lobby-person"><span class="avatar">${escapeHtml(this.profile.displayName.charAt(0).toUpperCase())}</span><div><strong>@${escapeHtml(this.profile.handle)}</strong><small>${this.profile.reputation} cooperative reputation</small></div><span class="ready-pill">READY</span></div>
      <div class="lobby-balance"><span>AVAILABLE BALANCE</span><strong data-wallet-balance>${formatLrd(this.lifestyle.wallet.balanceLrd)}</strong><small>Persistent, server-authoritative LRD</small></div>
      ${selected ? `<div class="starter-vehicle"><span>SELECTED VEHICLE</span><strong>${escapeHtml(selected.model.name)}</strong><small>${escapeHtml(selected.plate)} · ${this.lifestyle.vehicles.length} / ${this.lifestyle.garageCapacity} garage slots · ${this.lifestyle.properties.length} home${this.lifestyle.properties.length === 1 ? '' : 's'}</small></div>` : ''}
      <button class="primary-button" data-ui-action="enter">Enter the district <span aria-hidden="true">→</span></button>
      <div class="choice-row"><button class="secondary-button" data-panel="phone">Citizen phone</button><button class="secondary-button" data-ui-action="customize">Customize</button></div>
      <button class="text-button" data-ui-action="logout">Sign out</button>
      <p class="local-note">Desktop-first · Keyboard, touch and gamepad movement · Simulated local services</p>`;
  }

  showGame(world: WorldBootstrap) {
    this.setWorld(world);
    this.closePanels();
    this.el('hud').hidden = false;
    this.el('world-shade').classList.add('game-active');
    this.el('menu-screen').classList.add('leaving');
    this.menuTimer = setTimeout(() => { this.el('menu-screen').hidden = true; }, 450);
  }

  showCharacter(profile: PlayerProfile) {
    this.profile = profile;
    this.el('character-form').innerHTML = `${appearanceChoices('skin', 'Skin tone', 6, profile.appearance.skin)}${appearanceChoices('hair', 'Character & hairstyle', 4, profile.appearance.hair)}${appearanceChoices('top', 'Top color', 6, profile.appearance.top)}${appearanceChoices('bottom', 'Trousers', 4, profile.appearance.bottom)}
      <button class="primary-button" type="submit">Save appearance</button>`;
    this.openPanel('character');
  }

  closeCharacter() { this.closePanels(); }

  setLifestyleState(state: LifestyleState) {
    this.lifestyle = state;
    if (this.world) Object.assign(this.world, state);
    this.updateWallet(state.wallet);
    this.renderLobby();
    if (this.activePanel === 'phone' && this.phoneTab !== 'calls') this.renderPhone();
  }

  setLifestyleBusy(busy: boolean) {
    this.commerceBusy = busy;
    this.dealership.setBusy(busy);
    this.el('phone-panel').setAttribute('aria-busy', String(busy));
    if (this.activePanel === 'phone' && this.phoneTab !== 'calls') this.renderPhone();
  }

  setLifestyleError(message: string) {
    this.dealership.showError(message);
  }

  updateWallet(wallet: Wallet) {
    if (this.lifestyle) this.lifestyle.wallet = wallet;
    if (this.world) this.world.wallet = wallet;
    document.querySelectorAll('[data-wallet-balance]').forEach((element) => { element.textContent = formatLrd(wallet.balanceLrd); });
    if (this.activePanel === 'phone' && this.phoneTab !== 'calls') this.renderPhone();
    if (this.activePanel === 'showroom' && this.lifestyle) this.dealership.setState(this.lifestyle);
  }

  private requestWallet() {
    if (this.walletLoading) return;
    this.walletLoading = true;
    this.walletError = '';
    if (this.activePanel === 'wallet') this.el('ledger-list').innerHTML = '<p class="empty-state">Loading your authoritative ledger…</p>';
    if (this.activePanel === 'phone' && this.phoneTab === 'wallet') this.renderPhone();
    this.emit('load-wallet', undefined);
  }

  showLedger(ledger: LedgerEntry[]) {
    this.ledger = ledger;
    this.walletLoading = false;
    this.walletError = '';
    this.el('ledger-list').innerHTML = ledger.length ? this.ledgerRows(ledger) : '<p class="empty-state">Your ledger will appear after your first transaction.</p>';
    if (this.activePanel === 'phone' && this.phoneTab === 'wallet') this.renderPhone();
  }

  showWalletError(message: string) {
    this.walletLoading = false;
    this.walletError = message;
    this.el('ledger-list').innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
    if (this.activePanel === 'phone' && this.phoneTab === 'wallet') this.renderPhone();
  }

  private ledgerRows(ledger: LedgerEntry[]) {
    return ledger.map((entry) => `<div class="ledger-row"><div><strong>${escapeHtml(entry.description)}</strong><small>${formatLedgerDate(entry.createdAt)}</small></div><span class="${entry.amountLrd >= 0 ? 'success' : ''}">${formatSignedLrd(entry.amountLrd)}</span><small>Balance ${formatLrd(entry.balanceAfterLrd)}</small></div>`).join('');
  }

  updateJobs(jobs: TaxiJob[], activeTrip: TaxiTrip | null) {
    this.jobs = jobs;
    this.activeTrip = activeTrip;
    if (this.world) { this.world.jobs = jobs; this.world.activeTrip = activeTrip; }
    this.el('job-count').textContent = String(jobs.length);
    this.el('dispatch-list').innerHTML = `${this.world?.activeTask ? '<p class="notice">Finish or cancel your active citizen task before accepting a passenger.</p>' : ''}${activeTrip ? this.tripCard(activeTrip) : ''}${jobs.map((job) => {
      const pickup = getLocation(job.pickupLocationId);
      const destination = getLocation(job.destinationLocationId);
      return `<article class="job-card"><div class="job-person"><span class="avatar">${escapeHtml(job.passengerName.charAt(0))}</span><div><strong>${escapeHtml(job.passengerName)}</strong><small>Server-reserved fare · ${formatLrd(job.fareLrd)}</small></div></div>
        <div class="job-route"><span>${escapeHtml(pickup.shortName)}</span><i>→</i><span>${escapeHtml(destination.shortName)}</span></div>
        <button class="primary-button" data-accept-job="${job.id}" ${activeTrip || this.world?.activeTask ? 'disabled' : ''}>Accept request</button></article>`;
    }).join('')}${!activeTrip && !jobs.length ? '<p class="empty-state">No open requests right now. Refresh dispatch for new deterministic NPC fares.</p>' : ''}`;
    const tripRoute = this.el('hud-trip-route');
    if (activeTrip) {
      const target = activeTrip.status === 'accepted' ? getLocation(activeTrip.pickupLocationId) : getLocation(activeTrip.destinationLocationId);
      this.el('objective-card').hidden = false;
      this.el('objective-kicker').textContent = activeTrip.status === 'accepted' ? 'PASSENGER PICKUP' : 'PASSENGER ABOARD';
      this.el('objective-name').textContent = activeTrip.passengerName;
      tripRoute.textContent = `${target.name} · ${formatLrd(activeTrip.fareLrd)}`;
    } else {
      this.el('objective-card').hidden = true;
      tripRoute.textContent = '';
    }
    if (this.activePanel === 'phone' && (this.phoneTab === 'dispatch' || this.phoneTab === 'home')) this.renderPhone();
  }

  updateTasks(state: CitizenTaskState) {
    if (this.world) Object.assign(this.world, state);
    if (this.activePanel === 'phone' && (this.phoneTab === 'tasks' || this.phoneTab === 'home' || this.phoneTab === 'civic')) this.renderPhone();
  }

  setTaskBusy(busy: boolean) {
    this.taskBusy = busy;
    if (this.activePanel === 'phone' && (this.phoneTab === 'tasks' || this.phoneTab === 'home' || this.phoneTab === 'civic')) this.renderPhone();
  }

  setTaskError(message: string) {
    this.taskError = message;
    this.civicError = message;
    if (this.activePanel === 'phone' && (this.phoneTab === 'tasks' || this.phoneTab === 'civic')) this.renderPhone();
  }

  updateCivic(state: CivicState) {
    if (this.world) this.world.civic = state;
    if (this.activePanel === 'phone' && (this.phoneTab === 'civic' || this.phoneTab === 'home')) this.renderPhone();
  }

  updateCivicIncidents(incidents: CivicIncident[]) {
    if (this.world) this.world.civic.incidents = incidents;
    if (this.activePanel === 'phone' && (this.phoneTab === 'civic' || this.phoneTab === 'home')) this.renderPhone();
  }

  updateSafety(safety: PlayerSafetyState) {
    if (this.world) this.world.civic.safety = safety;
    if (this.activePanel === 'phone' && this.phoneTab === 'civic') this.renderPhone();
  }

  setCivicBusy(busy: boolean) {
    this.civicBusy = busy;
    if (this.activePanel === 'phone' && this.phoneTab === 'civic') this.renderPhone();
  }

  setCivicError(message: string) {
    this.civicError = message;
    if (this.activePanel === 'phone' && this.phoneTab === 'civic') this.renderPhone();
  }

  private tripCard(trip: TaxiTrip) {
    return `<article class="active-trip-card"><p class="panel-kicker">ACTIVE SERVER TRIP</p><h3>${escapeHtml(trip.passengerName)}</h3><p>${trip.status === 'accepted' ? `Collect at ${escapeHtml(getLocation(trip.pickupLocationId).name)}` : `Deliver to ${escapeHtml(getLocation(trip.destinationLocationId).name)}`}</p><strong>${formatLrd(trip.fareLrd)}</strong><button class="secondary-button" data-cancel-trip>Cancel trip · no fare</button></article>`;
  }

  setPrompt(text: string | null) {
    this.el('interaction-prompt').hidden = !text;
    if (text) this.el('interaction-text').textContent = text;
  }

  setTripAction(action: 'pickup' | 'complete' | null) {
    this.el('trip-action').hidden = !action;
    this.el('trip-action').textContent = action === 'pickup' ? 'F · Pick up passenger' : action === 'complete' ? 'F · Complete trip & collect fare' : '';
  }

  setConnection(status: ConnectionStatus) {
    const previous = this.connection.phase;
    this.connection = { ...status };
    const pill = this.el('connection-pill');
    pill.classList.toggle('connected', status.phase === 'online');
    pill.dataset.phase = status.phase;
    pill.title = status.lastError ?? connectionPhaseLabel(status.phase);
    this.el('connection-label').textContent = connectionPhaseLabel(status.phase);
    if (previous !== status.phase) {
      if (status.phase === 'reconnecting' && previous === 'online') {
        this.notify({ category: 'connection', tone: 'error', title: 'District connection interrupted', message: status.lastError ?? 'Live updates are paused. Your active work has not been cancelled.', action: { type: 'reconnect', label: 'Retry now' } });
      } else if (status.phase === 'online' && (previous === 'reconnecting' || previous === 'offline')) {
        this.notify({ category: 'connection', tone: 'success', title: 'District connection restored', message: 'Live citizens, chat and Civic updates are available again.' });
      } else if (status.phase === 'offline' && previous !== 'idle') {
        this.notify({ category: 'connection', tone: 'error', title: 'You are offline', message: 'Reconnect before sending chat or relying on live district updates.', action: { type: 'reconnect', label: 'Reconnect' } });
      }
    }
    if (this.activePanel === 'connection') this.renderConnection();
    if (this.activePanel === 'social') this.renderSocialStatus();
  }

  updateSocialPlayers(players: NearbyCitizen[]) {
    const signature = socialRosterSignature(players);
    this.socialPlayers = [...players];
    if (signature === this.socialSignature) return;
    this.socialSignature = signature;
    if (this.activePanel === 'social') this.renderSocial();
  }

  addChat(message: { id?: string; playerId?: string; displayName: string; text: string; sentAt: string }) {
    const entry: SocialChatMessage = {
      id: message.id ?? `chat-${++this.chatSequence}`,
      ...(message.playerId ? { playerId: message.playerId } : {}),
      displayName: message.displayName, text: message.text, sentAt: message.sentAt,
    };
    this.chatHistory = appendSocialMessage(this.chatHistory, entry);
    const item = document.createElement('div');
    item.className = 'chat-message';
    const name = document.createElement('strong');
    name.textContent = `${message.displayName}: `;
    item.append(name, document.createTextNode(message.text));
    this.el('chat-messages').append(item);
    while (this.el('chat-messages').children.length > 12) this.el('chat-messages').firstElementChild?.remove();
    this.notify({ category: 'social', tone: 'info', title: `${message.displayName} · nearby chat`, message: message.text, action: { type: 'social', label: 'Open social' } }, { silent: true });
    if (this.activePanel === 'social') {
      this.notifications.markCategoryRead('social');
      this.updateNotificationBadge();
      this.renderSocialMessages();
    }
  }

  updateHUD(state: HUDState) {
    this.localDriving = state.mode === 'driving';
    this.localPosition = state.position;
    this.el('area-name').textContent = state.areaName;
    const gps = this.el('gps-status');
    const hasDestination = Boolean(state.destinationName) && state.destinationDistance !== null;
    gps.textContent = hasDestination ? `${state.destinationName} · ${Math.round(state.destinationDistance!)} m` : 'GPS · NORTH UP';
    gps.title = hasDestination ? `${state.destinationName}: ${Math.round(state.destinationDistance!)} m to the exact route objective` : 'GPS · north up';
    this.onlineCount = state.onlineCount;
    this.el('online-count').textContent = `${state.onlineCount} ONLINE`;
    const socialCount = document.getElementById('social-online-count');
    if (socialCount) socialCount.textContent = `${state.onlineCount} online · ${this.socialPlayers.length} nearby`;
    this.el('world-clock').textContent = formatGameTime(state.simulation.timeOfDaySeconds);
    this.el('phone-clock').textContent = formatGameTime(state.simulation.timeOfDaySeconds);
    this.el('weather-label').textContent = `${state.simulation.weather.toUpperCase()} · ${state.simulation.temperatureC}°C`;
    if (this.world) this.world.simulation = state.simulation;
    const environmentKey = `${state.simulation.weather}:${state.simulation.temperatureC}`;
    if (environmentKey !== this.phoneEnvironmentKey) {
      this.phoneEnvironmentKey = environmentKey;
      if (this.activePanel === 'phone' && this.phoneTab === 'home') this.renderPhone();
    }
    this.el('speed-value').textContent = String(Math.round(state.speedKmh));
    this.el('fuel-value').textContent = `${Math.round(state.fuelPercent)}%`;
    this.el('condition-value').textContent = `${Math.round(state.conditionPercent)}%`;
    this.el('vehicle-name').textContent = state.vehicleName;
    this.el('driving-cluster').classList.toggle('faded', state.mode !== 'driving');
    document.querySelectorAll<HTMLButtonElement>('[data-lights], [data-control="lights"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(state.lightsOn));
      button.classList.toggle('active', state.lightsOn);
      const label = button.querySelector('[data-light-label]');
      if (label) label.textContent = state.lightsOn ? 'Lights on' : 'Lights off';
    });
    this.el('touch-lights').hidden = state.mode !== 'driving';
    const health = this.el('health-status');
    health.hidden = state.health.condition === 'healthy';
    health.dataset.condition = state.health.condition;
    if (state.health.condition !== 'healthy') {
      const remaining = Math.max(0, Math.ceil(((state.health.recoverAt ?? state.simulation.serverTime) - state.simulation.serverTime) / 1000));
      health.textContent = state.health.condition === 'dead'
        ? `YOU DIED · respawn in ${remaining}s`
        : `INJURED · recovery in ${remaining}s · movement reduced`;
    }
  }

  updateHome(home: HomeHUDState | null) {
    this.localInsideHome = Boolean(home);
    this.localHomeId = home?.propertyId ?? null;
    this.el('hud').classList.toggle('inside-home', Boolean(home));
    const panel = this.el('home-navigator');
    panel.hidden = !home;
    if (!home) { this.homePanelId = null; return; }
    if (this.homePanelId !== home.propertyId) {
      this.homePanelId = home.propertyId;
      this.el('home-room-list').innerHTML = home.rooms.map((room) => `<button data-room="${room.id}"><span>${escapeHtml(room.name)}</span><small>View room</small></button>`).join('');
    }
    this.el('home-name').textContent = home.name;
    this.el('home-level').textContent = `LEVEL ${home.level} · PRIVATE RESIDENCE`;
    this.el('home-room-description').textContent = home.rooms.find((room) => room.id === home.currentRoomId)?.description ?? '';
    this.el('home-light-label').textContent = home.lightsOn ? 'Lights on' : 'Lights off';
    this.el('home-light-button').setAttribute('aria-pressed', String(home.lightsOn));
    document.querySelectorAll<HTMLButtonElement>('#home-room-list [data-room]').forEach((button) => {
      const current = button.dataset.room === home.currentRoomId;
      button.classList.toggle('active', current);
      if (current) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }

  openPanel(name: string) {
    const panel = this.el(`${name}-panel`);
    if (!this.activePanel) this.previousFocus = document.activeElement as HTMLElement;
    if (this.activePanel === 'phone' && name !== 'phone') this.phone.end();
    if (name !== 'showroom') this.dealership.close();
    document.querySelectorAll<HTMLElement>('.game-panel, .character-modal').forEach((item) => { item.hidden = true; });
    this.activePanel = name;
    this.el('panel-backdrop').hidden = false;
    panel.hidden = false;
    this.el('hud').inert = true;
    this.el('menu-screen').inert = true;
    this.el('game-canvas').inert = true;
    if (name === 'wallet') this.requestWallet();
    if (name === 'dispatch') this.emit('refresh-jobs', undefined);
    if (name === 'map') this.renderDestinations();
    if (name === 'notifications') {
      this.notifications.markAllRead();
      this.updateNotificationBadge();
      this.renderNotifications();
    }
    if (name === 'social') {
      this.notifications.markCategoryRead('social');
      this.updateNotificationBadge();
      this.renderSocial();
    }
    if (name === 'connection') this.renderConnection();
    if (name === 'phone') { this.renderPhone(); this.loadPhoneTab(this.phoneTab); }
    if (name === 'showroom' && this.lifestyle) this.dealership.open(this.lifestyle);
    this.emit('panel', name);
    requestAnimationFrame(() => panel.querySelector<HTMLElement>('button, input, select')?.focus());
  }

  closePanels() {
    if (this.activePanel === 'phone') this.phone.end();
    this.dealership.close();
    this.activePanel = null;
    this.el('panel-backdrop').hidden = true;
    document.querySelectorAll<HTMLElement>('.game-panel, .character-modal').forEach((item) => { item.hidden = true; });
    this.el('hud').inert = false;
    this.el('menu-screen').inert = false;
    this.el('game-canvas').inert = false;
    this.emit('panel', null);
    this.previousFocus?.focus();
  }

  private renderDestinations() {
    const locations = this.world?.locations ?? [];
    this.el('destination-list').innerHTML = locations.map((location) => `<button class="destination-item" data-location="${location.id}"><span>${escapeHtml(location.shortName)}</span><small>${escapeHtml(location.description)}</small></button>`).join('');
  }

  confirmAction(request: ConfirmationRequest) { return this.confirmation.open(request); }

  openPhone(tab: PhoneTab = 'home') {
    if (tab === 'vehicles') { this.openPanel('showroom'); return; }
    this.phoneTab = tab;
    this.openPanel('phone');
  }

  openCivic(target: CivicPanelTarget) {
    this.civicSection = target.section;
    this.civicDepartmentId = target.departmentId;
    this.civicIncidentId = target.incidentId;
    this.civicSiteId = target.siteId;
    this.openPhone('civic');
  }

  private renderPhoneCall(call: PhoneCallSnapshot | null) { this.call = call; this.renderCallStage(); }

  private renderPhone() {
    const titles: Record<PhoneTab, string> = {
      home: 'Citizen home', calls: 'Local services', vehicles: 'Seabreeze Motors', homes: 'Coastal Homes', garage: 'My garage',
      wallet: 'Citizen wallet', dispatch: 'Cooperative dispatch', tasks: 'Citizen tasks', civic: 'Civic services',
    };
    this.el('phone-app-title').textContent = titles[this.phoneTab];
    const tabs = Array.from(this.el('phone-tabs').querySelectorAll<HTMLButtonElement>('button[data-phone-tab]'));
    const anySelected = tabs.some((button) => button.dataset.phoneTab === this.phoneTab);
    tabs.forEach((button) => {
      const selected = button.dataset.phoneTab === this.phoneTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected || (!anySelected && button.dataset.phoneTab === 'home') ? 0 : -1;
    });
    const content = this.el('phone-content');
    switch (this.phoneTab) {
      case 'home': content.innerHTML = this.renderPhoneHome(); break;
      case 'calls': content.innerHTML = this.renderCalls(); break;
      case 'homes': content.innerHTML = this.renderHomes(); break;
      case 'garage': content.innerHTML = this.renderGarage(); break;
      case 'wallet': content.innerHTML = this.renderPhoneWallet(); break;
      case 'dispatch': content.innerHTML = this.renderPhoneDispatch(); break;
      case 'tasks': content.innerHTML = this.renderPhoneTasks(); break;
      case 'civic': content.innerHTML = this.world ? renderCivicView({
        world: this.world, activeTrip: this.activeTrip, section: this.civicSection,
        selectedDepartmentId: this.civicDepartmentId, selectedIncidentId: this.civicIncidentId, selectedSiteId: this.civicSiteId,
        busy: this.taskBusy || this.civicBusy, error: this.civicError,
        position: this.localPosition, onFoot: !this.localDriving && !this.localInsideHome,
      }) : phoneLoading(); break;
      case 'vehicles': break;
    }
    if (this.phoneTab === 'calls') this.renderCallStage();
  }

  private renderPhoneHome() {
    const state = this.lifestyle;
    const world = this.world;
    if (!state || !world) return phoneLoading();
    const selected = state.vehicles.find((vehicle) => vehicle.id === state.selectedVehicleId) ?? state.vehicles[0];
    const task = world.activeTask;
    const taskDefinition = task ? getCitizenTaskDefinition(task.templateId) : null;
    const taskStep = currentCitizenTaskStep(task);
    const trip = this.activeTrip;
    const activity = `${trip ? `<button class="phone-activity-card" data-phone-tab="dispatch"><span class="phone-activity-icon">→</span><span><small>ACTIVE PASSENGER · ${formatLrd(trip.fareLrd)}</small><strong>${escapeHtml(trip.passengerName)}</strong><span>${trip.status === 'accepted' ? `Pick up at ${escapeHtml(getLocation(trip.pickupLocationId).shortName)}` : `Deliver to ${escapeHtml(getLocation(trip.destinationLocationId).shortName)}`}</span></span><b>View</b></button>` : ''}
      ${task && taskDefinition ? `<button class="phone-activity-card task" data-phone-tab="tasks"><span class="phone-activity-icon">✓</span><span><small>ACTIVE CITIZEN TASK · ${formatLrd(task.rewardLrd)}</small><strong>${escapeHtml(taskDefinition.title)}</strong><span>${escapeHtml(taskStep?.label ?? 'Objective complete')}</span></span><b>${task.stepIndex + 1}/${taskDefinition.steps.length}</b></button>` : ''}`.trim();
    return `<section class="phone-home-view">
      <div class="phone-welcome"><span class="phone-profile-avatar">${escapeHtml(this.profile?.displayName.charAt(0).toUpperCase() ?? 'C')}</span><div><small>YOUR CITIZEN ASSISTANT</small><strong>Welcome, ${escapeHtml(this.profile?.displayName ?? 'Citizen')}.</strong><span>${this.profile?.reputation ?? 0} cooperative reputation</span></div><span class="phone-weather"><b>${escapeHtml(world.simulation.weather.toUpperCase())}</b>${world.simulation.temperatureC}°C</span></div>
      <div class="phone-home-balance"><div><small>AVAILABLE · SERVER-AUTHORITATIVE</small><strong>${formatLrd(state.wallet.balanceLrd)}</strong></div><button data-phone-tab="wallet">View ledger <span aria-hidden="true">→</span></button></div>
      <div class="phone-home-section-title"><span>NOW</span><small>${trip || task ? 'Live work in progress' : 'Ready for your next activity'}</small></div>
      <div class="phone-activity-stack">${activity || '<div class="phone-quiet-state"><strong>No active work</strong><span>Choose a passenger request or an on-foot citizen task below.</span></div>'}</div>
      ${selected ? `<button class="phone-selected-vehicle" data-phone-tab="garage"><span><small>SELECTED VEHICLE</small><strong>${escapeHtml(selected.model.name)}</strong><span>${escapeHtml(selected.plate)} · ${Math.round(selected.fuelPercent)}% fuel · ${Math.round(selected.conditionPercent)}% condition</span></span><b>Garage →</b></button>` : ''}
      <div class="phone-home-section-title"><span>APPLICATIONS</span><small>Real account & gameplay tools</small></div>
      <div class="phone-app-grid">
        ${this.phoneAppButton('dispatch', 'dispatch', '→', 'Dispatch', 'Passenger requests', this.jobs.length ? String(this.jobs.length) : '')}
        ${this.phoneAppButton('tasks', 'tasks', '✓', 'Tasks', 'Community objectives', task ? 'Active' : '')}
        ${this.phoneAppButton('civic', 'civic', '▥', 'Civic', 'Government & safety', String(world.civic.incidents.filter((incident) => incident.status === 'open').length))}
        ${this.phoneAppButton('wallet', 'wallet', 'L$', 'Wallet', 'Balance & ledger')}
        ${this.phoneExternalAppButton('social', '◎', 'Social', 'Nearby citizens & chat')}
        ${this.phoneExternalAppButton('notifications', '✦', 'Alerts', 'Activity & recovery', this.notifications.unreadCount() ? String(this.notifications.unreadCount()) : '')}
        ${this.phoneAppButton('vehicles', 'motors', '▱', 'Motors', '3D showroom')}
        ${this.phoneAppButton('homes', 'homes', '⌂', 'Homes', 'Titles & room access')}
        ${this.phoneAppButton('garage', 'garage', '▦', 'Garage', 'Vehicles & workshop')}
        ${this.phoneAppButton('calls', 'services', '☎', 'Services', 'Scripted NPC help')}
      </div>
      <p class="fine-print">District time and weather are simulated. Balances, ownership, jobs and task progress come from your citizen account.</p>
    </section>`;
  }

  private phoneAppButton(tab: PhoneTab, id: string, icon: string, title: string, description: string, badge = '') {
    return `<button class="phone-app-tile" data-phone-app="${id}" data-phone-tab="${tab}"><span class="phone-app-tile-icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${description}</small></span>${badge ? `<b>${escapeHtml(badge)}</b>` : ''}</button>`;
  }

  private phoneExternalAppButton(panel: string, icon: string, title: string, description: string, badge = '') {
    return `<button class="phone-app-tile" data-panel="${panel}"><span class="phone-app-tile-icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${description}</small></span>${badge ? `<b>${escapeHtml(badge)}</b>` : ''}</button>`;
  }

  private renderPhoneWallet() {
    const state = this.lifestyle;
    if (!state) return phoneLoading();
    const ledger = this.ledger;
    return `${this.phoneHeading('AUTHORITATIVE LRD', 'Citizen wallet', 'Your real server balance and completed transaction history. No client-set amounts.')}
      <section class="phone-wallet-card"><small>AVAILABLE BALANCE</small><strong>${formatLrd(state.wallet.balanceLrd)}</strong><span>Persistent Liberian-dollar game funds</span></section>
      <div class="phone-list-toolbar"><div><strong>Transaction history</strong><small>${this.walletLoading ? 'Refreshing…' : ledger ? `${ledger.length} recent entr${ledger.length === 1 ? 'y' : 'ies'}` : 'Waiting for ledger'}</small></div><button class="secondary-button" data-refresh-wallet ${this.walletLoading ? 'disabled' : ''}>${this.walletLoading ? 'Loading…' : 'Refresh'}</button></div>
      ${this.walletError ? `<div class="phone-inline-error" role="alert">${escapeHtml(this.walletError)}</div>` : ''}
      <div class="phone-ledger" aria-live="polite">${this.walletLoading && !ledger ? '<div class="phone-loading"><p>Loading your authoritative ledger…</p></div>' : ledger?.length ? this.ledgerRows(ledger) : '<p class="empty-state">Your ledger will appear after your first transaction.</p>'}</div>
      <p class="fine-print">Trip fares, task rewards, purchases and upgrades appear only after the server records them.</p>`;
  }

  private renderPhoneDispatch() {
    const task = this.world?.activeTask;
    const trip = this.activeTrip;
    const blocked = Boolean(trip || task);
    return `${this.phoneHeading('KENDEJA COOPERATIVE', 'Passenger dispatch', 'Deterministic NPC requests with server-reserved fares and exactly-once payment.')}
      ${task ? '<div class="notice">Finish or cancel your active citizen task before accepting a passenger.</div>' : ''}
      ${trip ? `<article class="phone-active-work"><small>ACTIVE SERVER TRIP</small><div class="phone-work-title"><div><strong>${escapeHtml(trip.passengerName)}</strong><span>${trip.status === 'accepted' ? 'Waiting for pickup' : 'Passenger aboard'}</span></div><b>${formatLrd(trip.fareLrd)}</b></div><div class="phone-route"><span>${escapeHtml(getLocation(trip.pickupLocationId).shortName)}</span><i>→</i><span>${escapeHtml(getLocation(trip.destinationLocationId).shortName)}</span></div><p>${trip.status === 'accepted' ? 'Follow GPS to the passenger, stop and press F.' : 'Follow GPS to the destination, stop and press F to collect the fare.'}</p><button class="primary-button" data-close-panels>Return to active route</button><button class="secondary-button" data-cancel-trip>Cancel trip · no fare</button></article>` : ''}
      <div class="phone-list-toolbar"><div><strong>${trip ? 'Other requests' : 'Open requests'}</strong><small>${this.jobs.length} available · one active trip maximum</small></div><button class="secondary-button" data-refresh-jobs>Refresh</button></div>
      <div class="phone-job-list" aria-live="polite">${this.jobs.map((job) => `<article class="phone-job-card"><div class="phone-work-title"><div><strong>${escapeHtml(job.passengerName)}</strong><span>NPC passenger</span></div><b>${formatLrd(job.fareLrd)}</b></div><div class="phone-route"><span>${escapeHtml(getLocation(job.pickupLocationId).shortName)}</span><i>→</i><span>${escapeHtml(getLocation(job.destinationLocationId).shortName)}</span></div><button class="primary-button" data-accept-job="${job.id}" ${blocked ? 'disabled' : ''}>${trip ? 'Finish active trip first' : task ? 'Finish active task first' : 'Accept request'}</button></article>`).join('') || '<p class="empty-state">No open requests right now. Refresh for new deterministic NPC fares.</p>'}</div>`;
  }

  private renderPhoneTasks() {
    const world = this.world;
    if (!world) return phoneLoading();
    const task = world.activeTask;
    const stats = world.taskStats;
    const activeTrip = this.activeTrip;
    return `${this.phoneHeading('COMMUNITY WORK', 'Citizen tasks', 'Real on-foot objectives with server-verified progress and exactly-once LRD rewards.')}
      <div class="phone-account-strip"><span>COMPLETED <strong>${stats.completed}</strong></span><span>TASK EARNINGS <strong>${formatLrd(stats.earnedLrd)}</strong></span></div>
      ${this.taskError ? `<div class="phone-inline-error" role="alert">${escapeHtml(this.taskError)}</div>` : ''}
      <section class="phone-task-content" aria-busy="${this.taskBusy}">${task ? this.renderActiveTask(task.id, task.templateId, task.stepIndex, task.rewardLrd) : this.renderTaskCatalog(Boolean(activeTrip))}</section>
      <p class="fine-print">One citizen task at a time. Passenger trips and citizen tasks are mutually exclusive; cancelling a task pays no reward.</p>`;
  }

  private renderActiveTask(taskId: string, templateId: string, stepIndex: number, rewardLrd: number) {
    const definition = getCitizenTaskDefinition(templateId);
    const progress = Math.min(100, Math.round((stepIndex / definition.steps.length) * 100));
    const current = definition.steps[stepIndex];
    return `<article class="phone-task-active"><div class="phone-task-heading"><div><small>${escapeHtml(definition.category)} · ACTIVE</small><h4>${escapeHtml(definition.title)}</h4></div><strong>${formatLrd(rewardLrd)}</strong></div><p>${escapeHtml(definition.description)}</p><div class="phone-task-progress-label"><span>${stepIndex} of ${definition.steps.length} objectives complete</span><b>${progress}%</b></div><div class="phone-task-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><ol class="phone-task-steps">${definition.steps.map((step, index) => `<li class="${index < stepIndex ? 'complete' : index === stepIndex ? 'current' : ''}"><span>${index < stepIndex ? '✓' : index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(getLocation(step.locationId).name)}${index === stepIndex ? ' · Current objective' : ''}</small></div></li>`).join('')}</ol>${current ? `<div class="phone-current-objective"><small>NEXT IN THE DISTRICT</small><strong>${escapeHtml(current.label)}</strong><span>Close the phone, follow GPS to the glowing sign and press E while standing at the marked object on foot.</span></div><button class="primary-button" data-close-panels>Return to current objective</button>` : ''}<button class="secondary-button" data-cancel-task="${taskId}" ${this.taskBusy ? 'disabled' : ''}>${this.taskBusy ? 'Cancelling…' : 'Cancel active task'}</button></article>`;
  }

  private renderTaskCatalog(hasActiveTrip: boolean) {
    return `${hasActiveTrip ? '<div class="notice">Finish or cancel your active passenger trip before accepting a citizen task.</div>' : ''}<div class="phone-task-catalog">${CITIZEN_TASKS.filter((task) => !task.incidentKind).map((task) => `<article class="phone-task-card"><div class="phone-task-heading"><div><small>${escapeHtml(task.category)}</small><h4>${escapeHtml(task.title)}</h4></div><strong>${formatLrd(task.rewardLrd)}</strong></div><p>${escapeHtml(task.description)}</p><div class="phone-task-meta"><span>${task.steps.length} on-foot objectives</span><span>Starts · ${escapeHtml(getLocation(task.steps[0]!.locationId).name)}</span></div><button class="primary-button" data-accept-task="${task.id}" ${this.taskBusy || hasActiveTrip ? 'disabled' : ''}>${this.taskBusy ? 'Working…' : hasActiveTrip ? 'Finish active trip first' : 'Accept citizen task'}</button></article>`).join('')}</div>`;
  }

  private renderCalls() {
    return `${this.phoneHeading('LOCAL SERVICES', 'Your contacts', 'Scripted NPC text responses. No real-world calls, telecom charges or player voice chat.')}
      <div id="call-stage" aria-live="polite"></div><div class="contact-list">${PHONE_CONTACTS.map((contact) => `<button class="contact-card" data-call="${contact.id}"><span class="contact-avatar">${contact.name.charAt(0)}</span><span class="contact-copy"><strong>${contact.name}</strong><small>${contact.role}</small><span>${contact.number}</span></span><span class="round-action" aria-hidden="true">☎</span><span class="sr-only">Call ${contact.name}</span></button>`).join('')}</div>`;
  }

  private renderCallStage() {
    const stage = document.getElementById('call-stage');
    if (!stage) return;
    if (!this.call) { stage.innerHTML = ''; delete stage.dataset.callRenderKey; return; }
    const call = this.call;
    const statusText = call.status === 'connecting' ? 'Connecting…' : `Connected · ${formatCallTime(call.elapsedSeconds)}`;
    const renderKey = `${call.contact.id}:${call.status}:${call.visibleLines.length}`;
    if (stage.dataset.callRenderKey === renderKey) {
      const status = stage.querySelector('[data-call-status]');
      if (status) status.textContent = statusText;
      return;
    }
    stage.dataset.callRenderKey = renderKey;
    stage.innerHTML = `<article class="call-card ${call.status}"><div class="call-topline"><span class="call-status"><i></i><span data-call-status>${statusText}</span></span><span>LOCAL TEXT SIMULATION</span></div>
      <div class="call-person"><span class="contact-avatar">${call.contact.name.charAt(0)}</span><div><strong>${call.contact.name}</strong><small>${call.contact.number}</small></div></div>
      <div class="call-transcript">${call.status === 'connecting' ? '<p>Opening a local service line…</p>' : call.visibleLines.map((line) => `<p>${line}</p>`).join('')}</div>
      <div class="call-actions">${call.status === 'connected' ? `<button class="primary-button" data-phone-action="${call.contact.action}">${call.contact.actionLabel}</button>` : ''}<button class="secondary-button" data-end-call>End call</button></div></article>`;
  }

  private renderHomes() {
    const state = this.lifestyle;
    if (!state) return phoneLoading();
    return `${this.phoneHeading('COASTAL HOMES', 'Property portfolio', 'Your server-verified titles, real walkable interiors and permanent garage benefits in one place.')}
      <div class="phone-account-strip"><span>TITLES <strong>${state.properties.length} / ${PROPERTY_CATALOG.length}</strong></span><span>GARAGE CAPACITY <strong>${state.garageCapacity}</strong></span></div><div class="property-portfolio">${PROPERTY_CATALOG.map((property) => {
      const owned = state.properties.find((entry) => entry.listingId === property.id);
      const nextLevel = owned ? owned.level + 1 : 1;
      const maxed = Boolean(owned && owned.level >= MAX_PROPERTY_LEVEL);
      const cost = owned && !maxed ? propertyUpgradeCost(property, nextLevel) : property.priceLrd;
      const affordable = state.wallet.balanceLrd >= cost;
      const disabled = this.commerceBusy || maxed || !affordable;
      const label = maxed ? 'Maximum level' : !affordable ? `Need ${formatLrd(cost - state.wallet.balanceLrd)} more` : owned ? `Upgrade to level ${nextLevel} · ${formatLrd(cost)}` : `Purchase title · ${formatLrd(cost)}`;
      const location = getLocation(property.locationId);
      return `<article class="portfolio-property ${owned ? 'owned' : ''}"><div class="property-visual">${propertyIllustration(property.id)}<span>${escapeHtml(location.shortName)}</span>${owned ? '<b class="owned-badge">TITLE VERIFIED</b>' : `<strong>${formatLrd(property.priceLrd)}</strong>`}</div><div class="property-body"><div class="listing-title"><div><p class="panel-kicker">${owned ? `OWNED HOME · LEVEL ${owned.level}` : 'RESIDENTIAL LISTING'}</p><h3>${property.name}</h3></div>${owned ? '<span class="title-check" aria-label="Owned">✓</span>' : ''}</div><p class="listing-description">${property.description}</p><div class="property-facts"><span><b>5</b><small>Spaces<br>Hall + 4 rooms</small></span><span><b>${owned?.level ?? 1}</b><small>Home level<br>Furnishing tier</small></span><span><b>+${owned?.level ?? 1}</b><small>Garage slots<br>At current level</small></span></div><div class="room-feature-list"><span>Living room</span><span>Kitchen</span><span>Bedroom</span><span>Bathroom</span></div>${owned ? `<button class="primary-button property-access" data-access-property="${owned.id}">${this.localHomeId === owned.id ? 'Return to room navigator' : 'Enter home / set directions'} <span aria-hidden="true">→</span></button><p class="access-note">Walk to the front door and press E. Inside, use the room navigator to visit furnished spaces.</p>` : ''}<button class="${owned ? 'secondary-button' : 'primary-button'}" ${owned && !maxed ? `data-upgrade-property="${owned.id}"` : !owned ? `data-buy-property="${property.id}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button></div></article>`;
    }).join('')}</div><p class="fine-print">Titles, upgrades and LRD charges are authoritative and idempotent. Home levels add real furnishings and garage capacity; purchases cannot be repeated.</p>`;
  }

  private renderGarage() {
    const state = this.lifestyle;
    if (!state) return phoneLoading();
    const upgrades = Object.entries(VEHICLE_UPGRADES) as [VehicleUpgradeKind, (typeof VEHICLE_UPGRADES)[VehicleUpgradeKind]][];
    return `${this.phoneHeading('YOUR GARAGE', 'Vehicles & workshop', `${state.vehicles.length} / ${state.garageCapacity} slots · Select on foot. Upgrades change real handling and persist.`)}
      ${this.activeTrip ? '<div class="notice">Finish your active taxi trip before selecting or upgrading a vehicle.</div>' : this.localDriving ? '<div class="notice">Park and exit your vehicle before selecting or upgrading it.</div>' : this.localInsideHome ? '<div class="notice">Step outside your home before selecting or upgrading a vehicle.</div>' : ''}<div class="garage-list">${state.vehicles.map((vehicle) => {
        const selected = vehicle.id === state.selectedVehicleId;
        const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === vehicle.modelId);
        const blocked = this.commerceBusy || Boolean(this.activeTrip) || this.localDriving || this.localInsideHome;
        const paintName = vehiclePaint(vehicle.paintId)?.name ?? 'Factory paint';
        const finishName = VEHICLE_PAINT_FINISHES[vehicle.finish].name;
        return `<article class="garage-card ${selected ? 'selected' : ''}"><div class="garage-summary"><div class="garage-visual">${vehicleIllustration(listing?.visual ?? 'sedan', vehicle.color)}</div><div class="garage-title"><p class="panel-kicker">${selected ? 'SELECTED VEHICLE' : vehicle.taxi ? 'TAXI VEHICLE' : 'PRIVATE VEHICLE'}</p><h3>${escapeHtml(vehicle.model.name)}</h3><span>${escapeHtml(vehicle.plate)} · ${Math.round(vehicle.fuelPercent)}% fuel · ${Math.round(vehicle.conditionPercent)}% condition</span><small class="garage-configuration">${escapeHtml(paintName)} · ${escapeHtml(finishName)}</small><div class="spec-row"><span><b>${Math.round(vehicle.model.maxSpeed * 3.6)}</b> km/h</span><span><b>${vehicle.model.acceleration.toFixed(1)}</b> m/s²</span><span><b>${Math.round(vehicle.model.grip * 100)}%</b> grip</span></div></div><button class="secondary-button" data-select-vehicle="${vehicle.id}" ${selected || blocked ? 'disabled' : ''}>${selected ? 'Selected' : 'Select vehicle'}</button></div>
          <div class="upgrade-grid">${upgrades.map(([kind, upgrade]) => {
            const level = vehicle.upgrades[kind];
            const next = level + 1;
            const maxed = level >= MAX_VEHICLE_UPGRADE_LEVEL;
            const cost = maxed ? 0 : vehicleUpgradeCost(kind, next);
            const affordable = state.wallet.balanceLrd >= cost;
            const disabled = blocked || maxed || !affordable;
            return `<div class="upgrade-row"><div><strong>${upgrade.name}</strong><small>${upgrade.description}</small><span class="level-pips" aria-label="Level ${level} of ${MAX_VEHICLE_UPGRADE_LEVEL}">${Array.from({ length: MAX_VEHICLE_UPGRADE_LEVEL }, (_, index) => `<i class="${index < level ? 'filled' : ''}"></i>`).join('')}</span></div><button class="secondary-button" data-upgrade-vehicle="${vehicle.id}" data-upgrade-kind="${kind}" ${disabled ? 'disabled' : ''}>${maxed ? 'Max level' : !affordable ? `Need ${formatLrd(cost - state.wallet.balanceLrd)}` : `Level ${next} · ${formatLrd(cost)}`}</button></div>`;
          }).join('')}</div></article>`;
      }).join('')}</div>`;
  }

  private phoneHeading(kicker: string, title: string, description: string) {
    return `<div class="phone-section-heading"><div><p class="panel-kicker">${kicker}</p><h3>${title}</h3></div><span class="secure-badge">CITIZEN OS</span></div><p class="section-description">${description}</p>`;
  }

  private handlePhoneClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.call) this.phone.start(button.dataset.call);
    if (button.hasAttribute('data-end-call')) this.phone.end();
    if (button.hasAttribute('data-refresh-wallet')) this.requestWallet();
    if (button.dataset.acceptTask) this.emit('accept-task', button.dataset.acceptTask);
    if (button.dataset.acceptCivicTask && button.dataset.template) this.emit('accept-civic-task', { templateId: button.dataset.template, incidentId: button.dataset.acceptCivicTask });
    if (button.dataset.reportSite) this.emit('report-civic', button.dataset.reportSite);
    if (button.dataset.civicSection) {
      this.civicSection = button.dataset.civicSection as CivicSection;
      this.civicIncidentId = undefined; this.civicSiteId = undefined;
      this.renderPhone();
    }
    if (button.dataset.civicWaypoint && button.dataset.location && button.dataset.x && button.dataset.z) {
      this.emit('civic-waypoint', {
        key: button.dataset.civicWaypoint, locationId: button.dataset.location,
        x: Number(button.dataset.x), z: Number(button.dataset.z), label: button.dataset.label ?? 'Civic destination',
      });
    }
    if (button.dataset.cancelTask) this.emit('cancel-task', button.dataset.cancelTask);
    if (button.dataset.phoneAction) {
      const action = button.dataset.phoneAction as PhoneAction;
      if (action === 'dispatch') this.navigatePhone('dispatch', button);
      if (action === 'vehicles') this.openPanel('showroom');
      if (action === 'homes') { this.phoneTab = 'homes'; this.renderPhone(); }
      if (action === 'garage') { this.phoneTab = 'garage'; this.renderPhone(); }
    }
    if (button.dataset.accessProperty) this.emit('access-property', button.dataset.accessProperty);
    if (button.dataset.buyProperty) this.emit('buy-property', button.dataset.buyProperty);
    if (button.dataset.upgradeProperty) this.emit('upgrade-property', button.dataset.upgradeProperty);
    if (button.dataset.upgradeVehicle) this.emit('upgrade-vehicle', { vehicleId: button.dataset.upgradeVehicle, kind: button.dataset.upgradeKind as VehicleUpgradeKind });
    if (button.dataset.selectVehicle) this.emit('select-vehicle', button.dataset.selectVehicle);
  }

  notify(input: NotificationInput, options: { silent?: boolean } = {}) {
    const item = this.notifications.add(input);
    if (this.activePanel === 'notifications') this.notifications.markAllRead();
    this.updateNotificationBadge();
    if (this.activePanel === 'notifications') this.renderNotifications();
    if (!options.silent) this.renderToast(item);
    return item;
  }

  toast(message: string, kind: NotificationTone = 'info', category: NotificationCategory = 'system') {
    return this.notify({
      category, tone: kind,
      title: kind === 'success' ? 'Action completed' : kind === 'error' ? 'Action needs attention' : 'District update',
      message,
    });
  }

  private updateNotificationBadge() {
    const count = this.notifications.unreadCount();
    const badge = this.el('notification-count');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    const button = this.el('notifications-button');
    button.classList.toggle('has-unread', count > 0);
    button.setAttribute('aria-label', count ? `Open notifications, ${count} unread` : 'Open notifications');
  }

  private renderToast(item: AppNotification) {
    const toast = document.createElement('article');
    toast.className = `toast ${item.tone}`;
    toast.setAttribute('role', item.tone === 'error' ? 'alert' : 'status');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.tone === 'success' ? '✓' : item.tone === 'error' ? '!' : 'i';
    const copy = document.createElement('div');
    copy.className = 'toast-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const message = document.createElement('span');
    message.textContent = item.message;
    copy.append(title, message);
    toast.append(icon, copy);
    if (item.action) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'toast-action';
      action.dataset.notificationAction = item.action.type;
      action.textContent = item.action.label;
      toast.append(action);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-dismiss';
    close.dataset.dismissToast = '';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    toast.append(close);
    this.el('toast-stack').append(toast);
    while (this.el('toast-stack').children.length > 4) this.el('toast-stack').firstElementChild?.remove();
    setTimeout(() => toast.remove(), item.tone === 'error' || item.action ? 7000 : 4800);
  }

  private renderNotifications() {
    const list = this.notifications.list(this.notificationFilter);
    const filters: [NotificationFilter, string][] = [['all', 'All'], ['transaction', 'Transactions'], ['civic', 'Civic'], ['connection', 'Connection'], ['social', 'Social']];
    this.el('notification-filters').innerHTML = filters.map(([filter, label]) => `<button type="button" class="notification-filter ${this.notificationFilter === filter ? 'active' : ''}" data-notification-filter="${filter}" aria-pressed="${this.notificationFilter === filter}">${label}${filter !== 'all' && this.notifications.unreadCount(filter) ? ` <b>${this.notifications.unreadCount(filter)}</b>` : ''}</button>`).join('');
    this.el('notification-summary').textContent = `${this.notifications.unreadCount()} unread · ${this.notifications.list().length} retained this session`;
    this.el('notification-list').innerHTML = list.length ? list.map((item) => `<article class="notification-item ${item.tone} ${item.read ? '' : 'unread'}">
      <span class="notification-item-icon" aria-hidden="true">${item.tone === 'success' ? '✓' : item.tone === 'error' ? '!' : 'i'}</span>
      <div class="notification-item-copy"><div class="notification-item-meta"><span>${notificationCategoryLabel(item.category)}</span><time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatNotificationTime(item.createdAt))}</time></div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p>${item.action ? `<button type="button" class="notification-item-action" data-notification-action="${item.action.type}">${escapeHtml(item.action.label)} <span aria-hidden="true">→</span></button>` : ''}</div>
    </article>`).join('') : '<div class="notification-empty"><span aria-hidden="true">✓</span><strong>You’re all caught up</strong><p>New transaction, Civic, connection and social updates will appear here for this session.</p></div>';
    const markRead = this.el<HTMLButtonElement>('mark-notifications-read');
    markRead.disabled = this.notifications.unreadCount() === 0;
  }

  private renderSocial() {
    const local = this.profile;
    const roster = this.socialPlayers;
    this.el('social-online-count').textContent = `${this.onlineCount} online · ${roster.length} nearby`;
    this.el('social-roster').innerHTML = `${local ? `<article class="social-person local"><span class="social-avatar">${escapeHtml(local.displayName.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(local.displayName)} <em>You</em></strong><small>@${escapeHtml(local.handle)} · ${local.reputation} reputation</small></div><span class="social-presence">ONLINE</span></article>` : ''}${roster.map((player) => `<article class="social-person"><span class="social-avatar">${escapeHtml(player.displayName.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(player.displayName)}</strong><small>@${escapeHtml(player.handle)} · ${escapeHtml(citizenActivityLabel(player))}</small></div><span class="social-presence">${player.insideHome ? 'AWAY' : 'NEARBY'}</span></article>`).join('')}${!roster.length ? '<div class="social-empty"><strong>No other citizens nearby</strong><p>Players within your realtime area will appear here automatically. Explore the district to meet someone.</p></div>' : ''}`;
    this.renderSocialMessages();
    this.renderSocialStatus();
  }

  private renderSocialMessages() {
    const container = this.el('social-chat-messages');
    container.innerHTML = this.chatHistory.length ? this.chatHistory.map((message) => `<article class="social-chat-message ${message.playerId && message.playerId === this.profile?.id ? 'own' : ''}"><div><strong>${escapeHtml(message.displayName)}</strong><time datetime="${escapeHtml(message.sentAt)}">${escapeHtml(formatNotificationTime(message.sentAt))}</time></div><p>${escapeHtml(message.text)}</p></article>`).join('') : '<div class="social-empty chat-empty"><strong>Start a nearby conversation</strong><p>Messages are delivered through the district server to citizens in your vicinity.</p></div>';
    container.scrollTop = container.scrollHeight;
  }

  private renderSocialStatus() {
    const online = this.connection.phase === 'online';
    const status = this.el('social-connection-status');
    status.dataset.phase = this.connection.phase;
    status.textContent = online ? 'LIVE · proximity chat and waves are available' : `${connectionPhaseLabel(this.connection.phase)} · reconnect to send messages`;
    this.el<HTMLButtonElement>('social-chat-send').disabled = !online;
    this.el<HTMLButtonElement>('social-wave').disabled = !online;
  }

  private renderConnection() {
    const status = this.connection;
    const online = status.phase === 'online';
    this.el('connection-status-badge').textContent = connectionPhaseLabel(status.phase);
    this.el('connection-status-badge').dataset.phase = status.phase;
    this.el('connection-status-title').textContent = online ? 'You’re connected to the district' : status.phase === 'reconnecting' ? 'We’re trying to restore your connection' : status.phase === 'offline' ? 'You’re currently offline' : 'Connecting to the district';
    this.el('connection-status-detail').textContent = status.lastError ?? (online ? 'Live movement, nearby citizens, chat and Civic updates are flowing normally.' : 'Your active passenger trips, tasks and wallet remain on the server. Live updates will resume after reconnection.');
    this.el('connection-retry-detail').textContent = status.phase === 'reconnecting' ? `Attempt ${Math.max(1, status.attempt)} · ${status.nextRetryAt ? 'Automatic retry scheduled' : 'Preparing the next retry'}` : online ? 'No action needed. You can review recent connection events in Notifications.' : 'Use Retry now if your network has recovered. Nothing is purchased or cancelled by retrying.';
    this.el<HTMLButtonElement>('connection-retry').disabled = online || status.phase === 'connecting';
    this.el<HTMLButtonElement>('connection-retry').textContent = status.phase === 'connecting' ? 'Connecting…' : 'Retry now';
  }

  private handleNotificationAction(action: NotificationActionType) {
    if (action === 'wallet') this.openPanel('wallet');
    if (action === 'civic') this.openPhone('civic');
    if (action === 'social') this.openPanel('social');
    if (action === 'connection') this.openPanel('connection');
    if (action === 'reconnect') this.emit('reconnect', undefined);
    if (action === 'refresh-dispatch') this.emit('refresh-jobs', undefined);
    if (action === 'refresh-civic') this.emit('load-civic', undefined);
    if (action === 'refresh-wallet') this.requestWallet();
    if (action === 'sign-in') this.emit('reauthenticate', undefined);
  }

}

function notificationCategoryLabel(category: NotificationCategory) {
  return ({ transaction: 'TRANSACTION', civic: 'CIVIC', connection: 'CONNECTION', social: 'SOCIAL', system: 'DISTRICT' })[category];
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appearanceChoices(name: keyof CharacterAppearance, label: string, count: number, selected: number) {
  return `<fieldset><legend>${label}</legend><div class="swatches">${Array.from({ length: count }, (_, value) => `<label><input type="radio" name="${name}" value="${value}" ${value === selected ? 'checked' : ''}><span>${name === 'hair' ? ['Short', 'Natural', 'Fade', 'Head wrap'][value] : value + 1}</span></label>`).join('')}</div></fieldset>`;
}

function phoneLoading() { return '<div class="phone-loading"><p>Loading your citizen account…</p></div>'; }
function formatCallTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function formatLedgerDate(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatSignedLrd(amount: number) {
  return amount < 0 ? `−${formatLrd(Math.abs(amount))}` : `+${formatLrd(amount)}`;
}

function modernVehicleIllustration(visual: 'modern-sedan' | 'modern-suv', color: string) {
  const suv = visual === 'modern-suv';
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#315c73';
  const body = suv
    ? 'M24 90Q28 70 55 65L86 31Q97 20 121 19H195Q216 22 232 48L270 60Q289 67 294 84L289 98H29Z'
    : 'M24 88Q28 73 57 68L93 40Q105 28 130 26H181Q205 28 228 54L268 65Q287 70 294 85L289 96H29Z';
  const frontGlass = suv ? 'M73 61L96 35Q105 27 122 27H151V61Z' : 'M80 63L105 39Q113 33 132 32H155V63Z';
  const rearGlass = suv ? 'M159 27H192Q207 30 221 50L226 61H159Z' : 'M163 32H180Q198 35 216 56L220 63H163Z';
  const wheel = (cx: number, cy: number) => {
    const spokes = Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3;
      const x1 = cx + Math.cos(angle) * 5;
      const y1 = cy + Math.sin(angle) * 5;
      const x2 = cx + Math.cos(angle) * 14;
      const y2 = cy + Math.sin(angle) * 14;
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }).join('');
    return `<g><circle cx="${cx}" cy="${cy}" r="24" fill="#101719"/><circle cx="${cx}" cy="${cy}" r="16" fill="#263438" stroke="#aab7b9" stroke-width="2"/><g stroke="#bdc7c7" stroke-width="3" stroke-linecap="round">${spokes}</g><circle cx="${cx}" cy="${cy}" r="4" fill="#d2d8d6"/></g>`;
  };
  return `<svg class="vehicle-illustration modern-vehicle-illustration" viewBox="0 0 320 130" role="img" aria-label="${suv ? 'Modern urban SUV' : 'Modern sport sedan'} illustration"><ellipse cx="160" cy="108" rx="132" ry="10" fill="rgba(14,30,31,.2)"/><path d="${body}" fill="${safeColor}" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/><path d="${frontGlass} ${rearGlass}" fill="#15323d"/><path d="M158 ${suv ? 27 : 32}V${suv ? 62 : 64}" stroke="#263b40" stroke-width="4"/><path d="M46 70Q130 54 267 67" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2"/>${suv ? '<path d="M105 18H202" stroke="#263537" stroke-width="4" stroke-linecap="round"/><path d="M116 18V24M191 18V24" stroke="#263537" stroke-width="3"/>' : '<path d="M46 67L70 62" stroke="#263537" stroke-width="4" stroke-linecap="round"/>'}<path d="M164 66V85M212 65L216 84" stroke="rgba(17,38,40,.38)"/><path d="M176 72H192M218 70H232" stroke="#d3dbd7" stroke-width="2" stroke-linecap="round"/><path d="M265 72L285 76" stroke="#edf9ed" stroke-width="4" stroke-linecap="round"/><path d="M32 76L48 72" stroke="#c93d43" stroke-width="4" stroke-linecap="round"/>${wheel(84, 91)}${wheel(238, 91)}<path d="M113 101H207" stroke="#1b292b" stroke-width="4" stroke-linecap="round"/></svg>`;
}

function vehicleIllustration(visual: VehicleVisualKind, color: string) {
  if (visual === 'modern-sedan' || visual === 'modern-suv') return modernVehicleIllustration(visual, color);
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#e8b84b';
  const roof = visual === 'minibus' ? 'M57 51V20Q57 13 65 13H169Q180 13 184 24L194 51' : visual === 'hatchback' ? 'M65 50L91 22Q96 17 105 17H157Q168 18 178 31L190 50' : 'M65 50L94 22Q99 18 108 18H151Q160 18 168 26L187 50';
  return `<svg class="vehicle-illustration" viewBox="0 0 240 100" role="img" aria-label="${visual} illustration"><ellipse cx="122" cy="82" rx="97" ry="8" fill="rgba(0,0,0,.18)"/><path d="${roof}L207 56Q216 59 218 70L216 76H27L24 67Q25 57 38 54Z" fill="${safeColor}" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/><path d="M76 47L98 25Q101 22 108 22H126V47ZM134 22H150Q157 22 163 29L177 47H134Z" fill="#9bbbc4" opacity=".82"/><path d="M31 58H211" stroke="rgba(255,255,255,.32)"/><rect x="198" y="58" width="15" height="6" rx="2" fill="#fff1ba"/><circle cx="65" cy="74" r="16" fill="#14212a"/><circle cx="65" cy="74" r="8" fill="#a4adb2"/><circle cx="181" cy="74" r="16" fill="#14212a"/><circle cx="181" cy="74" r="8" fill="#a4adb2"/></svg>`;
}

function propertyIllustration(propertyId: string) {
  const coastal = propertyId === 'coastal-cottage';
  const wall = coastal ? '#d7dfd2' : '#dfcda9';
  const accent = coastal ? '#5f8f88' : '#a86d45';
  return `<svg class="property-illustration" viewBox="0 0 320 150" role="img" aria-label="${coastal ? 'Coastal cottage' : 'Courtyard studio'} architectural illustration"><rect width="320" height="150" fill="${coastal ? '#b9d2cf' : '#c9d2c3'}"/><circle cx="265" cy="30" r="18" fill="#f4d891" opacity=".8"/><path d="M0 112Q70 94 145 110T320 101V150H0Z" fill="#799b7d"/><path d="M39 120H282" stroke="#d7ccb1" stroke-width="17"/><path d="M72 67L153 24L246 65V119H72Z" fill="${wall}" stroke="#49645d" stroke-width="2"/><path d="M57 69L151 17L260 64L249 73L152 32L67 80Z" fill="${accent}"/><rect x="91" y="76" width="42" height="27" rx="1" fill="#8fb4ba" stroke="#f3ead6" stroke-width="4"/><path d="M112 77V102M92 89H132" stroke="#e9e5d8" stroke-width="2"/><rect x="181" y="73" width="34" height="46" fill="#536d64"/><circle cx="207" cy="96" r="2" fill="#e8c369"/><rect x="154" y="48" width="25" height="18" fill="#91b6ba" stroke="#f1e9d8" stroke-width="3"/><path d="M279 111V62M279 65Q258 51 254 67Q268 72 279 65ZM279 65Q298 46 305 62Q295 72 279 65Z" stroke="#436f5c" stroke-width="4" fill="#588b6c"/><path d="M45 119V86M45 88Q28 77 25 90Q35 95 45 88ZM45 88Q59 73 67 85Q59 94 45 88Z" stroke="#4c775f" stroke-width="3" fill="#679174"/></svg>`;
}

function shell() {
  return `<canvas id="game-canvas" aria-label="Interactive fictional coastal district"></canvas><div id="world-shade" class="world-shade"></div>
    <div id="loading" class="loading"><span>TAXI-LIB</span><i></i><span>PREPARING YOUR DISTRICT</span></div>
    <section id="menu-screen" class="menu-screen"><header class="menu-header"><div class="brand" aria-label="Taxi-LIB"><span class="brand-mark">TL</span><span><b>TAXI-LIB</b><small>BUILD A LIFE. MOVE A CITY.</small></span></div><div class="world-status"><i></i> COASTAL DISTRICT <span>/</span> MULTIPLAYER</div></header>
      <div class="menu-layout"><div class="hero-copy"><p class="eyebrow"><span></span> A LIBERIAN-INSPIRED WORLD</p><h1>Your route.<br>Your livelihood.<br><em>Your story.</em></h1><p class="hero-description">Drive passengers, build your savings and settle into a living coastal district with other citizens.</p><div class="hero-tags"><span>◉ Persistent LRD economy</span><span>◉ Real vehicle handling</span><span>◉ Simulated local services</span></div></div>
      <div class="menu-card"><div id="auth-view"><p class="card-kicker">CITIZEN ACCESS</p><h2>Welcome to the cooperative.</h2><p class="card-subtitle">Sign in to continue your life, or create a citizen account with a starter taxi and L$ 12,500.</p><div class="auth-tabs"><button class="active" data-auth-tab="login">Sign in</button><button data-auth-tab="register">Create account</button></div>
        <form id="login-form" class="auth-form"><label>Citizen handle<input id="login-handle" autocomplete="username" required placeholder="your-handle"></label><label>Password<input id="login-password" type="password" autocomplete="current-password" required></label><p id="auth-error" class="form-error" role="alert"></p><button class="primary-button" type="submit">Sign in securely</button></form>
        <form id="register-form" class="auth-form" hidden><label>Display name<input id="register-name" autocomplete="nickname" minlength="2" maxlength="24" required placeholder="Your citizen name"></label><label>Unique handle<input id="register-handle" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required placeholder="musu-driver"></label><label>Password<input id="register-password" type="password" autocomplete="new-password" minlength="8" required></label><p class="form-error" data-register-error></p><button class="primary-button" type="submit">Create citizen account</button></form><p class="local-note">Fictionalized, compressed geography. No real-money purchases or real-world telephony.</p></div>
      <div id="lobby-view" hidden></div></div></div><footer class="menu-footer"><span>MONROVIA-INSPIRED · FICTIONAL GAME DISTRICT</span><span>WASD to move · E to interact · P for phone</span></footer></section>
    <div id="hud" class="hud" hidden><div class="hud-top"><div class="hud-brand"><span class="brand-mark small">TL</span><div><b>TAXI-LIB</b><small>COASTAL COOPERATIVE</small></div></div><div class="hud-location"><span>●</span><div><small>CURRENT AREA</small><strong id="area-name">12th Street</strong></div></div><div class="hud-right"><div class="world-time"><small>DISTRICT TIME</small><strong id="world-clock">06:00</strong><span id="weather-label">CLEAR · 29°C</span></div><span id="online-count" class="online-pill">1 ONLINE</span><button id="notifications-button" class="notification-button" data-panel="notifications" aria-label="Open notifications"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><b id="notification-count" hidden>0</b></button><button class="wallet-chip" data-panel="wallet" data-wallet-balance>L$ 0</button><button id="connection-pill" class="connection-pill" data-panel="connection"><i></i><span id="connection-label">CONNECTING</span></button></div></div>
      <div id="health-status" class="health-status" role="status" aria-live="polite" hidden></div>
      <div id="objective-card" class="objective-card" hidden><p id="objective-kicker" class="panel-kicker">ACTIVE TRIP</p><strong id="objective-name"></strong><span id="hud-trip-route"></span><button class="text-button" data-cancel-trip>Cancel trip</button></div>
      <aside id="home-navigator" class="home-navigator" aria-label="Owned home room navigator" hidden><header><div><small id="home-level">PRIVATE RESIDENCE</small><strong id="home-name">Your home</strong></div><button data-leave-home>Leave home</button></header><p id="home-room-description"></p><div id="home-room-list" class="home-room-list" aria-label="Rooms"></div><button id="home-light-button" class="home-light-button" data-home-lights aria-pressed="true"><span aria-hidden="true">◐</span><span id="home-light-label">Lights on</span><kbd>L</kbd></button><small class="home-navigation-hint">WASD to walk · E at the front door to leave</small></aside>
      <div class="hud-actions"><button data-panel="dispatch" aria-label="Open dispatch"><span>▣</span><span>Dispatch</span></button><button data-panel="social" aria-label="Open nearby citizens and chat"><span aria-hidden="true">◎</span><span>Social</span></button><button data-panel="map" aria-label="Open map"><span>⌖</span><span>Map</span><kbd>M</kbd></button><button data-panel="phone" aria-label="Open citizen phone"><span>▤</span><span>Phone</span><kbd>P</kbd></button><button data-panel="settings" aria-label="Open settings"><span>⚙</span><span>Settings</span></button></div>
      <div id="driving-cluster" class="driving-cluster faded"><div class="speed-gauge"><strong id="speed-value">0</strong><span>km/h</span></div><div class="vehicle-readouts"><strong id="vehicle-name">Vehicle</strong><span>Fuel <b id="fuel-value">100%</b> · Condition <b id="condition-value">100%</b></span><button data-lights aria-pressed="false"><span aria-hidden="true">◐</span> <span data-light-label>Lights off</span> <kbd>L</kbd></button></div></div>
      <div class="minimap-wrap"><canvas id="minimap" aria-label="Local navigation map"></canvas><div class="minimap-footer"><span id="gps-status">GPS · NORTH UP</span><button data-panel="map">EXPAND</button></div></div>
      <div id="interaction-prompt" class="interaction-prompt" hidden><kbd>E</kbd><span id="interaction-text"></span></div><button id="trip-action" class="trip-action" hidden></button>
      <div class="chat-area"><div id="chat-messages" class="chat-messages" aria-live="polite"></div><form id="chat-form" class="chat-form"><input id="chat-input" maxlength="180" placeholder="Message nearby citizens…" aria-label="Chat message"><button type="submit">Send</button></form></div>
      <div class="touch-controls"><div class="touch-joystick" data-touch-joystick><i></i></div><div><button data-control="interact">Enter<br>/ exit</button><button data-control="brake">Brake</button><button id="touch-lights" data-control="lights" aria-pressed="false">Lights</button><button data-panel="phone">Phone</button></div></div>
    </div>
    <div id="panel-backdrop" class="panel-backdrop" hidden></div>
    <section id="dispatch-panel" class="game-panel dispatch-panel" role="dialog" aria-modal="true" aria-label="Passenger dispatch" hidden><header><div><p class="panel-kicker">COOPERATIVE NETWORK</p><h2>Passenger dispatch</h2></div><button class="icon-button" data-close-panels aria-label="Close">×</button></header><div class="dispatch-summary"><span><i></i><b id="job-count">0</b> open requests</span><button class="text-button" data-refresh-jobs>Refresh</button></div><div id="dispatch-list" class="dispatch-list"></div></section>
    <section id="map-panel" class="game-panel map-panel" role="dialog" aria-modal="true" aria-label="District map" hidden><header><div><p class="panel-kicker">NAVIGATION</p><h2>Coastal district</h2></div><button class="icon-button" data-close-panels aria-label="Close">×</button></header><div class="fullmap-wrap"><canvas id="fullmap" aria-label="Full district map; select a landmark to set a waypoint"></canvas></div><div id="destination-list" class="destination-list"></div><p class="map-disclaimer">Fictionalized and compressed for gameplay. Not a verified street map.</p></section>
    <section id="wallet-panel" class="game-panel wallet-panel" role="dialog" aria-modal="true" aria-label="Persistent wallet" hidden><header><div><p class="panel-kicker">AUTHORITATIVE LRD LEDGER</p><h2>Citizen wallet</h2></div><button class="icon-button" data-close-panels aria-label="Close">×</button></header><div class="wallet-balance"><span>AVAILABLE</span><strong data-wallet-balance>L$ 0</strong></div><div id="ledger-list" class="ledger-list"><p class="empty-state">Loading ledger…</p></div></section>
    <section id="settings-panel" class="game-panel settings-panel" role="dialog" aria-modal="true" aria-label="Settings" hidden><header><div><p class="panel-kicker">YOUR EXPERIENCE</p><h2>Settings & controls</h2></div><button class="icon-button" data-close-panels aria-label="Close">×</button></header><div class="settings-content">
      <section class="settings-section" aria-labelledby="display-settings-heading"><h3 id="display-settings-heading">Display & performance</h3>
        <label class="settings-field">Quality preset<select id="quality"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select><small>Presets restore 100% resolution. Low starts with shadows off; Medium preserves the established district profile.</small></label>
        <div class="settings-current" aria-live="polite"><span id="graphics-summary">Medium · 100% resolution · shadows on</span><span id="rain-summary">Full rain particles</span></div>
        <label class="settings-field"><span>Brightness / night visibility <output id="brightness-output" for="brightness">100%</output></span><input id="brightness" type="range" min="${BRIGHTNESS_MIN}" max="${BRIGHTNESS_MAX}" step="5" value="100" aria-describedby="brightness-help"><small id="brightness-help">100% preserves the art direction. Adjust display exposure without changing weather or time.</small></label>
        <label class="settings-field">Render resolution<select id="render-scale"><option value="60">60% · lowest GPU load</option><option value="75">75% · balanced</option><option value="100" selected>100% · sharpest</option></select><small>Scales the 3D drawing buffer; interface text stays at full resolution.</small></label>
        <label class="settings-toggle"><input id="shadows" type="checkbox" checked><span><strong>Dynamic shadows</strong><small>Disable the sun-shadow pass to reduce GPU work. Night character fill remains available.</small></span></label>
      </section>
      <section class="settings-section" aria-labelledby="accessibility-settings-heading"><h3 id="accessibility-settings-heading">Accessibility & sound</h3>
        <label class="settings-toggle"><input id="reduced-motion" type="checkbox"><span><strong>Reduce decorative motion</strong><small>Stops menu camera orbit, pulsing markers, showroom transitions and interface animation. Essential movement and weather remain.</small></span></label>
        <label class="settings-field"><span>Sound volume <output id="volume-output" for="volume">65%</output></span><input id="volume" type="range" min="0" max="100" value="65"></label>
      </section>
      <section class="settings-section" aria-labelledby="learning-settings-heading"><h3 id="learning-settings-heading">Learning</h3><div class="settings-field"><strong>First-trip guide</strong><small>Replay six action-based milestones from your current position. An existing passenger trip is resumed, never replaced or cancelled.</small><button class="secondary-button" type="button" data-replay-onboarding>Replay guided first trip</button></div></section>
      <section class="settings-section" aria-labelledby="controls-settings-heading"><h3 id="controls-settings-heading">Controls</h3><div class="control-grid"><span><kbd>WASD</kbd> Move / drive</span><span><kbd>E</kbd> Enter / exit</span><span><kbd>F</kbd> Trip action</span><span><kbd>L</kbd> Headlights</span><span><kbd>C</kbd> Camera</span><span><kbd>P</kbd> Citizen phone</span><span><kbd>M</kbd> Map</span><span><kbd>G</kbd> Wave</span></div></section>
      <p class="settings-note">Display, motion and sound preferences apply immediately and are stored only in this browser when storage is available. Rain still reduces grip and braking; graphics settings never change authoritative gameplay.</p>
    </div></section>
    <section id="notifications-panel" class="game-panel notifications-panel" role="dialog" aria-modal="true" aria-label="Notification history" hidden><header><div><p class="panel-kicker">CITIZEN ACTIVITY</p><h2>Notifications</h2></div><button class="icon-button" data-close-panels aria-label="Close notifications">×</button></header><div class="notification-toolbar"><span id="notification-summary">0 unread · 0 retained this session</span><div><button id="mark-notifications-read" class="text-button" data-mark-notifications-read>Mark all read</button><button class="text-button" data-clear-notifications>Clear activity</button></div></div><div id="notification-filters" class="notification-filters" role="group" aria-label="Filter notifications"></div><div id="notification-list" class="notification-list" aria-live="polite"></div><p class="panel-footnote">A small session-only activity history. Financial records remain available in Wallet; connection recovery never replays a purchase or cancels work.</p></section>
    <section id="social-panel" class="game-panel social-panel" role="dialog" aria-modal="true" aria-label="Nearby citizens and social chat" hidden><header><div><p class="panel-kicker">COASTAL COMMUNITY</p><h2>Social</h2></div><button class="icon-button" data-close-panels aria-label="Close social panel">×</button></header><div class="social-workspace"><aside class="social-roster-column"><div class="social-roster-heading"><div><strong>Nearby citizens</strong><small id="social-online-count">0 online · 0 nearby</small></div><button id="social-wave" class="secondary-button" data-social-wave>Wave <span aria-hidden="true">👋</span></button></div><div id="social-roster" class="social-roster"></div></aside><div class="social-chat-column"><div class="social-chat-heading"><div><strong>Nearby chat</strong><small id="social-connection-status" data-phase="idle">NOT CONNECTED · reconnect to send messages</small></div><span class="social-chat-scope">PROXIMITY</span></div><div id="social-chat-messages" class="social-chat-messages" aria-live="polite" aria-label="Nearby chat history"></div><form id="social-chat-form" class="social-chat-form"><input id="social-chat-input" maxlength="200" placeholder="Write to nearby citizens…" aria-label="Nearby chat message" autocomplete="off"><button id="social-chat-send" class="primary-button" type="submit">Send</button></form><small class="social-chat-note">Messages are sent through the authenticated district server. No voice chat or global direct messages.</small></div></div></section>
    <section id="connection-panel" class="game-panel connection-panel" role="dialog" aria-modal="true" aria-label="Connection and recovery" hidden><header><div><p class="panel-kicker">DISTRICT CONNECTION</p><h2>Connection & recovery</h2></div><button class="icon-button" data-close-panels aria-label="Close connection panel">×</button></header><div class="connection-recovery"><span id="connection-status-badge" class="connection-status-badge" data-phase="idle">NOT CONNECTED</span><h3 id="connection-status-title">Connecting to the district</h3><p id="connection-status-detail">Your active passenger trips, tasks and wallet remain on the server. Live updates will resume after reconnection.</p><div id="connection-retry-detail" class="connection-retry-detail">Use Retry now if your network has recovered.</div><div class="connection-actions"><button id="connection-retry" class="primary-button" data-reconnect>Retry now</button><button class="secondary-button" data-panel="notifications">Review activity</button></div><p class="panel-footnote">Retrying opens a new realtime session. It does not replay financial requests, cancel active work or move your citizen.</p></div></section>
    <section id="phone-panel" class="game-panel phone-panel" role="dialog" aria-modal="true" aria-label="Compact citizen smartphone" hidden><div class="phone-device"><div class="phone-hardware" aria-hidden="true"><i></i><span></span></div><div class="phone-screen"><header class="phone-statusbar"><span id="phone-clock">06:00</span><span>Kendeja · 4G</span><button data-close-panels aria-label="Close phone">×</button></header><div class="phone-appbar"><button class="phone-app-icon" data-phone-tab="home" aria-label="Open citizen phone home">TL</button><div><small>CITIZEN OS</small><strong id="phone-app-title">Local services</strong></div><strong data-wallet-balance>L$ 0</strong></div><div id="phone-content" class="phone-content" role="tabpanel" aria-label="Phone application" tabindex="0"></div><nav id="phone-tabs" class="phone-tabs" role="tablist" aria-label="Phone applications"><button class="active" role="tab" aria-controls="phone-content" data-phone-tab="home"><span aria-hidden="true">⌂</span><small>Home</small></button><button role="tab" aria-controls="phone-content" data-phone-tab="calls"><span aria-hidden="true">☎</span><small>Services</small></button><button role="tab" aria-controls="phone-content" data-phone-tab="vehicles"><span aria-hidden="true">▱</span><small>Motors</small></button><button role="tab" aria-controls="phone-content" data-phone-tab="homes"><span aria-hidden="true">▤</span><small>Homes</small></button><button role="tab" aria-controls="phone-content" data-phone-tab="garage"><span aria-hidden="true">▦</span><small>Garage</small></button></nav><div class="phone-home-indicator" aria-hidden="true"></div></div></div></section>
    <section id="character-panel" class="character-modal" role="dialog" aria-modal="true" aria-label="Customize character" hidden><header><div><p class="panel-kicker">YOUR CITIZEN</p><h2>Appearance</h2></div><button class="icon-button" data-close-panels aria-label="Close">×</button></header><p>Choose your realistic local citizen model, skin tone and clothing. Appearance is saved to your account.</p><form id="character-form"></form></section>
    <div id="toast-stack" class="toast-stack" aria-live="polite"></div>`;
}
