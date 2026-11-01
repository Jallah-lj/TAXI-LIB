import './style.css';
import { UI } from './ui';
import { Game, type CitizenTaskInteraction, type HUDState } from './game';
import { api, ApiError } from './api';
import type { CitizenTaskMutationResult, LifestyleMutationResult, OnboardingStatus, PlayerProfile, WorldBootstrap } from '../shared/types';
import { PLAYER_SPAWN } from '../shared/world';
import {
  PROPERTY_CATALOG, VEHICLE_UPGRADES, propertyUpgradeCost, vehicleUpgradeCost,
} from '../shared/catalog';
import { getCitizenTaskDefinition } from '../shared/tasks';
import { formatLrd } from '../shared/simulation';
import { loadClientSettings, saveClientSettings, type SettingsStorage } from './settings';
import { FirstTripGuide } from './onboarding';
import { OnboardingView } from './ui/onboarding-view';

const settingsStorage: SettingsStorage | null = (() => {
  try { return window.localStorage; } catch { return null; }
})();
const initialSettings = loadClientSettings(settingsStorage, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const ui = new UI(initialSettings);
let latestHUD: HUDState | null = null;
let latestTripAction: 'pickup' | 'complete' | null = null;
const onboardingView = new OnboardingView(document.getElementById('app')!, {
  onStart: () => startGuidedTrip(),
  onDismiss: () => { guide.close(); void persistOnboarding('dismissed'); },
  onClose: () => guide.close(),
  onWallet: () => { guide.close(); ui.openPhone('wallet'); },
});
const guide = new FirstTripGuide((state) => onboardingView.render(state));
let profile: PlayerProfile | null = null;
let world: WorldBootstrap | null = null;
let tripBusy = false;
let lifestyleBusy = false;
let taskBusy = false;
let civicBusy = false;

const game = new Game(
  document.querySelector<HTMLCanvasElement>('#game-canvas')!,
  document.querySelector<HTMLCanvasElement>('#minimap')!,
  document.querySelector<HTMLCanvasElement>('#fullmap')!,
  {
    onHUD: (state) => {
      latestHUD = state;
      ui.updateHUD(state);
      guide.update(state.position, state.mode);
      updateOnboardingContext();
    },
    onPrompt: (text) => ui.setPrompt(text),
    onTripAction: (action) => { latestTripAction = action; ui.setTripAction(action); updateOnboardingContext(); },
    onTripRequest: () => { void handleTripAction(); },
    onTaskRequest: (interaction) => { void handleTaskInteraction(interaction); },
    onCivicTarget: (target) => ui.openCivic(target),
    onCivicIncidents: (incidents) => {
      if (world) world.civic.incidents = incidents;
      ui.updateCivicIncidents(incidents);
    },
    onSafety: (safety, wallet, notice) => {
      if (world) { world.civic.safety = safety; world.wallet = wallet; }
      ui.updateSafety(safety);
      ui.updateWallet(wallet);
      if (notice) ui.notify({ category: 'civic', tone: notice.includes('fine recorded') ? 'error' : 'info', title: 'District safety update', message: notice, action: { type: 'civic', label: 'Open Civic' } });
    },
    onToast: (message, kind) => ui.toast(message, kind),
    onConnection: (status) => ui.setConnection(status),
    onSocial: (players) => ui.updateSocialPlayers(players),
    onChat: (message) => ui.addChat(message),
    onHome: (home) => ui.updateHome(home),
  },
);
game.applyClientSettings(initialSettings);

function updateOnboardingContext() {
  if (!latestHUD) return;
  onboardingView.update({
    mode: latestHUD.mode,
    vehicleName: latestHUD.vehicleName,
    vehicleDistance: latestHUD.vehicleDistance,
    destinationName: latestHUD.destinationName,
    destinationDistance: latestHUD.destinationDistance,
    tripAction: latestTripAction,
  });
}

function startGuidedTrip() {
  if (!world) return;
  if (world.activeTask) {
    guide.close();
    ui.toast('Finish or cancel your current citizen task before starting the passenger guide. Your task has not been changed.', 'info');
    return;
  }
  if (game.isInsideHome) {
    guide.close();
    ui.toast('Step outside your home to start the guided first trip.', 'info');
    return;
  }
  guide.start({
    position: latestHUD?.position ?? { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
    mode: latestHUD?.mode ?? 'walking',
    activeTrip: world.activeTrip,
  });
}

async function persistOnboarding(status: Exclude<OnboardingStatus, 'new'>) {
  try {
    const result = await api.onboarding(status);
    profile = result.player;
    if (world) world.player = result.player;
  } catch {
    ui.toast('Your guide preference could not be saved online. It may appear again in a future session.', 'info');
  }
}

ui.ready();

async function loadWorld() {
  world = await api.world();
  profile = world.player;
  return world;
}

async function authenticate(mode: 'login' | 'register', detail: { handle: string; password: string; displayName?: string }) {
  ui.authBusy(true);
  try {
    const result = mode === 'register'
      ? await api.register(detail.handle, detail.password, detail.displayName!)
      : await api.login(detail.handle, detail.password);
    profile = result.player;
    const bootstrap = await loadWorld();
    ui.showLobby(profile!, bootstrap);
  } catch (error) {
    ui.authError(error instanceof Error ? error.message : 'Unable to sign in.');
  } finally {
    ui.authBusy(false);
  }
}

ui.on('login', (detail) => void authenticate('login', detail));
ui.on('register', (detail) => void authenticate('register', detail));
ui.on('enter', () => {
  void (async () => {
    if (!world) return;
    try {
      latestHUD = null;
      latestTripAction = null;
      guide.close();
      await game.enter(world);
      ui.showGame(world);
      guide.offer(world.player.onboardingStatus);
    } catch (error) {
      ui.toast(error instanceof Error ? error.message : 'Unable to enter the world.', 'error');
    }
  })();
});
ui.on('customize', () => { if (profile) ui.showCharacter(profile); });
ui.on('appearance', (appearance) => {
  void (async () => {
    try {
      const result = await api.appearance(appearance);
      profile = result.player;
      if (world) world.player = profile;
      ui.closeCharacter();
      if (world) ui.showLobby(profile, world);
      ui.toast('Your character appearance has been saved.', 'success');
    } catch (error) { ui.toast(error instanceof Error ? error.message : 'Unable to save appearance.', 'error'); }
  })();
});
ui.on('logout', () => { void api.logout().finally(() => location.reload()); });
ui.on('accept-job', (jobId: string) => {
  void (async () => {
    const selectedVehicleId = world?.selectedVehicleId;
    const vehicle = world?.vehicles.find((entry) => entry.id === selectedVehicleId) ?? world?.vehicles[0];
    if (!world || !vehicle || tripBusy) return;
    tripBusy = true;
    try {
      const result = await api.acceptJob(jobId, vehicle.id);
      world.activeTrip = result.trip;
      world.jobs = world.jobs.filter((job) => job.id !== jobId);
      game.setTrip(result.trip);
      guide.tripAccepted(result.trip);
      ui.updateJobs(world.jobs, result.trip);
      ui.closePanels();
      ui.notify({ category: 'transaction', tone: 'success', title: 'Passenger request accepted', message: `Pick up ${result.trip.passengerName}. The ${formatLrd(result.trip.fareLrd)} fare is reserved by the server.`, action: { type: 'refresh-dispatch', label: 'Refresh dispatch' } });
      game.audio.feedback('success');
    } catch (error) {
      ui.notify({ category: 'transaction', tone: 'error', title: 'Request was not accepted', message: error instanceof Error ? error.message : 'Unable to accept request.', action: { type: 'refresh-dispatch', label: 'Refresh requests' } });
      await refreshWorld();
    } finally { tripBusy = false; }
  })();
});
ui.on('cancel-trip', () => {
  void (async () => {
    const trip = world?.activeTrip;
    if (!trip || tripBusy) return;
    const confirmed = await ui.confirmAction({
      kicker: 'ACTIVE PASSENGER', title: 'Cancel this passenger trip?',
      body: `${trip.passengerName} will be released from your active route. This cannot be undone, but no fare will be charged or paid.`,
      confirmLabel: 'Cancel passenger trip', cancelLabel: 'Keep trip', tone: 'danger',
      details: [{ label: 'Current stage', value: trip.status === 'accepted' ? 'Passenger awaiting pickup' : 'Passenger aboard' }, { label: 'Fare impact', value: 'No fare charged', emphasis: true }],
    });
    if (!confirmed || !world?.activeTrip || world.activeTrip.id !== trip.id) return;
    tripBusy = true;
    try {
      await api.cancel(trip.id);
      world.activeTrip = null;
      game.setTrip(null);
      guide.tripCancelled(trip.id);
      await refreshWorld();
      ui.notify({ category: 'transaction', tone: 'info', title: 'Passenger trip cancelled', message: 'The active route was released. No fare was charged or paid.', action: { type: 'refresh-dispatch', label: 'View requests' } });
    } catch (error) {
      ui.notify({ category: 'transaction', tone: 'error', title: 'Trip was not cancelled', message: error instanceof Error ? error.message : 'Unable to cancel trip. Your active trip remains unchanged.', action: { type: 'refresh-dispatch', label: 'Refresh trip' } });
    } finally { tripBusy = false; }
  })();
});
ui.on('waypoint', (locationId: string) => game.setWaypoint(locationId));
ui.on('civic-waypoint', (detail) => { game.setCivicWaypoint(detail); ui.closePanels(); });
ui.on('trip-request', () => { void handleTripAction(); });
ui.on('lights', () => game.controlAction('lights'));
ui.on('access-property', (propertyId) => {
  try {
    game.accessProperty(propertyId);
    ui.closePanels();
  } catch (error) {
    ui.toast(error instanceof Error ? error.message : 'Unable to access that property.', 'error');
  }
});
ui.on('visit-room', (roomId) => game.visitHomeRoom(roomId));
ui.on('leave-home', () => game.exitProperty());
ui.on('home-lights', () => game.toggleHomeLights());
ui.on('chat', (text: string) => {
  if (!game.chat(text)) ui.notify({ category: 'connection', tone: 'error', title: 'Message not sent', message: 'The district connection is unavailable. Reconnect and try sending again.', action: { type: 'reconnect', label: 'Reconnect' } });
});
ui.on('wave', () => {
  if (!game.wave()) ui.notify({ category: 'connection', tone: 'error', title: 'Wave not sent', message: 'Reconnect to the district before waving to nearby citizens.', action: { type: 'reconnect', label: 'Reconnect' } });
  else ui.toast('Wave sent through the live district connection.', 'success', 'social');
});
ui.on('reconnect', () => {
  game.reconnect();
  ui.notify({ category: 'connection', tone: 'info', title: 'Retrying district connection', message: 'Opening a fresh realtime session. Your active work is unchanged.' }, { silent: true });
});
ui.on('reauthenticate', () => { void api.logout().finally(() => location.reload()); });
ui.on('conversation', (active: boolean) => game.setConversationActive(active));
ui.on('panel', (panel: string | null) => {
  game.setControlsEnabled(panel === null);
  guide.panelChanged(panel);
  onboardingView.setPanel(panel);
});
ui.on('replay-onboarding', () => { ui.closePanels(); startGuidedTrip(); });
ui.on('settings', (settings) => {
  game.applyClientSettings(settings);
  saveClientSettings(settings, settingsStorage);
});
ui.on('load-wallet', () => {
  void api.wallet().then((result) => { ui.updateWallet(result.wallet); ui.showLedger(result.ledger); }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Unable to load the wallet ledger.';
    ui.showWalletError(message);
    ui.notify({ category: 'transaction', tone: 'error', title: 'Wallet could not be refreshed', message, action: { type: 'refresh-wallet', label: 'Retry wallet' } });
  });
});
ui.on('refresh-jobs', () => { void refreshWorld(); });
ui.on('load-civic', () => { void refreshCivic(); });

ui.on('buy-property', (listingId) => {
  void (async () => {
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === listingId);
    if (!world || !listing || lifestyleBusy || !canReviewCharge(listing.priceLrd)) return;
    const confirmed = await ui.confirmAction({
      kicker: 'PROPERTY PURCHASE', title: `Purchase ${listing.name}?`,
      body: 'This adds a server-verified home title and a permanent garage slot. The listing includes walkable rooms and usable access.',
      confirmLabel: `Purchase for ${formatLrd(listing.priceLrd)}`, cancelLabel: 'Review later',
      details: [{ label: 'Available balance', value: formatLrd(world.wallet.balanceLrd) }, { label: 'Purchase total', value: formatLrd(listing.priceLrd), emphasis: true }, { label: 'Balance after purchase', value: formatLrd(world.wallet.balanceLrd - listing.priceLrd) }],
    });
    if (confirmed) await runLifestyleMutation((requestId) => api.purchaseProperty(listingId, requestId), 'Home purchased. Your title and extra garage slot are saved.');
  })();
});
ui.on('upgrade-property', (propertyId) => {
  void (async () => {
    const owned = world?.properties.find((entry) => entry.id === propertyId);
    const listing = owned ? PROPERTY_CATALOG.find((entry) => entry.id === owned.listingId) : undefined;
    if (!world || !owned || !listing || lifestyleBusy) return;
    const nextLevel = owned.level + 1;
    const cost = propertyUpgradeCost(listing, nextLevel);
    if (!canReviewCharge(cost)) return;
    const confirmed = await ui.confirmAction({
      kicker: 'HOME UPGRADE', title: `Upgrade ${listing.name} to level ${nextLevel}?`,
      body: 'The upgrade adds real furnishings and one permanent garage slot. Your existing title and room access are preserved.',
      confirmLabel: `Upgrade for ${formatLrd(cost)}`, cancelLabel: 'Keep current level',
      details: [{ label: 'Available balance', value: formatLrd(world.wallet.balanceLrd) }, { label: 'Upgrade total', value: formatLrd(cost), emphasis: true }, { label: 'Balance after upgrade', value: formatLrd(world.wallet.balanceLrd - cost) }],
    });
    if (confirmed) await runLifestyleMutation((requestId) => api.upgradeProperty(propertyId, requestId), 'Home upgraded. Your garage capacity has increased.');
  })();
});
ui.on('buy-vehicle', ({ modelId, configuration }) => {
  void runLifestyleMutation((requestId) => api.purchaseVehicle(modelId, requestId, configuration), 'Vehicle purchased with its factory configuration. Select it when you are on foot.');
});
ui.on('upgrade-vehicle', ({ vehicleId, kind }) => {
  void (async () => {
    if (game.isInsideHome) { ui.toast('Step outside your home before upgrading a vehicle.', 'info'); return; }
    if (game.isDriving) { ui.toast('Park and exit before upgrading a vehicle.', 'info'); return; }
    const vehicle = world?.vehicles.find((entry) => entry.id === vehicleId);
    if (!world || !vehicle || lifestyleBusy) return;
    if (world.activeTrip) { ui.toast('Finish your active passenger trip before upgrading a vehicle.', 'info'); return; }
    const upgrade = VEHICLE_UPGRADES[kind];
    const nextLevel = vehicle.upgrades[kind] + 1;
    const cost = vehicleUpgradeCost(kind, nextLevel);
    if (!canReviewCharge(cost)) return;
    const confirmed = await ui.confirmAction({
      kicker: 'WORKSHOP UPGRADE', title: `Install ${upgrade.name}?`,
      body: `${vehicle.model.name} will receive level ${nextLevel}. ${upgrade.description} This is a real handling change, not a visual-only upgrade.`,
      confirmLabel: `Install for ${formatLrd(cost)}`, cancelLabel: 'Keep current setup',
      details: [{ label: 'Vehicle', value: `${vehicle.model.name} · ${vehicle.plate}` }, { label: 'Upgrade total', value: formatLrd(cost), emphasis: true }, { label: 'Balance after upgrade', value: formatLrd(world.wallet.balanceLrd - cost) }],
    });
    if (confirmed) await runLifestyleMutation((requestId) => api.upgradeVehicle(vehicleId, kind, requestId), 'Vehicle upgrade installed. Its handling has been updated.');
  })();
});
ui.on('select-vehicle', (vehicleId) => {
  if (game.isInsideHome) { ui.toast('Step outside your home before selecting a vehicle.', 'info'); return; }
  if (game.isDriving) { ui.toast('Park and exit before selecting another vehicle.', 'info'); return; }
  void runLifestyleMutation((requestId) => api.selectVehicle(vehicleId, requestId), 'Vehicle selected and ready at your parking position.');
});

