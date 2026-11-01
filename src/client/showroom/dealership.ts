import './showroom.css';

import {
  VEHICLE_CATALOG, VEHICLE_PAINTS, VEHICLE_PAINT_FINISHES,
  defaultVehicleConfiguration, vehicleConfigurationPrice, vehiclePaint,
  type VehicleCatalogEntry, type VehicleConfiguration, type VehiclePaintFinish, type VehiclePaintId,
} from '../../shared/catalog';
import { formatLrd } from '../../shared/simulation';
import type { LifestyleState, PlayerVehicle } from '../../shared/types';
import { escapeHtml } from '../ui/html';
import type { ShowroomScene, ShowroomSceneStatus, ShowroomView } from './showroom-scene';
import type { GraphicsSettings } from '../settings';

export interface PurchaseVehicleDetail {
  modelId: string;
  configuration: VehicleConfiguration;
}

interface DealershipCallbacks {
  onPurchase: (detail: PurchaseVehicleDetail) => void;
  onSelect: (vehicleId: string) => void;
  onOpenGarage: () => void;
}

type InventoryCategory = 'all' | 'modern' | 'compact' | 'taxi' | 'minibus';
type InventoryOwnership = 'all' | 'owned' | 'unowned';
type InventorySort = 'featured' | 'price-asc' | 'price-desc' | 'speed-desc' | 'acceleration-desc' | 'seats-desc';

export class Dealership {
  private readonly panel: HTMLElement;
  private state: LifestyleState | null = null;
  private scene?: ShowroomScene;
  private generation = 0;
  private sceneStatus: ShowroomSceneStatus | 'error' = 'loading';
  private selectedModelId = VEHICLE_CATALOG[0]!.modelId;
  private readonly configurations = new Map<string, VehicleConfiguration>();
  private query = '';
  private category: InventoryCategory = 'all';
  private ownership: InventoryOwnership = 'all';
  private sort: InventorySort = 'featured';
  private busy = false;
  private lightsOn = false;
  private review = false;
  private errorMessage = '';
  private purchasedVehicleId: string | null = null;
  private pendingPurchase = false;
  private pendingVehicleIds = new Set<string>();

  constructor(host: HTMLElement, private readonly callbacks: DealershipCallbacks, private graphicsSettings: GraphicsSettings) {
    host.insertAdjacentHTML('beforeend', this.shell());
    this.panel = host.querySelector<HTMLElement>('#showroom-panel')!;
    this.panel.addEventListener('click', (event) => this.handleClick(event));
    this.panel.addEventListener('input', (event) => {
      if ((event.target as Element).matches('[data-showroom-search]')) this.handleInput(event);
    });
    this.panel.addEventListener('change', (event) => {
      if ((event.target as Element).matches('select')) this.handleInput(event);
    });
  }

