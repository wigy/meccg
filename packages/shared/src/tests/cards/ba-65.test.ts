/**
 * @module ba-65.test
 *
 * Card test: Lord and Usurper (ba-65)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on Invade Their Domain. The
 *    company faces 2 attacks (Dwarves — 4 strikes with 9 prowess, 3 strikes with
 *    10 prowess). Following the attacks, tap a character or discard this card. If
 *    this card is not discarded, discard all unique factions playable at the
 *    site. All versions of the associated site become a Shadow-hold [{S}], may
 *    have no factions played there, and lose all Dwarf automatic-attacks. Other
 *    versions gain an automatic-attack: Orcs — 4 strikes with 7 prowess. Cannot
 *    be duplicated on a given card."
 *
 * Effects:
 *   1. play-target site { name in [Blue Mountain / Iron Hill Dwarf-hold] }   — site.ts filter
 *   2. play-condition card-attached-to-site { Invade Their Domain }          — site.ts
 *   3. duplication-limit scope site                                          — site.ts
 *   4. trigger-attack-on-play [Dwarves 4/9, 3/10] move-to-mp-pile,
 *      discardUniqueFactionsAtSite                                           — chain/combat-finalize/pending
 *   5. site-instance-transform (both versions → Shadow-hold, lose Dwarf
 *      auto-attacks, no factions; other versions gain Orcs 4/7)              — effective.ts / manifestations.ts / site.ts
 *
 * Unlike Invade Their Domain, the keep is offered to ANY character in the
 * company (not just The Balrog). Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  PLAYER_2,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
  CardStatus,
  Phase,
  buildMinionSitePhaseState,
  resetMint, mint,
  viableActions,
  playPermanentEventAndResolve,
  dispatch, companyIdAt, findCharInstanceId, addP1CardsInPlay,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayerId,
  PlayPermanentEventAction, SelectCardBearerAction,
  PendingResolution, ResolutionId, SiteCard, CardInPlay,
} from '../../index.js';
import { SiteType } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';

const LORD = 'ba-65' as CardDefinitionId;
const INVADE = 'ba-64' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;          // balrog avatar
const LIEUTENANT = 'le-21' as CardDefinitionId;         // Lieutenant of Dol Guldur — troll leader (non-Balrog)

const BLUE_MOUNTAIN = 'le-355' as CardDefinitionId;     // Blue Mountain Dwarf-hold (Dwarves 4/10 auto-attack)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // haven — wrong site type

const BLUE_MTN_DWARVES = 'tw-200' as CardDefinitionId;  // UNIQUE faction playableAt { site: 'Blue Mountain Dwarf-hold' }

/**
 * Build a site-phase state with a company at Blue Mountain Dwarf-hold, Lord and
 * Usurper in hand, and (by default) Invade Their Domain kept on that site so the
 * `card-attached-to-site` play-condition is satisfied.
 */
function buildPlay(opts: { withInvade?: boolean; characters?: CardDefinitionId[] } = {}): GameState {
  const base = buildMinionSitePhaseState({
    site: BLUE_MOUNTAIN,
    characters: opts.characters ?? [THE_BALROG, LIEUTENANT],
    hand: [LORD],
  });
  if (opts.withInvade === false) return base;
  return recomputeDerived(addP1CardsInPlay(base, [
    { instanceId: mint(), definitionId: INVADE, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN },
  ]));
}

/**
 * Build a site-phase state with Lord and Usurper already kept in play (the
 * `move-to-mp-pile` post-attack state): the card sits in the Balrog player's
 * cardsInPlay bound to Blue Mountain Dwarf-hold with the pending flag cleared,
 * so its site transformation is active.
 */
function buildKept(): { state: GameState; lordInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN, characters: [THE_BALROG], hand: [] });
  const lordInstanceId = mint();
  const state = recomputeDerived(addP1CardsInPlay(base, [
    { instanceId: lordInstanceId, definitionId: LORD, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN },
  ]));
  return { state, lordInstanceId };
}

