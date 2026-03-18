import { describe, it, expect } from 'vitest';
import { formatGameState, loadCardPool, Phase } from './index.js';
import type { GameState, PlayerState, Company, CharacterInPlay, CardInstance } from './index.js';
import type { PlayerId, CardInstanceId, CompanyId, CardDefinitionId } from './index.js';
import { CharacterStatus, WizardName } from './index.js';

// Helpers to create branded IDs
const pid = (s: string) => s as PlayerId;
const iid = (s: string) => s as CardInstanceId;
const cid = (s: string) => s as CompanyId;
const did = (s: string) => s as CardDefinitionId;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function makeMinimalPlayer(
  id: string,
  wizard: WizardName,
  companies: Company[],
  characters: Record<string, CharacterInPlay>,
): PlayerState {
  return {
    id: pid(id), wizard,
    hand: [],
    playDeck: [],
    discardPile: [],
    siteDeck: [], siteDiscardPile: [], sideboard: [],
    companies, characters,
    generalInfluenceUsed: 0, deckExhaustionCount: 0, freeCouncilCalled: false,
  };
}

describe('formatGameState', () => {
  it('renders Bilbo with Sting at Rivendell', () => {
    const pool = loadCardPool();

    const instances: Record<string, CardInstance> = {
      'bilbo-1': { instanceId: iid('bilbo-1'), definitionId: did('tw-131') },
      'sting-1': { instanceId: iid('sting-1'), definitionId: did('tw-333') },
      'rivendell-1': { instanceId: iid('rivendell-1'), definitionId: did('tw-421') },
    };

    const characters: Record<string, CharacterInPlay> = {
      'bilbo-1': {
        instanceId: iid('bilbo-1'), definitionId: did('tw-131'),
        status: CharacterStatus.Untapped,
        items: [iid('sting-1')], allies: [], corruptionCards: [], followers: [],
        controlledBy: 'general',
      },
    };

    const company: Company = {
      id: cid('c1'),
      characters: [iid('bilbo-1')],
      currentSite: iid('rivendell-1'),
      destinationSite: null,
      movementPath: [],
      moved: false,
    };

    const state: GameState = {
      players: [
        makeMinimalPlayer('p1', WizardName.Gandalf, [company], characters),
        makeMinimalPlayer('p2', WizardName.Saruman, [], {}),
      ],
      activePlayer: pid('p1'),
      phaseState: { phase: Phase.Organization },
      eventsInPlay: [],
      cardPool: pool,
      instanceMap: instances,
      turnNumber: 1,
      pendingEffects: [],
      rng: { seed: 42, counter: 0 },
    };

    const output = formatGameState(state);
    const plain = stripAnsi(output);

    console.log(output);

    expect(plain).toContain('Bilbo [1/9] scout/sage (2 MP)');
    expect(plain).toContain('Sting [+1/+0] minor (0 MP, 1 CP)');
    expect(plain).toContain('Company 1 @ Rivendell:');
    expect(plain).toContain('Turn 1');
    expect(plain).toContain('Phase: organization');
  });
});