  private shell() {
    return `<section id="showroom-panel" class="game-panel showroom-panel" role="dialog" aria-modal="true" aria-label="Seabreeze Motors vehicle dealership" hidden>
      <header class="showroom-header"><div class="showroom-brand"><span class="showroom-brand-mark"><i>SM</i></span><div><p>MONROVIA-INSPIRED · FICTIONAL DEALERSHIP</p><h2>Seabreeze Motors</h2></div></div>
        <div class="showroom-account"><span>AVAILABLE <strong data-wallet-balance>L$ 0</strong></span><span>GARAGE <strong data-showroom-capacity>0 / 0</strong></span></div>
        <button class="showroom-close" data-close-panels aria-label="Close dealership">× <span>Close</span></button></header>
      <div class="showroom-layout">
        <aside class="showroom-inventory" aria-label="Vehicle inventory"><div class="showroom-inventory-heading"><div><p>CURATED INVENTORY</p><h3>Find your vehicle</h3></div><span data-showroom-results>0 models</span></div>
          <label class="showroom-search"><span class="sr-only">Search inventory</span><input data-showroom-search type="search" placeholder="Search model or category" autocomplete="off"></label>
          <div class="showroom-filters"><label>Category<select data-showroom-category><option value="all">All categories</option><option value="modern">Modern</option><option value="compact">Compact</option><option value="taxi">Taxi ready</option><option value="minibus">Passenger</option></select></label>
            <label>Ownership<select data-showroom-ownership><option value="all">All vehicles</option><option value="owned">In my garage</option><option value="unowned">Not owned</option></select></label></div>
          <label class="showroom-sort">Sort by<select data-showroom-sort><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="speed-desc">Top speed</option><option value="acceleration-desc">Acceleration</option><option value="seats-desc">Passenger capacity</option></select></label>
          <div class="showroom-inventory-list" data-showroom-inventory></div>
          <p class="showroom-inventory-note">New vehicles include persistent LRD records and a unique Liberia-style game plate. No real-money sales.</p>
        </aside>
        <main class="showroom-stage" aria-label="Interactive vehicle inspection">
          <canvas id="showroom-canvas" aria-label="3D vehicle view. Drag to orbit and scroll or pinch to zoom."></canvas>
          <div class="showroom-stage-top"><span class="showroom-live-badge"><i></i> LIVE 3D INSPECTION</span><span data-showroom-model-label></span></div>
          <div class="showroom-scene-status" data-showroom-scene-status role="status"></div>
          <div class="showroom-stage-bottom"><div class="showroom-camera-controls" aria-label="Camera views"><button data-showroom-view="front">Front ¾</button><button data-showroom-view="side">Profile</button><button data-showroom-view="rear">Rear ¾</button><button data-showroom-lights aria-pressed="false">◐ <span>Headlights</span></button></div><p>DRAG TO ORBIT <span>·</span> SCROLL / PINCH TO ZOOM</p></div>
        </main>
        <aside class="showroom-details" data-showroom-details aria-label="Selected vehicle details"></aside>
      </div>
    </section>`;
  }

  setGraphicsSettings(settings: GraphicsSettings) {
    this.graphicsSettings = { ...settings };
    this.scene?.setGraphicsSettings(this.graphicsSettings);
  }

  open(state: LifestyleState) {
    this.state = state;
    this.errorMessage = '';
    this.review = false;
    this.purchasedVehicleId = null;
    this.render();
    if (!this.scene) void this.initializeScene();
  }

  close() {
    this.generation += 1;
    this.scene?.dispose();
    this.scene = undefined;
    this.review = false;
    this.pendingPurchase = false;
    this.lightsOn = false;
  }

  setState(state: LifestyleState) {
    this.state = state;
    if (this.pendingPurchase) {
      const added = state.vehicles.find((vehicle) => !this.pendingVehicleIds.has(vehicle.id));
      const selected = this.selectedListing();
      const configuration = this.configuration();
      const match = added ?? state.vehicles.find((vehicle) => vehicle.modelId === selected.modelId && vehicle.paintId === configuration.paintId && vehicle.finish === configuration.finish);
      this.purchasedVehicleId = match?.id ?? null;
      this.pendingPurchase = false;
      this.review = false;
      if (match) this.errorMessage = '';
    }
    if (!this.panel.hidden) this.render();
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.panel.setAttribute('aria-busy', String(busy));
    if (!this.panel.hidden) this.renderDetails();
  }

  showError(message: string) {
    this.pendingPurchase = false;
    this.errorMessage = message;
    if (!this.panel.hidden) this.renderDetails();
  }

  private selectedListing() {
    return VEHICLE_CATALOG.find((listing) => listing.modelId === this.selectedModelId) ?? VEHICLE_CATALOG[0]!;
  }

  private configuration() {
    const listing = this.selectedListing();
    let configuration = this.configurations.get(listing.modelId);
    if (!configuration) {
      configuration = defaultVehicleConfiguration(listing);
      this.configurations.set(listing.modelId, configuration);
    }
    return configuration;
  }

  private color() {
    return vehiclePaint(this.configuration().paintId)?.color ?? this.selectedListing().defaultColor;
  }

