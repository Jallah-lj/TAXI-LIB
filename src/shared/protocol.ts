import { z } from 'zod';
import type { PlayerProfile, Wallet } from './types.js';
import type { CivicIncident, PlayerSafetyState } from './civic.js';
import type { SimulationState } from './simulation.js';
import type { PlayerHealthState } from './health.js';

export type MovementMode = 'walking' | 'driving';
export type Vec3 = [number, number, number];

export interface MovementState {
  playerId: string;
  position: Vec3;
  heading: number;
  speed: number;
  mode: MovementMode;
  vehicleId?: string;
  lightsOn?: boolean;
  interiorPropertyId?: string;
  sequence: number;
  sentAt: number;
}

export const movementInputSchema = z.object({
  type: z.literal('state'),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  heading: z.number().finite().min(-Math.PI * 4).max(Math.PI * 4),
  speed: z.number().finite().min(-20).max(80),
  mode: z.enum(['walking', 'driving']),
  vehicleId: z.string().uuid().optional(),
  lightsOn: z.boolean().optional(),
  interiorPropertyId: z.string().uuid().optional(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const chatInputSchema = z.object({
  type: z.literal('chat'),
  text: z.string().trim().min(1).max(200),
});

export const emoteInputSchema = z.object({
  type: z.literal('emote'),
  emote: z.enum(['wave']),
});

export const pingInputSchema = z.object({ type: z.literal('ping'), nonce: z.number().int().optional() });
export const clientMessageSchema = z.discriminatedUnion('type', [movementInputSchema, chatInputSchema, emoteInputSchema, pingInputSchema]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { type: 'welcome'; playerId: string; simulation: SimulationState }
  | { type: 'snapshot'; players: (MovementState & { profile: PlayerProfile })[] }
  | { type: 'player-joined'; profile: PlayerProfile }
  | { type: 'player-state'; state: MovementState }
  | { type: 'player-left'; playerId: string }
  | { type: 'chat'; id: string; playerId: string; displayName: string; text: string; sentAt: string }
  | { type: 'emote'; playerId: string; emote: 'wave' }
  | { type: 'world'; simulation: SimulationState }
  | { type: 'pong'; nonce?: number; serverTime: number }
  | { type: 'civic-incidents'; incidents: CivicIncident[] }
  | { type: 'player-health'; playerId: string; health: PlayerHealthState; state?: MovementState }
  | { type: 'safety'; safety: PlayerSafetyState; wallet: Wallet; notice: string }
  | { type: 'error'; error: string };