/**
 * Seed a select-card-bearer pending resolution for a mid-flow Lord and Usurper
 * (right after its Dwarf attacks): card in cardsInPlay flagged
 * `pendingTriggerAttack`, both members untapped, pending carries
 * `discardUniqueFactionsAtSite`. `factions` are seeded into the named owner's
 * cardsInPlay.
 */
function seedKeep(
  factions: Array<{ defId: CardDefinitionId; owner: PlayerId; instanceId: CardInstanceId }> = [],
): { state: GameState; cardInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({ site: BLUE_MOUNTAIN, characters: [THE_BALROG, LIEUTENANT], hand: [] });
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const cardInstanceId = mint();
  const p1Factions: CardInPlay[] = factions
    .filter(f => f.owner === PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));
  const p2Factions: CardInPlay[] = factions
    .filter(f => f.owner !== PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));
  const withCard: GameState = {
    ...base,
    players: [
      {
        ...base.players[RESOURCE_PLAYER],
        cardsInPlay: [
          ...base.players[RESOURCE_PLAYER].cardsInPlay,
          { instanceId: cardInstanceId, definitionId: LORD, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN, pendingTriggerAttack: true },
          ...p1Factions,
        ],
      },
      {
        ...base.players[HAZARD_PLAYER],
        cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, ...p2Factions],
      },
    ] as typeof base.players,
    pendingResolutions: [
      {
        id: 'lord-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId,
          mode: 'move-to-mp-pile',
          discardUniqueFactionsAtSite: true,
        },
      } satisfies PendingResolution,
    ],
  };
  return { state: recomputeDerived(withCard), cardInstanceId };
}

