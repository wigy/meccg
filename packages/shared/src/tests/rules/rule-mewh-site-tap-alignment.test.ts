/**
 * MEWH §10 — Site-tap alignment match.
 *
 * Source: The White Hand Insert, "Playing Resources at a Site": "In order to
 * play a non-Fallen-wizard resource that would normally tap a site, either the
 * site and the resource to be played must both be hero cards or they must both
 * be minion cards. For these purposes, a Fallen-wizard site card (or any
 * Wizardhaven) is both a hero and minion site. This applies to all factions,
 * allies, and items."
 *
 * A Fallen-wizard at a hero site may play a hero item but not a minion item; at
 * a minion site, the reverse. The "Wizardhaven counts as both" exemption is in
 * the guard (it returns false for fallen-wizard sites) but the four
 * Fallen-wizard sites list no playable resources, so it has no item-play
 * consumer to exercise; a Wizard-player regression case confirms the guard is
 * Fallen-wizard-gated. Tested via the site-phase `play-hero-resource` actions.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { ActiveConstraint, CardDefinitionId, CardInstanceId, ConstraintId, GameState } from '../../index.js';
import {
  buildTestState, resetMint, makeSitePhase, viableActions,
  PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH, ARAGORN,
  Phase,
} from '../test-helpers.js';

const HERO_RL = 'dm-31' as CardDefinitionId;        // Haudh-in-Gwanûr — hero R&L (minor playable)
const MINION_RL = 'le-351' as CardDefinitionId;     // Bandit Lair — minion R&L (minor playable)
const HERO_ITEM = 'tw-206' as CardDefinitionId;     // Dagger of Westernesse — hero minor item
const MINION_ITEM = 'le-345' as CardDefinitionId;   // Strange Rations — minion minor item
// Palantír of Minas Tirith — a minion item whose own item-play-site restriction
// names the (printed-hero) site "Minas Tirith" by name, regardless of subtype.
const PALANTIR_MINAS_TIRITH = 'le-333' as CardDefinitionId;
// Chambers in the Royal Court — the Stage resource whose `wizardhaven-conversion`
// flag the test injects directly (mirrors wh-25.test.ts), rather than actually
// playing it through the organization phase.
const CHAMBERS = 'wh-97' as CardDefinitionId;

/** Company at `site` with `hand`, in the play-resources site step, for `alignment`. */
function companyAt(alignment: Alignment, site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment, companies: [{ site, characters: [ARAGORN] }], hand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

/** Fallen-wizard company at `site`. */
function fwAt(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  return companyAt(Alignment.FallenWizard, site, hand);
}

function playCount(state: GameState, defId: CardDefinitionId): number {
  return viableActions(state, PLAYER_1, 'play-hero-resource')
    .filter(a => {
      const inst = (a.action as { cardInstanceId?: string }).cardInstanceId;
      const card = state.players[0].hand.find(c => (c.instanceId as string) === inst);
      return card?.definitionId === defId;
    }).length;
}

describe('MEWH §10 — Site-tap alignment match', () => {
  beforeEach(() => resetMint());

  test('at a hero site, a Fallen-wizard may play a hero item but not a minion item', () => {
    expect(playCount(fwAt(HERO_RL, [HERO_ITEM]), HERO_ITEM)).toBe(1);
    expect(playCount(fwAt(HERO_RL, [MINION_ITEM]), MINION_ITEM)).toBe(0);
  });

  test('at a minion site, a Fallen-wizard may play a minion item but not a hero item', () => {
    expect(playCount(fwAt(MINION_RL, [MINION_ITEM]), MINION_ITEM)).toBe(1);
    expect(playCount(fwAt(MINION_RL, [HERO_ITEM]), HERO_ITEM)).toBe(0);
  });

  test('a Wizard player is not subject to the guard (hero item at a hero site still offered)', () => {
    expect(playCount(companyAt(Alignment.Wizard, HERO_RL, [HERO_ITEM]), HERO_ITEM)).toBe(1);
  });

  // A site converted into a Wizardhaven (e.g. by Chambers in the Royal Court,
  // wh-97) counts as both a hero and minion site "for these purposes", exactly
  // like a printed Fallen-wizard site — not just a printed `fallen-wizard`
  // alignment card. Bug report: a Fallen-wizard could not play Palantír of
  // Minas Tirith (a minion item, own item-play-site restriction naming
  // "Minas Tirith" by name) at the hero Minas Tirith after Chambers converted
  // it to a Wizardhaven.
  test('at a hero site converted to a Wizardhaven, a minion item naming the site by name is offered', () => {
    const barred = fwAt(MINAS_TIRITH, [PALANTIR_MINAS_TIRITH]);
    expect(playCount(barred, PALANTIR_MINAS_TIRITH)).toBe(0);

    const conversion: ActiveConstraint = {
      id: 'c-mewh10-conversion' as ConstraintId,
      source: 'p1-chambers' as CardInstanceId,
      sourceDefinitionId: CHAMBERS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'site-flag', flag: 'wizardhaven-conversion', siteDefinitionId: MINAS_TIRITH },
    };
    const converted = { ...barred, activeConstraints: [conversion] };
    expect(playCount(converted, PALANTIR_MINAS_TIRITH)).toBe(1);
  });
});
