/**
 * @module ba-56.test
 *
 * Card test: Descent through Fire (ba-56)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase if The Balrog is at an
 *    untapped The Under-galleries or The Under-courts. Tap the site. The
 *    Balrog's company faces 3 attacks (Trolls – 5 strikes with 8 prowess, 4
 *    strikes with 10 prowess, 3 strikes with 12 prowess). Following the
 *    attacks, tap The Balrog or discard this card. If not discarded, place this
 *    card in your marshalling point pile. All your characters receive +1
 *    prowess and all your leaders receive +1 direct influence. Cannot be
 *    duplicated at a given site."
 *
 * Effects:
 *   1. play-target site  { name in [The Under-galleries, The Under-courts] }  — site.ts filter
 *   2. play-flag untapped-site-required                                       — site.ts
 *   3. play-flag tap-site-on-play                                             — chain-reducer.ts
 *   4. play-target character { target.name: "The Balrog" }                    — restricts bearer
 *   5. duplication-limit (site, max 1)                                        — site.ts
 *   6. trigger-attack-on-play (3× Trolls, move-to-mp-pile)                    — chain/combat-finalize
 *   7. stat-modifier prowess +1, own-characters                              — collectGlobalEffects
 *   8. stat-modifier direct-influence +1, own-characters (leaders only)      — collectGlobalEffects
 *
 * The +1 prowess / +1 DI buffs must NOT apply while the self-inflicted attacks
 * are resolving (the card is `pendingTriggerAttack` in cardsInPlay); they only
 * take hold once the card is kept in the marshalling-point pile.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  CardStatus,
  Phase,
  buildMinionSitePhaseState,
  resetMint, mint,
  viableActions,
  playPermanentEventAndResolve, runCardTriggeredAttackCombat,
  dispatch, getCharacter, companyIdAt, findCharInstanceId,
  attachItemToChar,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayPermanentEventAction, SelectCardBearerAction,
  PendingResolution, ResolutionId,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const DESCENT = 'ba-56' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;        // balrog avatar, prowess 8, DI 6
const LIEUTENANT = 'le-21' as CardDefinitionId;       // Lieutenant of Dol Guldur — troll LEADER, prowess 7, DI 3

const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;  // dark-hold, under-deeps — a named target site
const UNDER_COURTS = 'ba-98' as CardDefinitionId;     // dark-hold, under-deeps — a named target site
const UNDER_LEAS = 'ba-102' as CardDefinitionId;      // shadow-hold, under-deeps — NOT a named target site

/**
 * Build a select-card-bearer pending resolution for a kept Descent through Fire,
 * with the card sitting in cardsInPlay still flagged `pendingTriggerAttack`
 * (as it is mid-flow, right after its attacks). Both company members untapped.
 */
function seedBearerSelection(site: CardDefinitionId): {
  state: GameState;
  cardInstanceId: CardInstanceId;
} {
  const base = buildMinionSitePhaseState({
    site,
    characters: [THE_BALROG, LIEUTENANT],
    hand: [],
  });
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const cardInstanceId = mint();
  const withCard: GameState = {
    ...base,
    players: [
      {
        ...base.players[RESOURCE_PLAYER],
        cardsInPlay: [
          ...base.players[RESOURCE_PLAYER].cardsInPlay,
          { instanceId: cardInstanceId, definitionId: DESCENT, status: CardStatus.Untapped, pendingTriggerAttack: true },
        ],
      },
      base.players[1],
    ] as typeof base.players,
    pendingResolutions: [
      {
        id: 'descent-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId,
          mode: 'move-to-mp-pile',
        },
      } satisfies PendingResolution,
    ],
  };
  return { state: recomputeDerived(withCard), cardInstanceId };
}

