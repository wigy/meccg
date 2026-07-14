/**
 * @module ba-64.test
 *
 * Card test: Invade Their Domain (ba-64)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on the Blue Mountain or
 *    Iron Hill Dwarf-hold if The Balrog is there and Breach the Hold is on its
 *    adjacent Under-deeps site. The Balrog's company faces 3 attacks (Dwarves —
 *    5 strikes with 9 prowess, 4 strikes with 10 prowess, 3 strikes with 12
 *    prowess). Following the attacks, tap The Balrog or discard this card. If
 *    this card is not discarded, discard all unique factions playable at the
 *    site. Discard this card when the site is discarded or returned to its
 *    location deck. Cannot be duplicated on a given site."
 *
 * Effects:
 *   1. play-target site { name in [Blue Mountain / Iron Hill Dwarf-hold] }   — site.ts filter
 *   2. play-target character { name: The Balrog }                            — site.ts / keep gate
 *   3. play-condition card-on-adjacent-under-deeps { Breach the Hold }       — site.ts
 *   4. duplication-limit scope site                                          — site.ts
 *   5. trigger-attack-on-play [Dwarves 5/9, 4/10, 3/12] move-to-mp-pile,
 *      discardUniqueFactionsAtSite                                           — chain/combat-finalize/pending
 *
 * The card is non-unique, worth 0 MP, and — unlike Breach the Hold / Roots of
 * the Earth — carries no permanence exemption, so it is swept with its site.
 *
 * Playable: YES
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
  PendingResolution, ResolutionId, CardInPlay,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const INVADE = 'ba-64' as CardDefinitionId;
const BREACH_THE_HOLD = 'ba-50' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;          // balrog avatar
const LIEUTENANT = 'le-21' as CardDefinitionId;         // Lieutenant of Dol Guldur — troll leader (non-Balrog)

const BLUE_MOUNTAIN = 'le-355' as CardDefinitionId;     // Blue Mountain Dwarf-hold (Dwarves 4/10 auto-attack)
const IRON_HILL = 'le-383' as CardDefinitionId;         // Iron Hill Dwarf-hold
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;     // Under-deeps adjacent to Blue Mountain Dwarf-hold
const RUSTED_DEEPS = 'ba-96' as CardDefinitionId;       // Under-deeps adjacent to Iron Hill Dwarf-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // haven — wrong site type

const BLUE_MTN_DWARVES = 'tw-200' as CardDefinitionId;  // UNIQUE faction playableAt { site: 'Blue Mountain Dwarf-hold' }
const IRON_HILL_DWARVES = 'tw-261' as CardDefinitionId; // UNIQUE faction playableAt { site: 'Iron Hill Dwarf-hold' }

/**
 * Build a site-phase state with a Balrog company at `site`, `Invade Their Domain`
 * in hand, and (optionally) Breach the Hold kept in play on the adjacent
 * Under-deeps site `breachOn`.
 */
function buildPlay(opts: {
  site?: CardDefinitionId;
  characters?: CardDefinitionId[];
  breachOn?: CardDefinitionId | null;
} = {}): GameState {
  const site = opts.site ?? BLUE_MOUNTAIN;
  const base = buildMinionSitePhaseState({
    site,
    characters: opts.characters ?? [THE_BALROG],
    hand: [INVADE],
  });
  if (opts.breachOn === null) return base;
  const breachOn = opts.breachOn ?? DROWNING_DEEPS;
  return recomputeDerived(addP1CardsInPlay(base, [
    { instanceId: mint(), definitionId: BREACH_THE_HOLD, status: CardStatus.Untapped, attachedToSite: breachOn },
  ]));
}

/**
 * Seed a select-card-bearer pending resolution for a mid-flow Invade Their
 * Domain (right after its Dwarf attacks): the card sits in the Balrog player's
 * cardsInPlay flagged `pendingTriggerAttack`, both members untapped, and the
 * pending carries `discardUniqueFactionsAtSite`. `factions` are seeded into the
 * named owner's cardsInPlay so the discard branch can act on them.
 */
