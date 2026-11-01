export type ConnectionPhase = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  attempt: number;
  lastError: string | null;
  nextRetryAt: number | null;
}

export const INITIAL_CONNECTION_STATUS: ConnectionStatus = {
  phase: 'idle', attempt: 0, lastError: null, nextRetryAt: null,
};

/** Bounded backoff keeps recovery responsive without hammering a struggling server. */
export function reconnectDelay(attempt: number) {
  const normalized = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return Math.min(10_000, 1_200 * 2 ** Math.min(normalized - 1, 4));
}

export function connectionPhaseLabel(phase: ConnectionPhase) {
  return ({ idle: 'NOT CONNECTED', connecting: 'CONNECTING', online: 'LIVE', reconnecting: 'RECONNECTING', offline: 'OFFLINE' })[phase];
}