describe('Descent through Fire (ba-56)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2/4: playability keying ──

  test('playable at an untapped The Under-galleries with The Balrog present', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    // Bearer chosen post-attack → no targetCharacterId embedded at play time
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
  });

  test('playable at an untapped The Under-courts with The Balrog present', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_COURTS, characters: [THE_BALROG], hand: [DESCENT] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable at a TAPPED The Under-galleries', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a non-named Under-deeps site (The Under-leas)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_LEAS, characters: [THE_BALROG], hand: [DESCENT] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when The Balrog is not in the company at the site', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [LIEUTENANT], hand: [DESCENT] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 5: duplication-limit (scope "site", max 1) ──

  test('NOT playable when a copy is already present at the same site', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const withCopy = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, DESCENT);
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3: tap-site-on-play ──

  test('playing Descent through Fire taps the site', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  // ── Effect 6: three sequential Troll attacks ──

  test('first attack is Trolls, 5 strikes @ 8 prowess', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(5);
    expect(afterPlay.combat!.strikeProwess).toBe(8);
    expect(afterPlay.combat!.creatureRace).toBe('troll');
  });

  test('second attack (4 strikes @ 10) then third attack (3 strikes @ 12) chain in order', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    // The Balrog faces one strike of attack 1 (survives on a high roll); the rest
    // are unassignable (no other untapped character), so attack 1 resolves.
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: THE_BALROG, roll: 6 }]);
    expect(afterAttack1.combat).not.toBeNull();
    expect(afterAttack1.combat!.strikesTotal).toBe(4);
    expect(afterAttack1.combat!.strikeProwess).toBe(10);

    const afterAttack2 = runCardTriggeredAttackCombat(afterAttack1, []);
    expect(afterAttack2.combat).not.toBeNull();
    expect(afterAttack2.combat!.strikesTotal).toBe(3);
    expect(afterAttack2.combat!.strikeProwess).toBe(12);
  });

  test('card is discarded when The Balrog is tapped after the attacks (cannot pay the keep cost)', () => {
    // A lone Balrog company: The Balrog taps facing the first strike, so no
    // untapped Balrog remains after the attacks → the card is discarded.
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    let s = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: THE_BALROG, roll: 6 }]); // attack 1 → attack 2
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 2 → attack 3
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 3 → done
    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DESCENT)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === DESCENT)).toBe(false);
  });

  // ── Effect 7: buffs are suppressed while the attacks resolve ──

  test('the +1 prowess buff does NOT apply while the attacks are resolving', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG], hand: [DESCENT] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    // Card is in cardsInPlay (pendingTriggerAttack) but its ongoing buff is suppressed.
    expect(afterPlay.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === DESCENT)).toBe(true);
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(8);
  });

  // ── Effect 4/6: after the attacks only The Balrog may be tapped to keep the card ──

  test('select-card-bearer offers ONLY The Balrog, never a company follower', () => {
    const { state } = seedBearerSelection(UNDER_GALLERIES);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);

    const bearerActions = viableActions(state, PLAYER_1, 'select-card-bearer');
    const offered = bearerActions.map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).not.toContain(lieutenantId);
    // A pass (discard the card) is always available.
    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  // ── Effect 6/7/8: keeping the card taps The Balrog, keeps it in play, and activates the buffs ──

  test('tapping The Balrog keeps the card in play (no attach, no untap-lock) and activates the buffs', () => {
    const { state } = seedBearerSelection(UNDER_GALLERIES);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const bearerAction = viableActions(state, PLAYER_1, 'select-card-bearer')[0].action as SelectCardBearerAction;
    expect(bearerAction.characterId).toBe(balrogId);

    const afterKeep = dispatch(state, bearerAction);

    // The Balrog is tapped; card stays in cardsInPlay (not attached to items).
    const balrog = afterKeep.players[RESOURCE_PLAYER].characters[balrogId];
    expect(balrog.status).toBe(CardStatus.Tapped);
    expect(balrog.items.some(i => i.definitionId === DESCENT)).toBe(false);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === DESCENT);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    // move-to-mp-pile mode adds no bearer-cannot-untap constraint.
    expect(afterKeep.activeConstraints.some(c => c.kind.type === 'bearer-cannot-untap')).toBe(false);

    // Buffs now apply: +1 prowess to every one of your characters.
    const recomputed = recomputeDerived(afterKeep);
    expect(getCharacter(recomputed, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(9); // 8 + 1
    expect(getCharacter(recomputed, RESOURCE_PLAYER, LIEUTENANT).effectiveStats.prowess).toBe(8); // 7 + 1

    // The kept card is worth its printed 3 miscellaneous marshalling points.
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  // ── Effect 8: +1 direct influence to leaders only ──

  test('+1 direct influence applies to your leaders but not to non-leaders', () => {
    const base = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG, LIEUTENANT], hand: [] });
    const withCard: GameState = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          cardsInPlay: [
            ...base.players[RESOURCE_PLAYER].cardsInPlay,
            { instanceId: mint(), definitionId: DESCENT, status: CardStatus.Untapped },
          ],
        },
        base.players[1],
      ] as typeof base.players,
    };
    const state = recomputeDerived(withCard);
    // Lieutenant of Dol Guldur is a leader → 3 + 1 = 4.
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT).effectiveStats.directInfluence).toBe(4);
    // The Balrog is not a leader → base DI unchanged.
    expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.directInfluence).toBe(6);
  });

  // ── Effect 7/8: no buff when the card is not in play (was discarded, not kept) ──

  test('no buff when Descent through Fire is not in play', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [THE_BALROG, LIEUTENANT], hand: [] });
    expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(8);
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT).effectiveStats.directInfluence).toBe(3);
  });
});