  private async initializeScene() {
    const generation = ++this.generation;
    this.sceneStatus = 'loading';
    this.updateSceneStatus();
    try {
      const { ShowroomScene: Scene } = await import('./showroom-scene');
      if (generation !== this.generation || this.panel.hidden) return;
      this.scene = new Scene(this.panel.querySelector<HTMLCanvasElement>('#showroom-canvas')!, (status) => {
        if (generation !== this.generation) return;
        this.sceneStatus = status;
        this.updateSceneStatus();
      }, this.graphicsSettings);
      await this.loadSelectedVehicle();
    } catch (error) {
      if (generation === this.generation) this.showSceneError(error);
    }
  }

  private async loadSelectedVehicle() {
    if (!this.scene) return;
    const generation = this.generation;
    const scene = this.scene;
    this.lightsOn = false;
    this.updateLightButton();
    try {
      await scene.setVehicle(this.selectedListing(), this.color(), this.configuration().finish);
    } catch (error) {
      if (generation === this.generation) this.showSceneError(error);
    }
  }

  private showSceneError(error: unknown) {
    console.warn('Showroom 3D initialization failed:', error);
    this.sceneStatus = 'error';
    this.updateSceneStatus();
  }

  private updateSceneStatus() {
    const container = this.panel.querySelector<HTMLElement>('[data-showroom-scene-status]')!;
    const ready = this.sceneStatus === 'ready';
    container.hidden = ready;
    this.panel.querySelector('.showroom-stage')?.classList.toggle('scene-ready', ready);
    if (!ready) {
      container.innerHTML = this.sceneStatus === 'error'
        ? '<div class="showroom-scene-message error"><strong>3D preview unavailable</strong><p>Your browser could not start this WebGL view. Inventory and authoritative purchasing remain available.</p><button data-showroom-retry>Retry 3D view</button></div>'
        : `<div class="showroom-scene-message"><span class="showroom-spinner" aria-hidden="true"></span><strong>Preparing ${escapeHtml(this.selectedListing().name)}</strong><p>Loading only the selected vehicle and studio…</p></div>`;
    } else container.innerHTML = '';
    this.panel.querySelectorAll<HTMLButtonElement>('[data-showroom-view], [data-showroom-lights]').forEach((button) => { button.disabled = !ready; });
  }

  private filteredListings() {
    if (!this.state) return [];
    const query = this.query.trim().toLowerCase();
    const owned = new Set(this.state.vehicles.map((vehicle) => vehicle.modelId));
    const listings = VEHICLE_CATALOG.filter((listing) => {
      if (query && !`${listing.name} ${listing.className} ${listing.description}`.toLowerCase().includes(query)) return false;
      if (this.ownership === 'owned' && !owned.has(listing.modelId)) return false;
      if (this.ownership === 'unowned' && owned.has(listing.modelId)) return false;
      if (this.category === 'modern' && !listing.visual.startsWith('modern-')) return false;
      if (this.category === 'compact' && listing.visual !== 'hatchback') return false;
      if (this.category === 'taxi' && !listing.taxi) return false;
      if (this.category === 'minibus' && listing.visual !== 'minibus') return false;
      return true;
    });
    if (this.sort === 'price-asc') listings.sort((a, b) => a.priceLrd - b.priceLrd);
    if (this.sort === 'price-desc') listings.sort((a, b) => b.priceLrd - a.priceLrd);
    if (this.sort === 'speed-desc') listings.sort((a, b) => b.maxSpeed - a.maxSpeed);
    if (this.sort === 'acceleration-desc') listings.sort((a, b) => b.acceleration - a.acceleration);
    if (this.sort === 'seats-desc') listings.sort((a, b) => b.seats - a.seats);
    return listings;
  }

  private render() {
    if (!this.state) return;
    this.panel.querySelector('[data-showroom-capacity]')!.textContent = `${this.state.vehicles.length} / ${this.state.garageCapacity}`;
    this.panel.querySelectorAll('[data-wallet-balance]').forEach((element) => { element.textContent = formatLrd(this.state!.wallet.balanceLrd); });
    this.panel.querySelector('[data-showroom-model-label]')!.textContent = `${this.selectedListing().className} · ${this.selectedListing().seats} seats`;
    this.renderInventory();
    this.renderDetails();
    this.updateSceneStatus();
  }

