/**
 * @module rule-8.03-faced-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.03: Faced an Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company or entity is considered to have "faced" an attack once the attack resolves and combat is initiated (even if the attack is then canceled; this also applies to automatic-attacks).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase, RegionType, SiteType } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions, resolveChain,
  findHandCardId, companyIdAt, makeMHState, playCreatureHazardAndResolve,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, MINAS_TIRITH, LORIEN,
} from '../../test-helpers.js';

// The engine's observable "has faced" bookkeeping is the after-attack play
// window (post-attack-play.ts): No News of Our Riding (le-211) is "playable
// on an untapped character immediately after his company faces an Elf,
// Dúnadan, or Man hazard creature". Rule 8.03's distinctive clause — the
// company has faced the attack *even if it is then canceled* — is proved by
// canceling the attack before any strike and confirming the window opens
// anyway. Orc Quarrels (le-216) provides the cancel: a minion short-event
// canceling an Orc/Troll/Man attack from hand, so the canceling card and the
// windowed card are different and le-211's company duplication limit never
// interferes. (The fought-out path of the same window is covered by the
// le-211 card tests.)
const NO_NEWS = 'le-211' as CardDefinitionId;
const ORC_QUARRELS = 'le-216' as CardDefinitionId;
const REN_RW = 'le-56' as CardDefinitionId;        // Ringwraith avatar
const LUITPRAND = 'le-23' as CardDefinitionId;     // minion Man companion
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion dark-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // location deck filler
const ABDUCTOR = 'tw-1' as CardDefinitionId;       // Man hazard creature, keyed {b}

describe('Rule 8.03 — Faced an Attack', () => {
  beforeEach(() => resetMint());

  test('a company has faced an attack once combat initiates, even if the attack is then canceled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [REN_RW, LUITPRAND] }],
          hand: [NO_NEWS, ORC_QUARRELS],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [ABDUCTOR],
          siteDeck: [LORIEN],
        },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Cardolan'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    // The hazard player keys the Man creature to the site path — combat opens.
    const abductorId = findHandCardId(state, HAZARD_PLAYER, ABDUCTOR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      state, PLAYER_2, abductorId, companyId,
      { method: 'region-type' as const, value: RegionType.Border },
    );
    expect(inCombat.combat).not.toBeNull();

    // The defender cancels the attack from hand before any strike is fought.
    const orcQuarrelsId = findHandCardId(inCombat, RESOURCE_PLAYER, ORC_QUARRELS);
    const cancel = viableActions(inCombat, PLAYER_1, 'cancel-attack').find(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (orcQuarrelsId as string),
    );
    expect(cancel).toBeDefined();
    const after = resolveChain(dispatch(inCombat, cancel!.action));
    expect(after.combat).toBeNull();

    // No strike was ever resolved, yet the company counts as having faced the
    // attack: the "immediately after his company faces …" play window opens
    // for No News of Our Riding all the same.
    const offer = after.pendingResolutions.find(r => r.kind.type === 'post-attack-play-offer');
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);
    const noNewsId = findHandCardId(after, RESOURCE_PLAYER, NO_NEWS);
    expect(offer!.kind.type === 'post-attack-play-offer' && offer!.kind.cardInstanceIds).toContain(noNewsId);
  });
});
