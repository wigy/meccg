/**
 * @module ba-33.test
 *
 * Card test: To Fealty Sworn (ba-33)
 * Type: hero-resource-event (permanent), 1 misc MP
 * Effects:
 *   - play-target (character: race hobbit)
 *   - play-condition (company-context): playable when the Hobbit's company
 *       either contains "Return of the King" (attached to a company-mate) OR
 *       has, this site phase, played a unique hero faction at a Free-hold
 *       (not Bag End) — tracked via SitePhaseState.uniqueHeroFactionPlayedAtFreeHold
 *   - grant-skill: warrior
 *   - stat-modifier: +2 prowess
 *   - stat-modifier: +5 direct-influence when influencing a character whose
 *       home site is Bag End (reason influence-check)
 *   - stat-modifier: +5 direct-influence when influencing the Hobbits faction
 *       (reason faction-influence-check)
 *   - duplication-limit (character, max 1)
 *
 * "Playable on a Hobbit: in the same company as Return of the King or during
 *  the same site phase his company plays a unique hero faction at a Free-hold
 *  [{F}] (not Bag End). The Hobbit gains the warrior skill, +2 prowess, and +5
 *  direct influence against the Hobbits faction and characters with Bag End as
 *  a home site. Cannot be duplicated on a given Hobbit."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildSitePhaseState, buildTestState, makePlayDeck,
  resetMint, viableActions, attachItemToChar, findCharInstanceId,
  getCharacter, pool,
} from '../test-helpers.js';
import {
  FRODO, SAM_GAMGEE, ARAGORN, LEGOLAS,
  MINAS_TIRITH, BAG_END, MORIA, LORIEN,
} from '../../card-ids.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlayPermanentEventAction, CharacterCard,
} from '../../index.js';
import { Phase } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { getItemGrantedSkills } from '../../engine/effects/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { resolveInfluenceAttemptRoll } from '../../engine/reducer-site.js';

const TO_FEALTY_SWORN = 'ba-33' as CardDefinitionId;
const RETURN_OF_THE_KING = 'tw-316' as CardDefinitionId; // permanent event, kept with Aragorn II
const HOBBITS = 'tw-258' as CardDefinitionId;            // unique hero faction, race hobbit, influence# 9

/** Force the active company's site-phase "played a unique hero faction at a Free-hold" window open. */
function openFreeHoldFactionWindow(state: GameState): GameState {
  const siteState = state.phaseState as SitePhaseState;
  return { ...state, phaseState: { ...siteState, uniqueHeroFactionPlayedAtFreeHold: true } };
}

