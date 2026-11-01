import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const handle = `smoke_${Date.now().toString(36)}`;
let cookie = '';

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${data.error ?? 'failed'}`);
  return data;
}

const registration = await api('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ handle, password: 'local-smoke-password', displayName: 'Live Smoke Driver' }),
});
assert.equal(registration.player.handle, handle);

// Node fetch exposes the Set-Cookie header for this local administrative smoke client.
// Re-login through fetch so the cookie comes from the actual auth response.
const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, password: 'local-smoke-password' }),
});
assert.equal(loginResponse.status, 200);
cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
assert.ok(cookie.startsWith('taxilib_session='));

const initial = await api('/api/world');
assert.equal(initial.wallet.balanceLrd, 12500);
assert.equal(initial.vehicles.length, 1);
assert.ok(initial.jobs.length > 0);
const vehicle = initial.vehicles[0];
const wsUrl = `${base.replace(/^http/, 'ws')}/ws`;
const socket = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
const messages = [];
socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
for (let attempt = 0; attempt < 50 && !messages.some((message) => message.type === 'welcome'); attempt += 1) await sleep(20);
assert.ok(messages.some((message) => message.type === 'welcome'));

let sequence = 0;
let current = { x: 12, z: 42 };
function sendState(target, heading = 0) {
  sequence += 1;
  socket.send(JSON.stringify({
    type: 'state', position: [target.x, 0.08, target.z], heading, speed: 0,
    mode: 'driving', vehicleId: vehicle.id, lightsOn: true, sequence,
  }));
}
async function driveTo(target) {
  while (Math.hypot(target.x - current.x, target.z - current.z) > 0.25) {
    const dx = target.x - current.x;
    const dz = target.z - current.z;
    const distance = Math.hypot(dx, dz);
    const step = Math.min(1.2, distance);
    const next = { x: current.x + dx / distance * step, z: current.z + dz / distance * step };
    sequence += 1;
    socket.send(JSON.stringify({
      type: 'state', position: [next.x, 0.08, next.z], heading: Math.atan2(dx, dz), speed: 17,
      mode: 'driving', vehicleId: vehicle.id, lightsOn: true, sequence,
    }));
    current = next;
    await sleep(70);
  }
  sendState(current);
  await sleep(150);
}

sendState(current);
await sleep(120);
const job = initial.jobs[0];
const accepted = await api(`/api/taxi/jobs/${job.id}/accept`, { method: 'POST', body: JSON.stringify({ vehicleId: vehicle.id }) });
const trip = accepted.trip;
const pickup = initial.locations.find((location) => location.id === trip.pickupLocationId);
const destination = initial.locations.find((location) => location.id === trip.destinationLocationId);
await driveTo(pickup);
const pickedUp = await api(`/api/taxi/trips/${trip.id}/pickup`, { method: 'POST' });
assert.equal(pickedUp.trip.status, 'active');
await driveTo(destination);
await sleep(1200);
let completed;
for (let attempt = 0; attempt < 6; attempt += 1) {
  try {
    completed = await api(`/api/taxi/trips/${trip.id}/complete`, { method: 'POST' });
    break;
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('journey is still in progress')) || attempt === 5) throw error;
    await sleep(1500);
  }
}
assert.ok(completed, 'Trip did not complete');
assert.equal(completed.trip.status, 'completed');
assert.equal(completed.duplicate, false);
assert.equal(completed.wallet.balanceLrd, initial.wallet.balanceLrd + trip.fareLrd);
const duplicate = await api(`/api/taxi/trips/${trip.id}/complete`, { method: 'POST' });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.wallet.balanceLrd, completed.wallet.balanceLrd);
const restored = await api('/api/world');
assert.equal(restored.wallet.balanceLrd, completed.wallet.balanceLrd);
assert.equal(restored.activeTrip, null);
const wallet = await api('/api/wallet');
assert.equal(wallet.ledger.filter((entry) => entry.kind === 'taxi_fare').length, 1);
// Leave the vehicle before using garage services, then exercise live lifestyle commerce.
sequence += 1;
socket.send(JSON.stringify({
  type: 'state', position: [current.x, 0.14, current.z], heading: 0, speed: 0,
  mode: 'walking', sequence,
}));
await sleep(200);
socket.close();

const vehicleRequestId = randomUUID();
const purchasedVehicle = await api('/api/lifestyle/vehicles/purchase', {
  method: 'POST', body: JSON.stringify({ modelId: 'city-hatchback', requestId: vehicleRequestId }),
});
assert.equal(purchasedVehicle.duplicate, false);
assert.equal(purchasedVehicle.vehicles.length, 2);
assert.equal(purchasedVehicle.wallet.balanceLrd, completed.wallet.balanceLrd - 11000);
const replayedVehiclePurchase = await api('/api/lifestyle/vehicles/purchase', {
  method: 'POST', body: JSON.stringify({ modelId: 'city-hatchback', requestId: vehicleRequestId }),
});
assert.equal(replayedVehiclePurchase.duplicate, true);
assert.equal(replayedVehiclePurchase.wallet.balanceLrd, purchasedVehicle.wallet.balanceLrd);
const hatchback = purchasedVehicle.vehicles.find((entry) => entry.modelId === 'city-hatchback');
assert.ok(hatchback);
const upgradedVehicle = await api('/api/lifestyle/vehicles/upgrade', {
  method: 'POST', body: JSON.stringify({ vehicleId: hatchback.id, kind: 'engine', requestId: randomUUID() }),
});
assert.equal(upgradedVehicle.wallet.balanceLrd, purchasedVehicle.wallet.balanceLrd - 1800);
const effectiveHatchback = upgradedVehicle.vehicles.find((entry) => entry.id === hatchback.id);
assert.equal(effectiveHatchback.upgrades.engine, 1);
assert.ok(Math.abs(effectiveHatchback.model.acceleration - 9.9) < 0.0001);
const selectedVehicle = await api('/api/lifestyle/vehicles/select', {
  method: 'POST', body: JSON.stringify({ vehicleId: hatchback.id, requestId: randomUUID() }),
});
assert.equal(selectedVehicle.selectedVehicleId, hatchback.id);
assert.equal(selectedVehicle.wallet.balanceLrd, upgradedVehicle.wallet.balanceLrd);

// Use a separate fresh citizen to verify home ownership and its real garage-capacity effect.
const homeHandle = `home_${Date.now().toString(36)}`;
cookie = '';
await api('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ handle: homeHandle, password: 'local-smoke-password', displayName: 'Live Home Buyer' }),
});
const homeLogin = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: homeHandle, password: 'local-smoke-password' }),
});
assert.equal(homeLogin.status, 200);
cookie = homeLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
assert.ok(cookie.startsWith('taxilib_session='));
const propertyRequestId = randomUUID();
const purchasedHome = await api('/api/lifestyle/properties/purchase', {
  method: 'POST', body: JSON.stringify({ listingId: 'sinkor-studio', requestId: propertyRequestId }),
});
assert.equal(purchasedHome.wallet.balanceLrd, 5000);
assert.equal(purchasedHome.garageCapacity, 3);
const replayedHomePurchase = await api('/api/lifestyle/properties/purchase', {
  method: 'POST', body: JSON.stringify({ listingId: 'sinkor-studio', requestId: propertyRequestId }),
});
assert.equal(replayedHomePurchase.duplicate, true);
assert.equal(replayedHomePurchase.wallet.balanceLrd, 5000);
const home = purchasedHome.properties[0];
assert.ok(home);
const upgradedHome = await api('/api/lifestyle/properties/upgrade', {
  method: 'POST', body: JSON.stringify({ propertyId: home.id, requestId: randomUUID() }),
});
assert.equal(upgradedHome.wallet.balanceLrd, 2500);
assert.equal(upgradedHome.garageCapacity, 4);
assert.equal(upgradedHome.properties[0].level, 2);

// Live indoor presence must be ownership-accepted, then block exterior vehicle services until exit.
const homeSocket = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
const homeMessages = [];
homeSocket.on('message', (data) => homeMessages.push(JSON.parse(data.toString())));
await new Promise((resolve, reject) => { homeSocket.on('open', resolve); homeSocket.on('error', reject); });
for (let attempt = 0; attempt < 50 && !homeMessages.some((message) => message.type === 'welcome'); attempt += 1) await sleep(20);
assert.ok(homeMessages.some((message) => message.type === 'welcome'));
homeSocket.send(JSON.stringify({
  type: 'state', position: [12, 0.14, 42], heading: 0, speed: 0,
  mode: 'walking', interiorPropertyId: home.id, sequence: 1,
}));
await sleep(200);
const homeVehicle = upgradedHome.vehicles[0];
assert.ok(homeVehicle);
const blockedSelection = await fetch(`${base}/api/lifestyle/vehicles/select`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ vehicleId: homeVehicle.id, requestId: randomUUID() }),
});
assert.equal(blockedSelection.status, 409);
const blockedBody = await blockedSelection.json();
assert.match(blockedBody.error, /Step outside/);
homeSocket.send(JSON.stringify({
  type: 'state', position: [12, 0.14, 42], heading: 0, speed: 0, mode: 'walking', sequence: 2,
}));
await sleep(200);
const exteriorSelection = await api('/api/lifestyle/vehicles/select', {
  method: 'POST', body: JSON.stringify({ vehicleId: homeVehicle.id, requestId: randomUUID() }),
});
assert.equal(exteriorSelection.selectedVehicleId, homeVehicle.id);
assert.equal(exteriorSelection.wallet.balanceLrd, 2500);
homeSocket.close();

console.log(JSON.stringify({
  status: 'passed', player: handle, trip: trip.id, pickup: pickup.name, destination: destination.name,
  fareLrd: trip.fareLrd, fareBalanceLrd: restored.wallet.balanceLrd, duplicateProtected: true,
  purchasedVehicleId: hatchback.id, upgradedAcceleration: effectiveHatchback.model.acceleration,
  selectedVehicleId: selectedVehicle.selectedVehicleId, lifestyleBalanceLrd: selectedVehicle.wallet.balanceLrd,
  propertyId: home.id, propertyLevel: upgradedHome.properties[0].level, garageCapacity: upgradedHome.garageCapacity,
  interiorVehicleGuard: 'passed', exteriorSelectionRestored: true,
}, null, 2));
