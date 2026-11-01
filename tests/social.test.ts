import { describe, expect, it } from 'vitest';
import { appendSocialMessage, citizenActivityLabel, socialRosterSignature, type NearbyCitizen, type SocialChatMessage } from '../src/client/social';

const message = (id: string): SocialChatMessage => ({ id, displayName: 'Musu', text: 'Hello nearby', sentAt: '2026-11-02T06:00:00.000Z' });
const citizen = (id: string, mode: 'walking' | 'driving' = 'walking'): NearbyCitizen => ({ id, displayName: id, handle: id, mode, insideHome: false });

describe('nearby social interface models', () => {
  it('bounds chat history and ignores duplicate server deliveries', () => {
    let history: SocialChatMessage[] = [];
    for (const id of ['a', 'b', 'c']) history = appendSocialMessage(history, message(id), 2);
    expect(history.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(appendSocialMessage(history, message('c'), 2)).toEqual(history);
  });

  it('changes roster signatures only when citizen presence or activity changes', () => {
    const roster = [citizen('b'), citizen('a', 'driving')];
    expect(socialRosterSignature(roster)).toBe(socialRosterSignature([...roster].reverse()));
    expect(socialRosterSignature(roster)).not.toBe(socialRosterSignature([citizen('b'), citizen('a')]));
  });

  it('describes real nearby activity without implying unavailable social features', () => {
    expect(citizenActivityLabel(citizen('driver', 'driving'))).toBe('Driving nearby');
    expect(citizenActivityLabel({ ...citizen('home'), insideHome: true })).toBe('Inside a home');
  });
});