describe('To Fealty Sworn (ba-33)', () => {
  beforeEach(() => resetMint());

  // ── play-target: only a Hobbit is a valid bearer ──

  test('NOT playable on a non-Hobbit even when the site-phase faction window is open', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN], hand: [TO_FEALTY_SWORN] });
    const state = openFreeHoldFactionWindow(base);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── play-condition (company-context): neither alternative met ──

  test('NOT playable on a Hobbit when neither alternative is satisfied', () => {
    // Frodo at a Free-hold, but no Return of the King in the company and the
    // faction window has not been opened this site phase.
    const state = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [TO_FEALTY_SWORN] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── play-condition alternative (b): unique hero faction at Free-hold this site phase ──

  test('playable on a Hobbit once the company has played a unique hero faction at a Free-hold this site phase', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [TO_FEALTY_SWORN] });
    const state = openFreeHoldFactionWindow(base);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(frodoId);
  });

  // ── play-condition alternative (a): same company as Return of the King (organization phase) ──

  test('playable on a Hobbit sharing a company with Return of the King (organization phase)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FRODO, ARAGORN] }],
          hand: [TO_FEALTY_SWORN],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Attach Return of the King to Aragorn II, so it is "in the company".
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RETURN_OF_THE_KING));

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const onFrodo = actions.filter(a => (a.action as PlayPermanentEventAction).targetCharacterId === frodoId);
    expect(onFrodo.length).toBe(1);
  });

  test('NOT playable when Return of the King is in a DIFFERENT company (organization phase)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [FRODO] },
            { site: MINAS_TIRITH, characters: [ARAGORN] },
          ],
          hand: [TO_FEALTY_SWORN],
          siteDeck: [BAG_END],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RETURN_OF_THE_KING));
    // Return of the King is in Aragorn's company, not Frodo's — no valid target.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── SitePhaseState flag is set when a unique hero faction resolves at a Free-hold ──

  test('playing the Hobbits faction at a Free-hold (Bag End is excluded) — flag only opens at a non-Bag-End Free-hold', () => {
    // Bag End: unique hero faction played here must NOT open the window.
    const atBagEnd = buildSitePhaseState({ site: BAG_END, characters: [FRODO], hand: [HOBBITS] });
    const bagEndCard = atBagEnd.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
    const afterBagEnd = resolveInfluenceAttemptRoll(
      { ...atBagEnd, cheatRollTotal: 12 },
      { card: bagEndCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: findCharInstanceId(atBagEnd, RESOURCE_PLAYER, FRODO) } },
    );
    expect((afterBagEnd.state.phaseState as SitePhaseState).uniqueHeroFactionPlayedAtFreeHold).toBeFalsy();

    // Minas Tirith (a Free-hold that is not Bag End): the window opens.
    const atMT = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [HOBBITS] });
    const mtCard = atMT.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
    const afterMT = resolveInfluenceAttemptRoll(
      { ...atMT, cheatRollTotal: 12 },
      { card: mtCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: findCharInstanceId(atMT, RESOURCE_PLAYER, FRODO) } },
    );
    expect((afterMT.state.phaseState as SitePhaseState).uniqueHeroFactionPlayedAtFreeHold).toBe(true);
  });

  // ── stat-modifier: +2 prowess while attached ──

  test('grants +2 prowess to the bearer', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, TO_FEALTY_SWORN));
    const frodoBase = (pool[FRODO as string] as CharacterCard).prowess;
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(frodoBase + 2);
  });

  // ── grant-skill: warrior ──

  test('grants the warrior skill to the bearer', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, TO_FEALTY_SWORN));
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const frodoChar = state.players[RESOURCE_PLAYER].characters[frodoId];
    expect(getItemGrantedSkills(state, frodoChar)).toContain('warrior');
    // Frodo does not have warrior naturally.
    expect((pool[FRODO as string] as CharacterCard).skills).not.toContain('warrior');
  });

  // ── stat-modifier: +5 DI against characters with Bag End as a home site ──

  test('+5 direct influence when influencing a character whose home site is Bag End (conditional, does not inflate base DI)', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, TO_FEALTY_SWORN));
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const player = state.players[RESOURCE_PLAYER];
    const frodoBaseDI = (pool[FRODO as string] as CharacterCard).directInfluence;

    // Base effective DI is unchanged by the conditional modifier.
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.directInfluence).toBe(frodoBaseDI);

    // Sam Gamgee's home site is Bag End → +5 applies.
    const samDef = pool[SAM_GAMGEE as string] as CharacterCard;
    expect(availableDI(state, frodoId, player, samDef)).toBe(frodoBaseDI + 5);

    // Legolas' home site is not Bag End → no bonus.
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;
    expect(availableDI(state, frodoId, player, legolasDef)).toBe(frodoBaseDI);
  });

  // ── stat-modifier: +5 DI against the Hobbits faction ──

  test('+5 direct influence against the Hobbits faction (influence attempt succeeds only with the bonus)', () => {
    // Hobbits faction: influence# 9. Frodo base DI = 1. With a 2d6 total of 3:
    //   without bonus: 3 + 1 = 4 < 9 → fail (faction discarded);
    //   with +5 bonus: 3 + 1 + 5 = 9 ≥ 9 → success (faction enters play).
    const buildAttempt = (attach: boolean): GameState => {
      const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [HOBBITS] });
      const state = attach
        ? recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, TO_FEALTY_SWORN))
        : base;
      const hobbitsCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
      const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
      // Remove the faction from hand (the reducer moves it out of the influence flow).
      const handWithout = state.players[RESOURCE_PLAYER].hand.filter(c => c.instanceId !== hobbitsCard.instanceId);
      const prepared: GameState = {
        ...state,
        cheatRollTotal: 3,
        players: [
          { ...state.players[RESOURCE_PLAYER], hand: handWithout },
          state.players[1],
        ] as unknown as typeof state.players,
      };
      return resolveInfluenceAttemptRoll(prepared, {
        card: hobbitsCard,
        declaredBy: PLAYER_1,
        payload: { type: 'influence-attempt', influencingCharacterId: frodoId },
      }).state;
    };

    // Without the card: the attempt fails and the faction is discarded.
    const withoutState = buildAttempt(false);
    expect(withoutState.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HOBBITS)).toBe(true);
    expect(withoutState.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOBBITS)).toBe(false);

    // With the card: the +5 bonus carries the attempt to success — the faction enters play.
    const withState = buildAttempt(true);
    expect(withState.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOBBITS)).toBe(true);
    expect(withState.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HOBBITS)).toBe(false);
  });

  // ── duplication-limit (character): cannot attach a second copy to the same Hobbit ──

  test('cannot be duplicated on a given Hobbit, but may be played on another eligible Hobbit', () => {
    const base = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [FRODO, SAM_GAMGEE],
      hand: [TO_FEALTY_SWORN],
    });
    // Frodo already bears one copy; open the faction window so the play-condition is met.
    const withFirst = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, TO_FEALTY_SWORN));
    const state = openFreeHoldFactionWindow(withFirst);

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const samId = findCharInstanceId(state, RESOURCE_PLAYER, SAM_GAMGEE);

    // No action targets Frodo (already has a copy — duplication-limit).
    expect(actions.some(a => (a.action as PlayPermanentEventAction).targetCharacterId === frodoId)).toBe(false);
    // Sam Gamgee (also a Hobbit, no copy) is still an eligible target.
    expect(actions.some(a => (a.action as PlayPermanentEventAction).targetCharacterId === samId)).toBe(true);
  });
});
