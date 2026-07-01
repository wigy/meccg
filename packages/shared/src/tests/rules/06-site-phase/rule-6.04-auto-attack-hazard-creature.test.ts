/**
 * @module rule-6.04-auto-attack-hazard-creature
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.04: Automatic-Attack from Hazard Creature
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an automatic-attack depends on a hazard creature being played as the automatic-attack, the creature card must be played immediately before that attack would be initiated but doing so does not count as playing a creature nor does it count as a creature attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch,
  makeSitePhase, viableActions, findCharInstanceId, findHandCardId,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';

// Framsburg (td-175): "opponent may play one creature from his hand that is
// treated in all ways as the site's automatic-attack" — keyed to Ruins &
// Lairs/Shadow-hold or a Wilderness/Shadow region. No printed automaticAttacks.
const FRAMSBURG = 'td-175' as CardDefinitionId;
// Crebain (tw-25): non-unique, keyed to Ruins & Lairs — 1 strike, 5 prowess.
const CREBAIN = 'tw-25' as CardDefinitionId;

function buildFramsburgState() {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: FRAMSBURG, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CREBAIN], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...built, phaseState: makeSitePhase({ step: 'play-site-auto-attack', siteEntered: false }) };
}

describe('Rule 6.04 — Automatic-Attack from Hazard Creature', () => {
  beforeEach(() => resetMint());

  test('hazard player may play a keyed creature from hand as the site auto-attack', () => {
    const state = buildFramsburgState();
    const crebainCardId = findHandCardId(state, 1, CREBAIN);

    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(playActions).toHaveLength(1);
    expect((playActions[0].action as { cardInstanceId: unknown }).cardInstanceId).toBe(crebainCardId);

    const afterPlay = dispatch(state, playActions[0].action);

    // Treated "in all ways as the site's automatic-attack" — a distinct
    // attackSource from a normal M/H-phase creature play.
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.attackSource.type).toBe('played-auto-attack');
    expect(afterPlay.combat!.strikesTotal).toBe(1);
    expect(afterPlay.combat!.strikeProwess).toBe(5);

    // Moved from hand straight into play — not routed through the normal
    // hazard-creature-play action/hazard-limit machinery.
    expect(afterPlay.players[1].hand.some(c => c.instanceId === crebainCardId)).toBe(false);
    expect(afterPlay.players[1].cardsInPlay.some(c => c.instanceId === crebainCardId)).toBe(true);
  });

  test('defeating the played creature discards it — no kill-MP, unlike a real creature attack', () => {
    const state = buildFramsburgState();
    const crebainCardId = findHandCardId(state, 1, CREBAIN);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_2, 'play-site-auto-attack')[0].action);

    const aragornId = findCharInstanceId(afterPlay, 0, ARAGORN);
    let s = dispatch(afterPlay, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const selected = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight)?.action
      ?? resolveActions[0].action;
    s = dispatch({ ...s, cheatRollTotal: 12 }, selected);

    // Combat resolved and finalized.
    expect(s.combat).toBeNull();
    // Discarded to the hazard player, not moved to the resource player's kill
    // pile — no kill-MP is awarded, mirroring a standard automatic-attack.
    expect(s.players[1].discardPile.some(c => c.instanceId === crebainCardId)).toBe(true);
    expect(s.players[0].killPile.some(c => c.instanceId === crebainCardId)).toBe(false);
  });

  test('unique creatures are not eligible as a site\'s dynamic auto-attack', () => {
    // "Bert" (Bûrat) (tw-016) is unique and keyed to shadow-hold/wilderness —
    // it would otherwise satisfy Framsburg's keying filter, but
    // playSiteAutoAttackActions excludes unique creatures outright.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: FRAMSBURG, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: ['tw-016' as CardDefinitionId], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...built, phaseState: makeSitePhase({ step: 'play-site-auto-attack', siteEntered: false }) };

    expect(viableActions(state, PLAYER_2, 'play-site-auto-attack')).toHaveLength(0);
    expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(1);
  });
});