ui.on('accept-task', (templateId) => {
  void runPhoneTaskMutation((requestId) => api.acceptTask(templateId, requestId), 'accept');
});
ui.on('accept-civic-task', ({ templateId, incidentId }) => {
  void runPhoneTaskMutation((requestId) => api.acceptTask(templateId, requestId, incidentId), 'accept');
});
ui.on('report-civic', (siteId) => {
  void (async () => {
    if (civicBusy) return;
    civicBusy = true;
    ui.setCivicError('');
    ui.setCivicBusy(true);
    try {
      const result = await api.reportCivicIncident(siteId, crypto.randomUUID());
      if (world) world.civic = { incidents: result.incidents, safety: result.safety };
      game.setCivicIncidents(result.incidents);
      ui.updateCivic({ incidents: result.incidents, safety: result.safety });
      ui.notify({ category: 'civic', tone: result.duplicate ? 'info' : 'success', title: result.duplicate ? 'Civic report already recorded' : 'Civic report recorded', message: result.duplicate ? 'No duplicate report or reward was created.' : 'A shared work order is now available to nearby citizens.', action: { type: 'civic', label: 'Open Civic' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to file this civic report.';
      ui.setCivicError(message);
      ui.notify({ category: 'civic', tone: 'error', title: 'Civic report not submitted', message, action: { type: 'refresh-civic', label: 'Retry Civic refresh' } });
    } finally {
      civicBusy = false;
      ui.setCivicBusy(false);
    }
  })();
});
ui.on('cancel-task', (taskId) => {
  void (async () => {
    const task = world?.activeTask;
    if (!task || task.id !== taskId || taskBusy) return;
    const definition = getCitizenTaskDefinition(task.templateId);
    const confirmed = await ui.confirmAction({
      kicker: 'ACTIVE CITIZEN WORK', title: `Cancel ${definition.title}?`,
      body: 'Your current objective progress will be released and no reward will be paid. This does not affect your wallet, vehicle or passenger history.',
      confirmLabel: 'Cancel active task', cancelLabel: 'Continue task', tone: 'danger',
      details: [{ label: 'Progress', value: `${task.stepIndex} of ${definition.steps.length} objectives complete` }, { label: 'Reward impact', value: `No ${formatLrd(task.rewardLrd)} reward`, emphasis: true }],
    });
    if (confirmed) await runPhoneTaskMutation((requestId) => api.cancelTask(taskId, requestId), 'cancel');
  })();
});

function applyTaskResult(result: CitizenTaskMutationResult) {
  if (world) {
    world.activeTask = result.activeTask;
    world.taskStats = result.taskStats;
    world.wallet = result.wallet;
  }
  game.setTask(result.task);
  ui.updateTasks(result);
  if (world) ui.updateJobs(world.jobs, world.activeTrip);
  ui.updateWallet(result.wallet);
  void refreshCivic();
}

async function runPhoneTaskMutation(operation: (requestId: string) => Promise<CitizenTaskMutationResult>, action: 'accept' | 'cancel') {
  if (taskBusy) return;
  taskBusy = true;
  ui.setTaskError('');
  ui.setTaskBusy(true);
  try {
    const result = await operation(crypto.randomUUID());
    applyTaskResult(result);
    if (result.duplicate) ui.notify({ category: 'civic', tone: 'info', title: 'Task request already recorded', message: 'No additional task change or reward was made.', action: { type: 'civic', label: 'Open Civic' } });
    else if (action === 'accept') ui.notify({ category: 'civic', tone: 'success', title: 'Citizen task accepted', message: 'Follow GPS to the marked objective. Your progress is validated by the server.', action: { type: 'civic', label: 'View task' } });
    else ui.notify({ category: 'civic', tone: 'info', title: 'Citizen task cancelled', message: 'The active task was released. No reward was paid.', action: { type: 'civic', label: 'View citizen work' } });
    if (action === 'accept' && result.activeTask) ui.closePanels();
    if (action === 'accept' && !result.duplicate) game.audio.feedback('success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update the citizen task.';
    ui.setTaskError(message);
    ui.notify({ category: 'civic', tone: 'error', title: 'Citizen task was not updated', message, action: { type: 'refresh-civic', label: 'Retry Civic refresh' } });
  } finally {
    taskBusy = false;
    ui.setTaskBusy(false);
  }
}

function canReviewCharge(cost: number) {
  if (!world) return false;
  if (world.wallet.balanceLrd >= cost) return true;
  ui.notify({ category: 'transaction', tone: 'error', title: 'Insufficient LRD', message: `You need ${formatLrd(cost - world.wallet.balanceLrd)} more for this action. No charge was made.`, action: { type: 'wallet', label: 'View wallet' } });
  return false;
}

async function runLifestyleMutation(operation: (requestId: string) => Promise<LifestyleMutationResult>, success: string) {
  if (lifestyleBusy) return;
  lifestyleBusy = true;
  ui.setLifestyleBusy(true);
  try {
    const result = await operation(crypto.randomUUID());
    if (world) Object.assign(world, result);
    ui.setLifestyleState(result);
    game.applyLifestyle(result);
    ui.notify({ category: 'transaction', tone: result.duplicate ? 'info' : 'success', title: result.duplicate ? 'Request already recorded' : 'Transaction completed', message: result.duplicate ? 'No additional charge or ownership change was made.' : success, action: { type: 'wallet', label: 'View wallet' } });
    if (!result.duplicate) game.audio.feedback('success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The purchase could not be completed.';
    ui.setLifestyleError(message);
    ui.notify({ category: 'transaction', tone: 'error', title: 'Transaction could not be completed', message, action: { type: 'refresh-wallet', label: 'Check wallet' } });
  } finally {
    lifestyleBusy = false;
    ui.setLifestyleBusy(false);
  }
}

async function handleTaskInteraction(interaction: CitizenTaskInteraction) {
  if (taskBusy) return;
  taskBusy = true;
  ui.setTaskError('');
  ui.setTaskBusy(true);
  try {
    const result = await api.advanceTask(interaction.taskId, interaction.stepId, interaction.position, crypto.randomUUID());
    applyTaskResult(result);
    if (result.duplicate) ui.notify({ category: 'civic', tone: 'info', title: 'Objective already recorded', message: 'No additional reward was paid.', action: { type: 'civic', label: 'Open Civic' } });
    else if (result.task?.status === 'completed') {
      ui.notify({ category: 'transaction', tone: 'success', title: 'Citizen task complete', message: `${formatLrd(result.task.rewardLrd)} was added to your persistent wallet.`, action: { type: 'wallet', label: 'View wallet' } });
      game.audio.feedback('success');
    } else ui.notify({ category: 'civic', tone: 'success', title: 'Objective complete', message: 'The next marked step is ready. Follow the updated GPS route.', action: { type: 'civic', label: 'View task' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to record this objective.';
    ui.setTaskError(message);
    ui.notify({ category: 'civic', tone: 'error', title: 'Objective was not recorded', message, action: { type: 'refresh-civic', label: 'Retry Civic refresh' } });
  } finally {
    taskBusy = false;
    ui.setTaskBusy(false);
  }
}

async function handleTripAction() {
  if (!world?.activeTrip || tripBusy) return;
  tripBusy = true;
  const trip = world.activeTrip;
  try {
    if (trip.status === 'accepted') {
      const result = await api.pickup(trip.id);
      world.activeTrip = result.trip;
      game.setTrip(result.trip);
      guide.tripPickedUp(result.trip);
      ui.updateJobs(world.jobs, result.trip);
      ui.notify({ category: 'transaction', tone: 'success', title: 'Passenger collected', message: `${result.trip.passengerName} is on board. Follow the GPS to the destination.`, action: { type: 'refresh-dispatch', label: 'Refresh route' } });
      game.audio.feedback('success');
    } else if (trip.status === 'active') {
      const result = await api.complete(trip.id);
      world.activeTrip = null;
      world.wallet = result.wallet;
      game.setTrip(null);
      if (result.duplicate) guide.tripCancelled(result.trip.id);
      else {
        guide.tripCompleted(result.trip);
        if (guide.snapshot().status === 'complete') void persistOnboarding('completed');
      }
      ui.updateWallet(result.wallet);
      ui.notify({ category: 'transaction', tone: result.duplicate ? 'info' : 'success', title: result.duplicate ? 'Fare already recorded' : 'Fare completed', message: result.duplicate ? 'No duplicate payment was made. Check the wallet ledger for the original transaction.' : `${formatLrd(result.trip.fareLrd)} was added to your persistent wallet.`, action: { type: 'wallet', label: 'View wallet' } });
      game.audio.feedback('success');
      await refreshWorld();
    }
  } catch (error) {
    ui.notify({ category: 'transaction', tone: 'error', title: 'Trip action could not be completed', message: error instanceof Error ? error.message : 'Trip interaction failed. Your server trip remains unchanged.', action: { type: 'refresh-dispatch', label: 'Refresh trip' } });
  } finally { tripBusy = false; }
}

async function refreshWorld() {
  if (!world) return;
  try {
    const jobs = await api.jobs();
    world.jobs = jobs.jobs;
    ui.updateJobs(world.jobs, world.activeTrip);
  } catch (error) {
    ui.notify({ category: 'connection', tone: 'error', title: 'Dispatch could not be refreshed', message: error instanceof Error ? error.message : 'The request list is temporarily unavailable. Your active trip remains intact.', action: { type: 'refresh-dispatch', label: 'Retry dispatch' } });
  }
}

async function refreshCivic() {
  if (!world) return;
  try {
    const civic = await api.civic();
    world.civic = civic;
    game.setCivicIncidents(civic.incidents);
    ui.updateCivic(civic);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Civic services are temporarily unavailable.';
    ui.setCivicError(message);
    ui.notify({ category: 'civic', tone: 'error', title: 'Civic services could not be refreshed', message, action: { type: 'refresh-civic', label: 'Retry Civic refresh' } });
  }
}

void (async () => {
  try {
    await api.session();
    const bootstrap = await loadWorld();
    ui.showLobby(profile!, bootstrap);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401) && error instanceof Error) console.info('Session restore:', error.message);
  }
})();