function seedKeep(
  site: CardDefinitionId,
  factions: Array<{ defId: CardDefinitionId; owner: PlayerId; instanceId: CardInstanceId }> = [],
): { state: GameState; cardInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({ site, characters: [THE_BALROG, LIEUTENANT], hand: [] });
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
          { instanceId: cardInstanceId, definitionId: INVADE, status: CardStatus.Untapped, attachedToSite: site, pendingTriggerAttack: true },
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
        id: 'invade-bearer' as ResolutionId,
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

describe('Invade Their Domain (ba-64)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2/3: playability keying ──

  test('playable at Blue Mountain Dwarf-hold with The Balrog and Breach the Hold on the adjacent Under-deeps site', () => {
    const state = buildPlay();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    // Bearer (the keep) chosen post-attack → no targetCharacterId embedded at play.
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(BLUE_MOUNTAIN);
  });

  test('playable at Iron Hill Dwarf-hold with Breach the Hold on The Rusted-deeps', () => {
    const state = buildPlay({ site: IRON_HILL, breachOn: RUSTED_DEEPS });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable at a non-Dwarf-hold site (a haven)', () => {
    const state = buildPlay({ site: MINAS_MORGUL });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when The Balrog is not in the company', () => {
    const state = buildPlay({ characters: [LIEUTENANT] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when Breach the Hold is not on the adjacent Under-deeps site', () => {
    const state = buildPlay({ breachOn: null });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when Breach the Hold is on a NON-adjacent Under-deeps site', () => {
    // At Blue Mountain, but Breach the Hold sits on The Rusted-deeps (adjacent to
    // Iron Hill, not Blue Mountain) — the adjacency check fails.
    const state = buildPlay({ site: BLUE_MOUNTAIN, breachOn: RUSTED_DEEPS });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 5: the first triggered Dwarf attack ──

  test('playing it triggers the first Dwarf attack (5 strikes @ 9 prowess) on the company', () => {
    const state = buildPlay();
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, undefined, {
      targetSiteDefinitionId: BLUE_MOUNTAIN,
    });
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.creatureRace).toBe('dwarf');
    expect(afterPlay.combat!.strikesTotal).toBe(5);
    expect(afterPlay.combat!.strikeProwess).toBe(9);
    // Two further attacks are queued behind the first.
    expect(afterPlay.combat!.attackSource.type).toBe('card-triggered-attack');
    if (afterPlay.combat!.attackSource.type === 'card-triggered-attack') {
      expect(afterPlay.combat!.attackSource.remainingAttacks?.length).toBe(2);
    }
  });

  // ── Effect 2/5: the keep is restricted to The Balrog ──

  test('select-card-bearer offers ONLY The Balrog, never a company follower', () => {
    const { state } = seedKeep(BLUE_MOUNTAIN);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).not.toContain(lieutenantId);
  });

  test('keeping taps The Balrog and leaves the card bound to the site', () => {
    const { state, cardInstanceId } = seedKeep(BLUE_MOUNTAIN);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = recomputeDerived(dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId,
    }));
    expect(afterKeep.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardInstanceId);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(kept!.attachedToSite).toBe(BLUE_MOUNTAIN);
  });

  test('passing (declining the keep) discards the card', () => {
    const { state, cardInstanceId } = seedKeep(BLUE_MOUNTAIN);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(afterPass.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });

  // ── Effect 5: discard unique factions playable at the site on keep ──

  test('keeping discards a unique faction (either player) playable at the site', () => {
    const factionId = 'p2-201' as CardInstanceId; // opponent's Blue Mountain Dwarves
    const { state, cardInstanceId } = seedKeep(BLUE_MOUNTAIN, [
      { defId: BLUE_MTN_DWARVES, owner: PLAYER_2, instanceId: factionId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId,
    });
    expect(afterKeep.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterKeep.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === factionId)).toBe(true);
  });

  test('a unique faction playable at a DIFFERENT site is NOT discarded', () => {
    const factionId = `${PLAYER_1}-201` as CardInstanceId; // Iron Hill Dwarves, playable at Iron Hill (not Blue Mountain)
    const { state, cardInstanceId } = seedKeep(BLUE_MOUNTAIN, [
      { defId: IRON_HILL_DWARVES, owner: PLAYER_1, instanceId: factionId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId,
    });
    expect(afterKeep.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
  });

  test('declining the keep does NOT discard factions', () => {
    const factionId = 'p2-201' as CardInstanceId;
    const { state } = seedKeep(BLUE_MOUNTAIN, [
      { defId: BLUE_MTN_DWARVES, owner: PLAYER_2, instanceId: factionId },
    ]);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
  });

  // ── duplication: one copy per site ──

  test('a second copy is NOT playable at a site that already carries one', () => {
    const base = buildPlay();
    const withCopy = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: INVADE, status: CardStatus.Untapped, attachedToSite: BLUE_MOUNTAIN },
    ]));
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── permanence: unlike Breach the Hold, this card IS swept with its site ──

  test('the kept card is discarded by the orphan sweep once its site is unoccupied', () => {
    const { state, cardInstanceId } = seedKeep(BLUE_MOUNTAIN);
    // Keep it first (clear the pending flag), then vacate the site.
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const kept = recomputeDerived(dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId,
    }));
    const vacated: GameState = {
      ...kept,
      players: [
        { ...kept.players[RESOURCE_PLAYER], companies: [] },
        kept.players[HAZARD_PLAYER],
      ] as typeof kept.players,
    };
    const swept = discardOrphanedSiteAttachedEvents(vacated);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });
});