describe('Lord and Usurper (ba-65)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2: playability keying ──

  test('playable on Invade Their Domain at Blue Mountain Dwarf-hold', () => {
    const state = buildPlay();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(BLUE_MOUNTAIN);
  });

  test('NOT playable when Invade Their Domain is not on the site', () => {
    const state = buildPlay({ withInvade: false });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a non-Dwarf-hold site even with Invade Their Domain "attached" there', () => {
    // Invade Their Domain can only sit on a Dwarf-hold, so at a haven the site
    // play-target filter already excludes Lord and Usurper.
    const base = buildMinionSitePhaseState({ site: MINAS_MORGUL, characters: [THE_BALROG], hand: [LORD] });
    const state = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: INVADE, status: CardStatus.Untapped, attachedToSite: MINAS_MORGUL },
    ]));
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 4: the first triggered Dwarf attack ──

  test('playing it triggers the first Dwarf attack (4 strikes @ 9 prowess) on the company', () => {
    const state = buildPlay();
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, undefined, {
      targetSiteDefinitionId: BLUE_MOUNTAIN,
    });
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.creatureRace).toBe('dwarf');
    expect(afterPlay.combat!.strikesTotal).toBe(4);
    expect(afterPlay.combat!.strikeProwess).toBe(9);
    if (afterPlay.combat!.attackSource.type === 'card-triggered-attack') {
      expect(afterPlay.combat!.attackSource.remainingAttacks?.length).toBe(1);
    }
  });

  // ── Effect 4: the keep is offered to ANY character (not just The Balrog) ──

  test('select-card-bearer offers any untapped company member, including a follower', () => {
    const { state } = seedKeep();
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).toContain(lieutenantId);
  });

  test('keeping taps the chosen follower and leaves the card bound to the site', () => {
    const { state, cardInstanceId } = seedKeep();
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const afterKeep = recomputeDerived(dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: lieutenantId,
    }));
    expect(afterKeep.players[RESOURCE_PLAYER].characters[lieutenantId].status).toBe(CardStatus.Tapped);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardInstanceId);
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(kept!.attachedToSite).toBe(BLUE_MOUNTAIN);
  });

  // ── Effect 4: discard unique factions playable at the site on keep ──

  test('keeping discards a unique faction (either player) playable at the site', () => {
    const factionId = 'p2-201' as CardInstanceId;
    const { state, cardInstanceId } = seedKeep([
      { defId: BLUE_MTN_DWARVES, owner: PLAYER_2, instanceId: factionId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId,
    });
    expect(afterKeep.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterKeep.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === factionId)).toBe(true);
  });

  // ── Effect 5: the associated site becomes a Shadow-hold and loses its Dwarf attacks ──

  test('the associated site reads as a Shadow-hold with no Dwarf automatic-attacks', () => {
    const { state } = buildKept();
    const siteDef = state.cardPool[BLUE_MOUNTAIN] as SiteCard;
    const associatedInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    expect(getEffectiveSiteType(state, BLUE_MOUNTAIN, siteDef.siteType, associatedInstanceId)).toBe(SiteType.ShadowHold);
    const attacks = getActiveAutoAttacks(state, siteDef, associatedInstanceId);
    expect(attacks.some(a => a.creatureType === 'Dwarves')).toBe(false);
    // The associated version does NOT gain the Orcs attack (only other versions do).
    expect(attacks.some(a => a.creatureType === 'Orcs')).toBe(false);
  });

  // ── Effect 5: other versions become a Shadow-hold, lose Dwarf attacks, gain Orcs 4/7 ──

  test('another version of the site reads as a Shadow-hold, loses Dwarf attacks, and gains an Orcs 4/7 attack', () => {
    const { state } = buildKept();
    const siteDef = state.cardPool[BLUE_MOUNTAIN] as SiteCard;
    const otherInstanceId = mint(); // an instance that is NOT the controller's current site

    expect(getEffectiveSiteType(state, BLUE_MOUNTAIN, siteDef.siteType, otherInstanceId)).toBe(SiteType.ShadowHold);
    const attacks = getActiveAutoAttacks(state, siteDef, otherInstanceId);
    expect(attacks.some(a => a.creatureType === 'Dwarves')).toBe(false);
    const orc = attacks.find(a => a.creatureType === 'Orcs');
    expect(orc).toBeDefined();
    expect(orc!.strikes).toBe(4);
    expect(orc!.prowess).toBe(7);
  });

  test('the transformation is dormant while the card is still pendingTriggerAttack', () => {
    const { state } = seedKeep(); // card is pendingTriggerAttack, not yet kept
    const siteDef = state.cardPool[BLUE_MOUNTAIN] as SiteCard;
    const associatedInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    // Printed type still applies; the Shadow-hold conversion has not activated.
    expect(getEffectiveSiteType(state, BLUE_MOUNTAIN, siteDef.siteType, associatedInstanceId)).toBe(SiteType.FreeHold);
    // The printed Dwarf auto-attack is still present.
    expect(getActiveAutoAttacks(state, siteDef, associatedInstanceId).some(a => a.creatureType === 'Dwarves')).toBe(true);
  });

  // ── Effect 5: no factions may be played at the transformed site ──

  test('a faction playable at the site is barred once the transform is active', () => {
    // Control: without the transform, the (name-keyed) faction is playable here.
    const control = buildMinionSitePhaseState({
      site: BLUE_MOUNTAIN, characters: [THE_BALROG], hand: [BLUE_MTN_DWARVES],
    });
    expect(viableActions(control, PLAYER_1, 'influence-attempt').length).toBeGreaterThan(0);

    // With Lord and Usurper kept on the site, the same faction is barred.
    const base = buildMinionSitePhaseState({
      site: BLUE_MOUNTAIN, characters: [THE_BALROG], hand: [BLUE_MTN_DWARVES],
    });
    const transformed = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: LORD, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN },
    ]));
    expect(viableActions(transformed, PLAYER_1, 'influence-attempt').length).toBe(0);
  });

  // ── duplication: one copy per site (= per Invade Their Domain card) ──

  test('a second copy is NOT playable at a site that already carries one', () => {
    const base = buildPlay();
    const withCopy = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: LORD, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN },
    ]));
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });
});