  private renderInventory() {
    if (!this.state) return;
    const listings = this.filteredListings();
    this.panel.querySelector('[data-showroom-results]')!.textContent = `${listings.length} model${listings.length === 1 ? '' : 's'}`;
    const container = this.panel.querySelector<HTMLElement>('[data-showroom-inventory]')!;
    container.innerHTML = listings.length ? listings.map((listing) => {
      const owned = this.state!.vehicles.filter((vehicle) => vehicle.modelId === listing.modelId).length;
      const selected = listing.modelId === this.selectedModelId;
      const paint = vehiclePaint(this.configurations.get(listing.modelId)?.paintId ?? defaultVehicleConfiguration(listing).paintId)!;
      return `<button class="showroom-inventory-card ${selected ? 'selected' : ''}" data-showroom-model="${listing.modelId}" aria-pressed="${selected}">
        <span class="showroom-card-swatch" style="--vehicle-swatch:${paint.color}"><i></i></span><span class="showroom-card-copy"><small>${escapeHtml(listing.className)}</small><strong>${escapeHtml(listing.name)}</strong><span>${Math.round(listing.maxSpeed * 3.6)} km/h · ${listing.seats} seats</span></span>
        <span class="showroom-card-price"><strong>${formatLrd(listing.priceLrd)}</strong><small class="${owned ? 'owned' : ''}">${owned ? `${owned} owned` : 'Available'}</small></span></button>`;
    }).join('') : '<div class="showroom-empty"><strong>No vehicles match</strong><p>Try another name, category or ownership filter.</p><button data-showroom-reset-filters>Reset filters</button></div>';
  }

