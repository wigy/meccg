/**
 * @module as-8.test
 *
 * Card test: Durin's Folk (as-8)
 * Type: hazard-creature (Dwarves)
 * Effects: 2 (combat-detainment vs hero, -2 prowess vs hero)
 *
 * Text:
 *   "Dwarves. Five strikes. Detainment and -2 prowess against hero companies.
 *    May also be played keyed to The Shire."
 *
 * Base stats: strikes 5, prowess 8, no body, kill MP 2*.
 * Canonical playable cost (data/cards.json): {w}{b} — keyable to a wilderness
 * OR a border-land (different region symbols are alternatives).
 *
 * Effects:
 * | # | Effect Type       | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | combat-detainment | OK     | Hero defenders (+covert fallen-wizard) take detainment   |
 * | 2 | stat-modifier     | OK     | -2 prowess when defender.alignment === "hero" (→ 6)      |
 *
 * keyedTo:
 * | # | Entry                       | Notes                                    |
 * |---|-----------------------------|------------------------------------------|
 * | 1 | wilderness / border ({w}{b})| base keying — either type is an alternative |
 * | 2 | region-name "The Shire"     | "May also be played keyed to The Shire." |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState, makeBorderMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const DURINS_FOLK = 'as-8' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;
const AZOG = 'ba-2' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

/**
 * Builds an M/H state ready to play Durin's Folk (in P2's hand) against P1's
 * single company, with the given P1 alignment/character and travel path.
 */
function readyState(
  alignment: Alignment,
  characterId: CardDefinitionId,
  phaseState = makeWildernessMHState(),
): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site: MORIA, characters: [characterId] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [DURINS_FOLK],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...state, phaseState };
}

describe("Durin's Folk (as-8)", () => {
  beforeEach(() => resetMint());

  // ─── Combat: detainment + -2 prowess depend on defender alignment ─────────

  test('attack on hero (Wizard) company: detainment, prowess reduced to 6', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(6); // 8 - 2 vs hero
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('attack on minion (Ringwraith) company: no reduction (prowess 8), no detainment', () => {
    // Wilderness keying keeps the creature clear of the §3.II.2.R1 minion
    // detainment branches (dark-domain / shadow-hold / shadow-land), so the
    // card's own hero-only detainment is the sole source — and it does not fire.
    const ready = readyState(Alignment.Ringwraith, MIONID);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('attack on Balrog company: no reduction (prowess 8), no detainment', () => {
    const ready = readyState(Alignment.Balrog, AZOG);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  // ─── Keying: {w}{b} base (wilderness OR border) + The Shire by name ───────

  test('keyable to a wilderness ({w} arm of {w}{b})', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN, makeWildernessMHState());

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('keyable to a border-land ({b} arm of {w}{b})', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN, makeBorderMHState());

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Border;
    })).toBe(true);
  });

  test('keyable to The Shire by region name (alternative keying)', () => {
    // A pure free-domain path named "The Shire" — the {w}{b} base entry cannot
    // match (no wilderness/border in the path), isolating the region-name arm.
    const shirePath = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bag End',
    });
    const ready = readyState(Alignment.Wizard, ARAGORN, shirePath);

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    // The Shire keying is available…
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'The Shire';
    })).toBe(true);
    // …and the wilderness/border base keying is NOT (no such region in path).
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type'
        && (a.keyedBy?.value === RegionType.Wilderness || a.keyedBy?.value === RegionType.Border);
    })).toBe(false);
  });
});
