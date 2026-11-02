import { describe, expect, it, vi } from 'vitest';
import { FIRST_TRIP_STEPS, FirstTripGuide, firstTripStepNumber } from '../src/client/onboarding';
import type { TaxiTrip, TaxiTripStatus } from '../src/shared/types';

function trip(status: TaxiTripStatus = 'accepted', id = 'trip-1'): TaxiTrip {
  return {
    id, jobId: `job-${id}`, vehicleId: 'vehicle-1', status, fareLrd: 650,
    passengerName: 'Musu Kollie', pickupLocationId: 'taxi-stand', destinationLocationId: 'sinkor-market',
    acceptedAt: '2026-11-01T06:00:00.000Z', pickedUpAt: status === 'accepted' ? null : '2026-11-01T06:02:00.000Z',
    completedAt: status === 'completed' ? '2026-11-01T06:08:00.000Z' : null,
  };
}

function walkingGuide() {
  const guide = new FirstTripGuide();
  guide.offer('new');
  guide.start({ position: { x: 0, z: 0 }, mode: 'walking', activeTrip: null });
  return guide;
}

describe('event-driven first-trip onboarding', () => {
  it('offers the guide only to new accounts and never reopens a settled preference', () => {
    const guide = new FirstTripGuide();
    guide.offer('completed');
    expect(guide.snapshot().status).toBe('idle');
    guide.offer('dismissed');
    expect(guide.snapshot().status).toBe('idle');
    guide.offer('new');
    expect(guide.snapshot().status).toBe('welcome');
    guide.dismiss();
    expect(guide.snapshot().status).toBe('idle');
    guide.offer('completed');
    expect(guide.snapshot().status).toBe('idle');
  });

  it('requires real short-range walking movement and ignores teleport discontinuities', () => {
    const guide = walkingGuide();
    guide.update({ x: 1, z: 0 }, 'walking');
    expect(guide.snapshot().step).toBe('move');
    guide.update({ x: 100, z: 0 }, 'walking');
    expect(guide.snapshot().step).toBe('move');
    guide.update({ x: 100.8, z: 0 }, 'walking');
    expect(guide.snapshot().step).toBe('vehicle');
  });

  it('advances from actual vehicle entry and phone use, not from unrelated panels', () => {
    const guide = walkingGuide();
    guide.update({ x: 0, z: 0 }, 'driving');
    expect(guide.snapshot().step).toBe('phone');
    guide.panelChanged('map');
    expect(guide.snapshot().step).toBe('phone');
    guide.panelChanged('phone');
    expect(guide.snapshot().step).toBe('request');
  });

  it('follows accepted, picked-up and completed server trip states with matching identities', () => {
    const guide = walkingGuide();
    guide.tripAccepted(trip());
    expect(guide.snapshot()).toMatchObject({ step: 'pickup', tripId: 'trip-1', passengerName: 'Musu Kollie' });
    guide.tripPickedUp(trip('active', 'another-trip'));
    expect(guide.snapshot().step).toBe('pickup');
    guide.tripPickedUp(trip('active'));
    expect(guide.snapshot().step).toBe('dropoff');
    guide.tripCompleted(trip('completed', 'another-trip'));
    expect(guide.snapshot().status).toBe('active');
    guide.tripCompleted(trip('completed'));
    expect(guide.snapshot()).toMatchObject({ status: 'complete', fareLrd: 650, tripId: 'trip-1' });
  });

  it('returns to request selection after cancellation without completing or charging the guide', () => {
    const guide = walkingGuide();
    guide.tripAccepted(trip());
    guide.tripPickedUp(trip('active'));
    guide.tripCancelled('trip-1');
    expect(guide.snapshot()).toMatchObject({ status: 'active', step: 'request', tripId: null, fareLrd: null });
    guide.tripCompleted(trip('completed'));
    expect(guide.snapshot().status).toBe('active');
    guide.tripAccepted(trip('accepted', 'trip-2'));
    expect(guide.snapshot()).toMatchObject({ step: 'pickup', tripId: 'trip-2' });
  });

  it('resumes a replay at the real open-trip milestone or current driving context', () => {
    const guide = new FirstTripGuide();
    guide.start({ position: { x: 4, z: 8 }, mode: 'driving', activeTrip: trip('active') });
    expect(guide.snapshot()).toMatchObject({ status: 'active', step: 'dropoff', tripId: 'trip-1' });
    guide.close();
    guide.start({ position: { x: 4, z: 8 }, mode: 'driving', activeTrip: null });
    expect(guide.snapshot().step).toBe('phone');
  });

  it('ignores gameplay events while inactive and exposes stable professional step numbering', () => {
    const changes = vi.fn();
    const guide = new FirstTripGuide(changes);
    guide.tripAccepted(trip());
    guide.tripCompleted(trip('completed'));
    expect(guide.snapshot().status).toBe('idle');
    expect(changes).not.toHaveBeenCalled();
    expect(FIRST_TRIP_STEPS.map(firstTripStepNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
