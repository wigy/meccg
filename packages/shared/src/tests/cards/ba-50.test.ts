/**
 * @module ba-50.test
 *
 * Card test: Breach the Hold (ba-50)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on The Drowning-deeps or
 *    The Rusted-deeps if The Balrog is there. The Balrog's company faces 3
 *    attacks (Spawn — 1 strike with 15 prowess, Dwarves — 4 strikes with 9
 *    prowess, 2 strikes with 12 prowess). Following the attacks, tap The Balrog
 *    or discard this card. The roll required to move to the surface site is
 *    reduced to zero. This site is never discarded or returned to its location
 *    deck. Cannot be duplicated on a given site."
 *
 * Effects:
 *   1. play-target site  { name in [The Drowning-deeps, The Rusted-deeps] }  — site.ts filter
 *   2. play-target character { target.name: "The Balrog" }                   — playability gate + keep target
 *   3. duplication-limit (site, max 1)                                       — site.ts
 *   4. trigger-attack-on-play (Spawn 1@15, Dwarves 4@9, Dwarves 2@12,        — chain/combat-finalize
 *      move-to-mp-pile)
 *   5. surface-site-roll-zero                                                — permanence + surface-ascent roll 0
 *
 * Unlike Descent through Fire (ba-56), the card carries NO untapped-site-required
 * / tap-site-on-play flags: it is playable at a tapped site and does not tap the
 * site. When kept (The Balrog tapped), the card stays in `cardsInPlay` bound to
 * the Under-deeps site, the ascent roll to the surface site drops to 0, and the
 * site is never swept away while unoccupied.
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
  addP1CardsInPlay,
  resetMint, mint,
  viableActions,
  playPermanentEventAndResolve, runCardTriggeredAttackCombat,
  dispatch, companyIdAt, findCharInstanceId,
  attachItemToChar,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, SiteCard,
  PlayPermanentEventAction, SelectCardBearerAction,
  PendingResolution, ResolutionId,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { getUnderDeepsRequiredRoll } from '../../engine/mh-steps.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const BREACH = 'ba-50' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;        // balrog avatar, prowess 8, DI 6
const LIEUTENANT = 'le-21' as CardDefinitionId;       // Lieutenant of Dol Guldur — troll leader

const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;   // ruins-and-lairs, under-deeps — a named target site
const RUSTED_DEEPS = 'ba-96' as CardDefinitionId;     // ruins-and-lairs, under-deeps — a named target site
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;    // under-deeps, adjacent to Drowning-deeps — NOT a target
const BLUE_MTN = 'le-355' as CardDefinitionId;        // Blue Mountain Dwarf-hold — Drowning-deeps' surface site

describe('Breach the Hold (ba-50)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2: playability keying ──

  test('playable at The Drowning-deeps with The Balrog present (bearer chosen post-attack)', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCharacterId).toBeUndefined();
    // The card binds to the Under-deeps site it is played on.
    expect(action.targetSiteDefinitionId).toBe(DROWNING_DEEPS);
  });

  test('playable at The Rusted-deeps with The Balrog present', () => {
    const state = buildMinionSitePhaseState({ site: RUSTED_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('playable even at a TAPPED site (no untapped-site requirement)', () => {
    const state = buildMinionSitePhaseState({
      site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable at a different Under-deeps site (The Under-vaults)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_VAULTS, characters: [THE_BALROG], hand: [BREACH] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when The Balrog is not in the company at the site', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [LIEUTENANT], hand: [BREACH] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3: duplication-limit (scope "site", max 1) ──

  test('NOT playable when a copy is already present at the same site', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const withCopy = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, BREACH);
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── No tap-site-on-play flag: playing does not tap the site ──

  test('playing Breach the Hold does NOT tap the site', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(
      state, PLAYER_1, action.cardInstanceId, undefined,
      { targetSiteDefinitionId: action.targetSiteDefinitionId },
    );
    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  // ── Effect 4: three sequential attacks with mixed creature races ──

  test('first attack is Spawn, 1 strike @ 15 prowess', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(
      state, PLAYER_1, action.cardInstanceId, undefined,
      { targetSiteDefinitionId: action.targetSiteDefinitionId },
    );
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(1);
    expect(afterPlay.combat!.strikeProwess).toBe(15);
    expect(afterPlay.combat!.creatureRace).toBe('spawn');
  });

  test('second attack (Dwarves 4 @ 9) then third attack (Dwarves 2 @ 12) chain in order', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(
      state, PLAYER_1, action.cardInstanceId, undefined,
      { targetSiteDefinitionId: action.targetSiteDefinitionId },
    );

    // The Balrog faces the lone Spawn strike and survives (tapped); the
    // remaining attacks' strikes are piled onto the tapped Balrog and resolve.
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: THE_BALROG, roll: 12 }]);
    expect(afterAttack1.combat).not.toBeNull();
    expect(afterAttack1.combat!.strikesTotal).toBe(4);
    expect(afterAttack1.combat!.strikeProwess).toBe(9);
    expect(afterAttack1.combat!.creatureRace).toBe('dwarf');

    const afterAttack2 = runCardTriggeredAttackCombat(afterAttack1, []);
    expect(afterAttack2.combat).not.toBeNull();
    expect(afterAttack2.combat!.strikesTotal).toBe(2);
    expect(afterAttack2.combat!.strikeProwess).toBe(12);
    expect(afterAttack2.combat!.creatureRace).toBe('dwarf');
  });

  test('card is discarded when The Balrog is tapped after the attacks (cannot pay the keep cost)', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [BREACH] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    let s = playPermanentEventAndResolve(
      state, PLAYER_1, action.cardInstanceId, undefined,
      { targetSiteDefinitionId: action.targetSiteDefinitionId },
    );
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: THE_BALROG, roll: 12 }]); // attack 1 → attack 2
    s = runCardTriggeredAttackCombat(s, []);                                         // attack 2 → attack 3
    s = runCardTriggeredAttackCombat(s, []);                                         // attack 3 → done
    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BREACH)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BREACH)).toBe(false);
  });

  // ── Effect 2/4: after the attacks only The Balrog may be tapped to keep the card ──

  test('select-card-bearer offers ONLY The Balrog, never a company follower', () => {
    const base = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG, LIEUTENANT], hand: [] });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstanceId = mint();
    const state = recomputeDerived(addP1CardsInPlay({
      ...base,
      pendingResolutions: [{
        id: 'breach-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: { type: 'select-card-bearer', cardInstanceId, companyId, mode: 'move-to-mp-pile' },
      } satisfies PendingResolution],
    }, [{ instanceId: cardInstanceId, definitionId: BREACH, status: CardStatus.Untapped, attachedToSite: DROWNING_DEEPS, pendingTriggerAttack: true }]));

    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer').map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).not.toContain(lieutenantId);
    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  // ── Effect 4/5: keeping the card taps The Balrog and leaves it bound to the site ──

  test('tapping The Balrog keeps the card in play bound to the Under-deeps site (no attach to items)', () => {
    const base = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [] });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstanceId = mint();
    const state = recomputeDerived(addP1CardsInPlay({
      ...base,
      pendingResolutions: [{
        id: 'breach-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: { type: 'select-card-bearer', cardInstanceId, companyId, mode: 'move-to-mp-pile' },
      } satisfies PendingResolution],
    }, [{ instanceId: cardInstanceId, definitionId: BREACH, status: CardStatus.Untapped, attachedToSite: DROWNING_DEEPS, pendingTriggerAttack: true }]));

    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const bearerAction = viableActions(state, PLAYER_1, 'select-card-bearer')[0].action as SelectCardBearerAction;
    const afterKeep = dispatch(state, bearerAction);

    const balrog = afterKeep.players[RESOURCE_PLAYER].characters[balrogId];
    expect(balrog.status).toBe(CardStatus.Tapped);
    expect(balrog.items.some(i => i.definitionId === BREACH)).toBe(false);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === BREACH);
    expect(kept).toBeDefined();
    expect(kept!.attachedToSite).toBe(DROWNING_DEEPS);
    expect(kept!.pendingTriggerAttack).toBeUndefined();
  });

  // ── Effect 5: surface-site ascent roll reduced to zero ──

  test('with the card bound, the ascent roll from the Under-deeps site to its surface site is 0', () => {
    const base = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [] });
    const origin = base.cardPool[DROWNING_DEEPS] as SiteCard;
    const surface = base.cardPool[BLUE_MTN] as SiteCard;
    const underVaults = base.cardPool[UNDER_VAULTS] as SiteCard;

    // Baseline (no card): the surface site requires the printed roll of 13.
    expect(getUnderDeepsRequiredRoll(base, origin, surface, PLAYER_1)).toBe(13);

    const withCard = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: BREACH, status: CardStatus.Untapped, attachedToSite: DROWNING_DEEPS },
    ]));

    // The card owner's ascent to the surface site is now roll 0 …
    expect(getUnderDeepsRequiredRoll(withCard, origin, surface, PLAYER_1)).toBe(0);
    // … but the roll to a *different* Under-deeps site is unaffected (still 8) …
    expect(getUnderDeepsRequiredRoll(withCard, origin, underVaults, PLAYER_1)).toBe(8);
    // … and a player-agnostic query (no forPlayer) sees no reduction.
    expect(getUnderDeepsRequiredRoll(withCard, origin, surface, undefined)).toBe(13);
  });

  // ── Effect 5: the bound site is permanent (never swept while unoccupied) ──

  test('the bound Under-deeps site persists (card exempt from the orphan sweep) while unoccupied', () => {
    const base = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [THE_BALROG], hand: [] });
    // Move the company off the bound site so no company occupies it.
    const withCard = addP1CardsInPlay({
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [{ ...base.players[RESOURCE_PLAYER].companies[0], currentSite: null }] },
        base.players[1],
      ] as typeof base.players,
    }, [{ instanceId: mint(), definitionId: BREACH, status: CardStatus.Untapped, attachedToSite: DROWNING_DEEPS }]);

    const swept = discardOrphanedSiteAttachedEvents(withCard);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BREACH)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BREACH)).toBe(false);
  });
});
