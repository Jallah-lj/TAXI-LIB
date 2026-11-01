import type { OnboardingStatus, TaxiTrip } from '../shared/types';
import type { Point2 } from '../shared/world';

export const FIRST_TRIP_STEPS = ['move', 'vehicle', 'phone', 'request', 'pickup', 'dropoff'] as const;
export type FirstTripStep = (typeof FIRST_TRIP_STEPS)[number];
export type FirstTripGuideStatus = 'idle' | 'welcome' | 'active' | 'complete';

export interface FirstTripGuideState {
  status: FirstTripGuideStatus;
  step: FirstTripStep;
  tripId: string | null;
  passengerName: string;
  fareLrd: number | null;
}

export interface FirstTripSnapshot {
  position: Point2;
  mode: 'walking' | 'driving';
  activeTrip: TaxiTrip | null;
}

const IDLE_STATE: FirstTripGuideState = {
  status: 'idle', step: 'move', tripId: null, passengerName: '', fareLrd: null,
};

/**
 * Session-only state machine for the guided first trip. Domain events, rather
 * than button clicks or timers, unlock every gameplay milestone.
 */
export class FirstTripGuide {
  private state: FirstTripGuideState = { ...IDLE_STATE };
  private lastPosition: Point2 | null = null;
  private movementMetres = 0;

  constructor(private readonly onChange: (state: FirstTripGuideState) => void = () => undefined) {}

  snapshot(): FirstTripGuideState { return { ...this.state }; }

  offer(accountStatus: OnboardingStatus) {
    if (accountStatus !== 'new' || this.state.status !== 'idle') return;
    this.setState({ status: 'welcome' });
  }

  start(game: FirstTripSnapshot) {
    if (this.state.status === 'active') return;
    const trip = game.activeTrip && ['accepted', 'active'].includes(game.activeTrip.status) ? game.activeTrip : null;
    this.lastPosition = { ...game.position };
    this.movementMetres = 0;
    this.setState({
      status: 'active',
      step: trip ? (trip.status === 'accepted' ? 'pickup' : 'dropoff') : game.mode === 'driving' ? 'phone' : 'move',
      tripId: trip?.id ?? null,
      passengerName: trip?.passengerName ?? '',
      fareLrd: trip?.fareLrd ?? null,
    });
  }

  dismiss() {
    this.lastPosition = null;
    this.movementMetres = 0;
    this.setState({ ...IDLE_STATE });
  }

  close() { this.dismiss(); }

  update(position: Point2, mode: 'walking' | 'driving') {
    if (this.state.status !== 'active') return;
    if (this.state.step === 'move') {
      // Entering the taxi is also valid evidence that the player can move.
      if (mode === 'driving') {
        this.setState({ step: 'phone' });
        return;
      }
      if (this.lastPosition) {
        const distance = Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z);
        // Teleports/respawns are not walking evidence and must not advance the guide.
        if (distance <= 2) this.movementMetres += distance;
      }
      this.lastPosition = { ...position };
      if (this.movementMetres >= 1.5) this.setState({ step: 'vehicle' });
      return;
    }
    this.lastPosition = { ...position };
    if (this.state.step === 'vehicle' && mode === 'driving') this.setState({ step: 'phone' });
  }

  panelChanged(panel: string | null) {
    if (this.state.status === 'active' && this.state.step === 'phone' && panel === 'phone') {
      this.setState({ step: 'request' });
    }
  }

  tripAccepted(trip: TaxiTrip) {
    if (this.state.status !== 'active' || trip.status !== 'accepted') return;
    this.setState({ step: 'pickup', tripId: trip.id, passengerName: trip.passengerName, fareLrd: trip.fareLrd });
  }

  tripPickedUp(trip: TaxiTrip) {
    if (this.state.status !== 'active' || this.state.tripId !== trip.id || trip.status !== 'active') return;
    this.setState({ step: 'dropoff', passengerName: trip.passengerName, fareLrd: trip.fareLrd });
  }

  tripCompleted(trip: TaxiTrip) {
    if (this.state.status !== 'active' || this.state.tripId !== trip.id || trip.status !== 'completed') return;
    this.setState({ status: 'complete', passengerName: trip.passengerName, fareLrd: trip.fareLrd });
  }

  tripCancelled(tripId: string) {
    if (this.state.status !== 'active' || this.state.tripId !== tripId) return;
    this.setState({ step: 'request', tripId: null, passengerName: '', fareLrd: null });
  }

  private setState(patch: Partial<FirstTripGuideState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.snapshot());
  }
}

export function firstTripStepNumber(step: FirstTripStep) {
  return FIRST_TRIP_STEPS.indexOf(step) + 1;
}
