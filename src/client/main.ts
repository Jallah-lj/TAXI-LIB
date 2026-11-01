import './style.css';
import { UI } from './ui';
import { Game, type CitizenTaskInteraction, type HUDState } from './game';
import { api, ApiError } from './api';
import type { CitizenTaskMutationResult, LifestyleMutationResult, OnboardingStatus, PlayerProfile, WorldBootstrap } from '../shared/types';
import { PLAYER_SPAWN } from '../shared/world';
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
      if (notice) ui.toast(notice, notice.includes('fine recorded') ? 'error' : 'info');
    },
    onToast: (message, kind) => ui.toast(message, kind),
    onConnection: (connected) => ui.setConnection(connected),
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
      ui.toast(`Request accepted. Pick up ${result.trip.passengerName}; the fare is server-reserved.`, 'success');
      game.audio.feedback('success');
    } catch (error) {
      ui.toast(error instanceof Error ? error.message : 'Unable to accept request.', 'error');
      await refreshWorld();
    } finally { tripBusy = false; }
  })();
});
ui.on('cancel-trip', () => {
  void (async () => {
    if (!world?.activeTrip || tripBusy) return;
    const cancelledTripId = world.activeTrip.id;
    tripBusy = true;
    try {
      await api.cancel(cancelledTripId);
      world.activeTrip = null;
      game.setTrip(null);
      guide.tripCancelled(cancelledTripId);
      await refreshWorld();
      ui.toast('Trip cancelled. No fare was charged or paid.', 'info');
    } catch (error) { ui.toast(error instanceof Error ? error.message : 'Unable to cancel trip.', 'error'); }
    finally { tripBusy = false; }
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
ui.on('chat', (text: string) => game.chat(text));
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
    ui.toast(message, 'error');
  });
});
ui.on('refresh-jobs', () => { void refreshWorld(); });
ui.on('load-civic', () => { void refreshCivic(); });

ui.on('buy-property', (listingId) => {
  void runLifestyleMutation((requestId) => api.purchaseProperty(listingId, requestId), 'Home purchased. Your title and extra garage slot are saved.');
});
ui.on('upgrade-property', (propertyId) => {
  void runLifestyleMutation((requestId) => api.upgradeProperty(propertyId, requestId), 'Home upgraded. Your garage capacity has increased.');
});
ui.on('buy-vehicle', ({ modelId, configuration }) => {
  void runLifestyleMutation((requestId) => api.purchaseVehicle(modelId, requestId, configuration), 'Vehicle purchased with its factory configuration. Select it when you are on foot.');
});
ui.on('upgrade-vehicle', ({ vehicleId, kind }) => {
  if (game.isInsideHome) { ui.toast('Step outside your home before upgrading a vehicle.', 'info'); return; }
  if (game.isDriving) { ui.toast('Park and exit before upgrading a vehicle.', 'info'); return; }
  void runLifestyleMutation((requestId) => api.upgradeVehicle(vehicleId, kind, requestId), 'Vehicle upgrade installed. Its handling has been updated.');
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
      ui.toast(result.duplicate ? 'This civic report was already recorded.' : 'Civic report recorded. A shared work order is now available.', 'success');
    } catch (error) {
      ui.setCivicError(error instanceof Error ? error.message : 'Unable to file this civic report.');
    } finally {
      civicBusy = false;
      ui.setCivicBusy(false);
    }
  })();
});
ui.on('cancel-task', (taskId) => {
  void runPhoneTaskMutation((requestId) => api.cancelTask(taskId, requestId), 'cancel');
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
    if (result.duplicate) ui.toast('This task request was already recorded; no additional change was made.', 'info');
    else if (action === 'accept') ui.toast('Citizen task accepted. Follow GPS to the marked objective.', 'success');
    else ui.toast('Citizen task cancelled. No reward was paid.', 'info');
    if (action === 'accept' && result.activeTask) ui.closePanels();
    if (action === 'accept' && !result.duplicate) game.audio.feedback('success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update the citizen task.';
    ui.setTaskError(message);
    ui.toast(message, 'error');
  } finally {
    taskBusy = false;
    ui.setTaskBusy(false);
  }
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
    ui.toast(result.duplicate ? 'This request was already recorded; no additional charge was made.' : success, 'success');
    if (!result.duplicate) game.audio.feedback('success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The purchase could not be completed.';
    ui.setLifestyleError(message);
    ui.toast(message, 'error');
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
    if (result.duplicate) ui.toast('This objective was already recorded; no additional reward was paid.', 'info');
    else if (result.task?.status === 'completed') {
      ui.toast(`Citizen task complete. +${result.task.rewardLrd.toLocaleString()} LRD added to your wallet.`, 'success');
      game.audio.feedback('success');
    } else ui.toast('Objective complete. The next marked step is ready.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to record this objective.';
    ui.setTaskError(message);
    ui.toast(message, 'error');
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
      ui.toast(`${result.trip.passengerName} is on board. Follow the GPS to the destination.`, 'success');
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
      ui.toast(result.duplicate ? 'This fare was already paid; no duplicate payment was made.' : `Trip complete. +L$ ${result.trip.fareLrd.toLocaleString()} added to your persistent wallet.`, 'success');
      game.audio.feedback('success');
      await refreshWorld();
    }
  } catch (error) {
    ui.toast(error instanceof Error ? error.message : 'Trip interaction failed.', 'error');
  } finally { tripBusy = false; }
}

async function refreshWorld() {
  if (!world) return;
  try {
    const jobs = await api.jobs();
    world.jobs = jobs.jobs;
    ui.updateJobs(world.jobs, world.activeTrip);
  } catch { /* The next dispatch refresh can retry; active trip state remains intact. */ }
}

async function refreshCivic() {
  if (!world) return;
  try {
    const civic = await api.civic();
    world.civic = civic;
    game.setCivicIncidents(civic.incidents);
    ui.updateCivic(civic);
  } catch { /* Realtime and the next Civic app open will retry. */ }
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
