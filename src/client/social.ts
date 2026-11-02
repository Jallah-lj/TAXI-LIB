import type { MovementMode } from '../shared/protocol';

export interface NearbyCitizen {
  id: string;
  displayName: string;
  handle: string;
  mode: MovementMode;
  insideHome: boolean;
}

export interface SocialChatMessage {
  id: string;
  playerId?: string;
  displayName: string;
  text: string;
  sentAt: string;
}

export function appendSocialMessage(history: SocialChatMessage[], message: SocialChatMessage, limit = 40) {
  if (history.some((entry) => entry.id === message.id)) return [...history];
  return [...history, message].slice(-Math.max(1, limit));
}

export function socialRosterSignature(players: readonly NearbyCitizen[]) {
  return players.map((player) => `${player.id}:${player.mode}:${player.insideHome}`).sort().join('|');
}

export function citizenActivityLabel(player: NearbyCitizen) {
  if (player.insideHome) return 'Inside a home';
  return player.mode === 'driving' ? 'Driving nearby' : 'On foot nearby';
}