  private renderDetails(focusSelector?: string) {
    if (!this.state) return;
    const listing = this.selectedListing();
    const configuration = this.configuration();
    const paint = vehiclePaint(configuration.paintId)!;
    const finish = VEHICLE_PAINT_FINISHES[configuration.finish];
    const total = vehicleConfigurationPrice(listing, configuration);
    const owned = this.state.vehicles.filter((vehicle) => vehicle.modelId === listing.modelId);
    const purchased = this.purchasedVehicleId ? this.state.vehicles.find((vehicle) => vehicle.id === this.purchasedVehicleId) : undefined;
    const full = this.state.vehicles.length >= this.state.garageCapacity;
    const affordable = this.state.wallet.balanceLrd >= total;
    const blocked = this.busy || full || !affordable;
    const reason = full ? 'Your garage is full. Purchase or upgrade a home for another permanent slot.' : !affordable ? `You need ${formatLrd(total - this.state.wallet.balanceLrd)} more for this configuration.` : '';
    const container = this.panel.querySelector<HTMLElement>('[data-showroom-details]')!;
    container.innerHTML = `<div class="showroom-detail-scroll"><div class="showroom-title-block"><p>${listing.taxi ? 'TAXI READY' : 'PRIVATE VEHICLE'} · ${owned.length ? `${owned.length} IN YOUR GARAGE` : 'AVAILABLE TO ORDER'}</p><h2>${escapeHtml(listing.name)}</h2><span>${escapeHtml(listing.className)}</span><p>${escapeHtml(listing.description)}</p></div>
      ${purchased ? this.purchaseConfirmation(purchased, this.state.selectedVehicleId === purchased.id) : ''}
      ${this.errorMessage ? `<div class="showroom-purchase-error" role="alert"><strong>Purchase not completed</strong><p>${escapeHtml(this.errorMessage)}</p></div>` : ''}
      <section class="showroom-specification"><div class="showroom-section-title"><h3>Gameplay specifications</h3><span>BASE MODEL</span></div><div class="showroom-spec-grid">
        ${this.spec('Top speed', `${Math.round(listing.maxSpeed * 3.6)} km/h`)}${this.spec('Acceleration', `${listing.acceleration.toFixed(1)} m/s²`)}${this.spec('Braking', `${listing.braking.toFixed(1)} m/s²`)}${this.spec('Steering coefficient', listing.steering.toFixed(2))}${this.spec('Dry grip multiplier', `${listing.grip.toFixed(2)}×`)}${this.spec('Seats', String(listing.seats))}
      </div><p>Actual controller values before weather, road-surface and workshop upgrade effects. Paint and finish do not alter performance.</p></section>
      <section class="showroom-customization"><div class="showroom-section-title"><h3>Factory configuration</h3><span>VISUAL ONLY</span></div>
        <fieldset><legend>Paint · ${escapeHtml(paint.name)}</legend><div class="showroom-paint-grid">${VEHICLE_PAINTS.map((entry) => `<button class="showroom-paint ${entry.id === configuration.paintId ? 'selected' : ''}" style="--paint:${entry.color}" data-showroom-paint="${entry.id}" aria-label="${escapeHtml(entry.name)}${entry.priceLrd ? `, ${formatLrd(entry.priceLrd)}` : ', included'}" aria-pressed="${entry.id === configuration.paintId}" title="${escapeHtml(entry.name)}" ${this.busy ? 'disabled' : ''}><i></i></button>`).join('')}</div></fieldset>
        <fieldset><legend>Finish</legend><div class="showroom-finish-options">${(Object.keys(VEHICLE_PAINT_FINISHES) as VehiclePaintFinish[]).map((id) => { const option = VEHICLE_PAINT_FINISHES[id]; return `<button data-showroom-finish="${id}" class="${id === configuration.finish ? 'selected' : ''}" aria-pressed="${id === configuration.finish}" ${this.busy ? 'disabled' : ''}><span><strong>${option.name}</strong><small>${option.description}</small></span><b>${option.priceLrd ? `+${formatLrd(option.priceLrd)}` : 'Included'}</b></button>`; }).join('')}</div></fieldset>
      </section>
      <section class="showroom-price"><div><span>Vehicle</span><strong>${formatLrd(listing.priceLrd)}</strong></div><div><span>${escapeHtml(paint.name)} · ${escapeHtml(finish.name)}</span><strong>${finish.priceLrd ? `+${formatLrd(finish.priceLrd)}` : 'Included'}</strong></div><div class="showroom-price-total"><span>Authoritative total</span><strong>${formatLrd(total)}</strong></div></section>
      ${reason ? `<p class="showroom-blocked-reason">${escapeHtml(reason)}</p>` : ''}
      ${this.review ? `<div class="showroom-review" role="group" aria-label="Review purchase"><p>CONFIRM YOUR ORDER</p><strong>${escapeHtml(listing.name)} · ${formatLrd(total)}</strong><span>${escapeHtml(paint.name)} / ${escapeHtml(finish.name)}</span><small>The server will recheck your balance, garage capacity and request ID before recording the vehicle.</small><div><button data-showroom-cancel-review ${this.busy ? 'disabled' : ''}>Back</button><button class="showroom-buy" data-showroom-confirm-purchase ${this.busy ? 'disabled' : ''}>${this.busy ? 'Processing…' : `Confirm · ${formatLrd(total)}`}</button></div></div>`
        : `<button class="showroom-buy showroom-main-buy" data-showroom-buy ${blocked ? 'disabled' : ''}>${this.busy ? 'Processing…' : full ? 'Garage full' : !affordable ? 'Insufficient LRD' : `Review purchase · ${formatLrd(total)}`}</button>`}
      <button class="showroom-garage-link" data-showroom-open-garage>Open my garage <span>→</span></button>
      <p class="showroom-authority-note">Price, funds, capacity, ownership and configuration are verified and persisted by the game server. Purchases use duplicate-request protection.</p></div>`;
    if (focusSelector) requestAnimationFrame(() => container.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true }));
  }

  private spec(label: string, value: string) {
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  }

  private purchaseConfirmation(vehicle: PlayerVehicle, selected: boolean) {
    return `<div class="showroom-purchase-success" role="status"><span aria-hidden="true">✓</span><div><p>ORDER COMPLETE</p><strong>${escapeHtml(vehicle.model.name)} is in your garage</strong><small>${escapeHtml(vehicle.plate)} · ${escapeHtml(VEHICLE_PAINT_FINISHES[vehicle.finish].name)}</small></div>${selected ? '<b>SELECTED</b>' : `<button data-showroom-select="${vehicle.id}">Select vehicle</button>`}</div>`;
  }

  private selectModel(modelId: string) {
    if (modelId === this.selectedModelId || !VEHICLE_CATALOG.some((listing) => listing.modelId === modelId)) return;
    this.selectedModelId = modelId;
    this.review = false;
    this.errorMessage = '';
    this.purchasedVehicleId = null;
    this.render();
    void this.loadSelectedVehicle();
    requestAnimationFrame(() => this.panel.querySelector<HTMLElement>(`[data-showroom-model="${modelId}"]`)?.focus({ preventScroll: true }));
  }

  private handleClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.showroomModel) this.selectModel(button.dataset.showroomModel);
    if (button.dataset.showroomPaint) {
      const paintId = button.dataset.showroomPaint as VehiclePaintId;
      if (!vehiclePaint(paintId)) return;
      this.configuration().paintId = paintId;
      this.errorMessage = '';
      this.scene?.setAppearance(this.color(), this.configuration().finish);
      this.renderDetails(`[data-showroom-paint="${paintId}"]`);
      this.renderInventory();
    }
    if (button.dataset.showroomFinish) {
      const finish = button.dataset.showroomFinish as VehiclePaintFinish;
      if (!Object.hasOwn(VEHICLE_PAINT_FINISHES, finish)) return;
      this.configuration().finish = finish;
      this.errorMessage = '';
      this.scene?.setAppearance(this.color(), finish);
      this.renderDetails(`[data-showroom-finish="${finish}"]`);
    }
    if (button.dataset.showroomView) this.scene?.setView(button.dataset.showroomView as ShowroomView);
    if (button.hasAttribute('data-showroom-lights')) {
      this.lightsOn = !this.lightsOn;
      this.scene?.setLights(this.lightsOn);
      this.updateLightButton();
    }
    if (button.hasAttribute('data-showroom-retry')) {
      this.scene?.dispose();
      this.scene = undefined;
      void this.initializeScene();
    }
    if (button.hasAttribute('data-showroom-reset-filters')) {
      this.query = '';
      this.category = 'all';
      this.ownership = 'all';
      this.sort = 'featured';
      this.panel.querySelector<HTMLInputElement>('[data-showroom-search]')!.value = '';
      this.panel.querySelector<HTMLSelectElement>('[data-showroom-category]')!.value = 'all';
      this.panel.querySelector<HTMLSelectElement>('[data-showroom-ownership]')!.value = 'all';
      this.panel.querySelector<HTMLSelectElement>('[data-showroom-sort]')!.value = 'featured';
      this.renderInventory();
    }
    if (button.hasAttribute('data-showroom-buy')) {
      this.review = true;
      this.errorMessage = '';
      this.renderDetails();
    }
    if (button.hasAttribute('data-showroom-cancel-review')) { this.review = false; this.renderDetails(); }
    if (button.hasAttribute('data-showroom-confirm-purchase')) {
      this.pendingPurchase = true;
      this.pendingVehicleIds = new Set(this.state?.vehicles.map((vehicle) => vehicle.id) ?? []);
      this.errorMessage = '';
      this.callbacks.onPurchase({ modelId: this.selectedModelId, configuration: { ...this.configuration() } });
    }
    if (button.dataset.showroomSelect) this.callbacks.onSelect(button.dataset.showroomSelect);
    if (button.hasAttribute('data-showroom-open-garage')) this.callbacks.onOpenGarage();
  }

  private updateLightButton() {
    const button = this.panel.querySelector<HTMLButtonElement>('[data-showroom-lights]');
    if (!button) return;
    button.setAttribute('aria-pressed', String(this.lightsOn));
    button.classList.toggle('active', this.lightsOn);
    const label = button.querySelector('span');
    if (label) label.textContent = this.lightsOn ? 'Lights on' : 'Headlights';
  }

  private handleInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.matches('[data-showroom-search]')) this.query = target.value;
    else if (target.matches('[data-showroom-category]')) this.category = target.value as InventoryCategory;
    else if (target.matches('[data-showroom-ownership]')) this.ownership = target.value as InventoryOwnership;
    else if (target.matches('[data-showroom-sort]')) this.sort = target.value as InventorySort;
    else return;
    this.renderInventory();
  }
}
