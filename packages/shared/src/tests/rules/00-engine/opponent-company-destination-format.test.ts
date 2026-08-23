/**
 * @module opponent-company-destination-format.test
 *
 * Regression test for `formatPlayerView`: an opponent company's movement
 * destination stays hidden as `(planned)` until the reveal-new-site step makes
 * it public, at which point the projection fills in `revealedDestinationSite`
 * and every other opponent-facing renderer (map, combat, sim) shows the site by
 * name. The console renderer alone kept printing the literal `(planned)`,
 * hiding a value the viewer is entitled to see.
 *
 * The rules/card tests only reach `formatGameState` (the omniscient renderer),
 * which renders own companies through `destinationSite` and never builds
 * `opponentCompanies`, so this redact-then-reveal path is otherwise uncovered.
 */

import { describe, test, expect } from 'vitest';
import {
  Alignment, CardStatus, Phase, formatPlayerView, loadCardPool,
} from '../../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, PlayerId, PlayerView, SiteInPlay,
} from '../../../index.js';

const MORIA = 'tw-413' as CardDefinitionId; // hero site, the company's current location
const BREE = 'tw-378' as CardDefinitionId; // hero site, the revealed destination

const ZERO_MP = { character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0 };
const site = (instanceId: string, definitionId: CardDefinitionId): SiteInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped });

/** A minimal PlayerView with one opponent company, its destination revealed. */
const viewWithOpponentCompany = (revealed: boolean): PlayerView => {
  const emptySelf = {
    id: 'p1' as PlayerId, name: 'Alice', alignment: Alignment.Wizard, wizard: null,
    hand: [], playDeck: [], discardPile: [], siteDeck: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], companies: [], agents: [],
    characters: {}, cardsInPlay: [], marshallingPoints: ZERO_MP,
    callableMarshallingPoints: ZERO_MP, generalInfluenceUsed: 0, generalInfluence: 20,
    stagePoints: 0, deckExhaustionCount: 0, lastDiceRoll: null,
  };
  const opponent = {
    id: 'p2' as PlayerId, name: 'Bob', alignment: Alignment.Wizard, wizard: null,
    hand: [], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    killPile: [], outOfPlayPile: [], sideboard: [], agents: [], characters: {},
    cardsInPlay: [], marshallingPoints: ZERO_MP, callableMarshallingPoints: ZERO_MP,
    generalInfluenceUsed: 0, generalInfluence: 20, stagePoints: 0,
    deckExhaustionCount: 0, lastDiceRoll: null,
    companies: [{
      id: 'company-p2-0' as CompanyId,
      characters: [],
      currentSite: site('site-moria', MORIA),
      siteCardOwned: true,
      hasPlannedMovement: true,
      revealedDestinationSite: revealed ? site('site-bree', BREE) : null,
      moved: false,
      onGuardCards: [],
    }],
  };
  return {
    self: emptySelf, opponent,
    activePlayer: 'p2' as PlayerId, phaseState: { phase: Phase.Untap },
    combat: null, chain: null, pendingEffects: [], turnNumber: 5, selfIndex: 0,
    startingPlayer: 'p1' as PlayerId, gameId: 'g1', stateSeq: 10,
    legalActions: [], activeConstraints: [],
  } as unknown as PlayerView;
};

describe('formatPlayerView opponent company destination', () => {
  const cardPool = loadCardPool();

  test('shows the revealed destination site by name, not "(planned)"', () => {
    const text = formatPlayerView(viewWithOpponentCompany(true), cardPool);
    expect(text).toContain('Bree'); // the revealed destination
    expect(text).not.toContain('(planned)');
  });

  test('still hides an unrevealed planned destination as "(planned)"', () => {
    const text = formatPlayerView(viewWithOpponentCompany(false), cardPool);
    expect(text).toContain('(planned)');
    expect(text).not.toContain('Bree');
  });
});
