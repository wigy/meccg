/**
 * @module as-51.test
 *
 * Card test: No Strangers at this Time (as-51)
 * Type: hero-resource-event (permanent), alignment wizard. Non-unique, 1 misc MP.
 *
 * Text:
 *   "Playable during the site phase on a Free-hold [{F}] or Border-hold [{B}] if
 *    you have played a faction there. This site is never discarded and never
 *    untaps for you. All detainment attacks at all versions of this site against
 *    minion companies instead attack normally. Against minion companies, each
 *    version of this site has an additional automatic-attack: an exact copy
 *    including all modifications of the first automatic-attack listed on its
 *    card. Cannot be duplicated on a given site."
 *
 * Effects:
 *   1. play-target site { siteType in [free-hold, border-hold] }        — site.ts filter
 *   2. play-condition company-context { company.playedFactionHere }     — site.ts / reducer-utils
 *        (`SitePhaseState.factionPlayedThisSitePhase`, set when a faction resolves)
 *   3. duplication-limit scope site                                     — site.ts
 *   4. site-lock (convertDetainmentVsMinion, duplicateFirstAutoAttackVsMinion) — the ongoing rules:
 *        a. permanence ("never discarded")            — cardKeepsBoundSitePermanent
 *        b. never untaps for the owner (re-placed tapped) — mh-hazard-play.ts step 8
 *        c. detainment→normal vs minion companies     — forcesNormalAttacks (reducer-site.ts)
 *        d. extra copy of the first auto-attack vs minion — handleSiteAutomaticAttacks done-branch
 *
 * The site-lock permanence/never-untaps machinery is shared with People
 * Diminished (ba-72) — see ba-72.test.ts; here we cover the as-51-specific play
 * gating (needs a faction played there) and the anti-minion combat rules.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  CardStatus,
  buildSitePhaseState, buildMinionSitePhaseState,
  resetMint, mint,
  viableActions, dispatch,
  findCharInstanceId,
  addP1CardsInPlay, addP2CardsInPlay,
  setupAutoAttackStep,
} from '../test-helpers.js';
import { ARAGORN, RIDERS_OF_ROHAN } from '../../index.js';
import { resolveInfluenceAttemptRoll } from '../../engine/reducer-site.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlayPermanentEventAction,
} from '../../index.js';

const NO_STRANGERS = 'as-51' as CardDefinitionId;

// Sites (shared pool).
const GOBEL_MIRLOND = 'as-139' as CardDefinitionId;   // border-hold; Men 4/9 auto-attack; unconditional combat-detainment
const EDORAS = 'le-372' as CardDefinitionId;           // free-hold
const SARN = 'le-401' as CardDefinitionId;             // shadow-hold — wrong site type
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // haven — wrong site type

// A minion (Ringwraith) character for the anti-minion combat rules.
const GORBAG = 'le-11' as CardDefinitionId;

/** Set `factionPlayedThisSitePhase` on a site-phase state (the flag the play-condition reads). */
function withFactionPlayed(state: GameState): GameState {
  return { ...state, phaseState: { ...(state.phaseState as SitePhaseState), factionPlayedThisSitePhase: true } };
}

describe('No Strangers at this Time (as-51)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: playability requires a faction played there this site phase ──

  test('NOT playable at a Free-hold/Border-hold before a faction is played there', () => {
    const state = buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [NO_STRANGERS] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('playable at a Border-hold once a faction has been played there', () => {
    const state = withFactionPlayed(
      buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [NO_STRANGERS] }),
    );
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(GOBEL_MIRLOND);
  });

  test('playable at a Free-hold once a faction has been played there', () => {
    const state = withFactionPlayed(
      buildSitePhaseState({ site: EDORAS, characters: [ARAGORN], hand: [NO_STRANGERS] }),
    );
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  // ── Effect 1: site-type filter ──

  test('NOT playable at a Shadow-hold even after a faction is played there', () => {
    const state = withFactionPlayed(
      buildSitePhaseState({ site: SARN, characters: [ARAGORN], hand: [NO_STRANGERS] }),
    );
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a haven even after a faction is played there', () => {
    const state = withFactionPlayed(
      buildSitePhaseState({ site: MINAS_MORGUL, characters: [ARAGORN], hand: [NO_STRANGERS] }),
    );
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 2 wiring: a resolved faction sets the SitePhaseState flag ──

  test('successfully playing a faction sets factionPlayedThisSitePhase', () => {
    const at = buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [RIDERS_OF_ROHAN] });
    expect(at.phaseState.factionPlayedThisSitePhase).toBeFalsy();
    const factionCard = at.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === RIDERS_OF_ROHAN)!;
    const after = resolveInfluenceAttemptRoll(
      { ...at, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: findCharInstanceId(at, RESOURCE_PLAYER, ARAGORN) } },
    );
    expect((after.state.phaseState as SitePhaseState).factionPlayedThisSitePhase).toBe(true);
  });

  // ── Effect 3: one copy per site ──

  test('a second copy is NOT playable at a site that already carries one', () => {
    const base = withFactionPlayed(
      buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [NO_STRANGERS] }),
    );
    const withCopy = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND },
    ]));
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 4a: permanence — "This site is never discarded" ──

  test('the bound card is exempt from the site-attached orphan sweep while the site is unoccupied', () => {
    const base = buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [] });
    const withCard = addP1CardsInPlay(
      {
        ...base,
        players: [
          { ...base.players[RESOURCE_PLAYER], companies: [{ ...base.players[RESOURCE_PLAYER].companies[0], currentSite: null }] },
          base.players[1],
        ] as typeof base.players,
      },
      [{ instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND }],
    );
    const swept = discardOrphanedSiteAttachedEvents(withCard);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === NO_STRANGERS)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === NO_STRANGERS)).toBe(false);
  });

  // ── Effect 4c: detainment attacks against a minion company become normal ──

  test('a minion company faces the site auto-attack as DETAINMENT when the card is absent', () => {
    const state = setupAutoAttackStep(
      buildMinionSitePhaseState({ site: GOBEL_MIRLOND, characters: [GORBAG], hand: [] }),
    );
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.detainment).toBe(true);
  });

  test('the bound card makes the detainment auto-attack NORMAL against a minion company', () => {
    // The hero owns the card (hazard player here); `siteLockAntiMinion` scans
    // both players' cardsInPlay by site definition.
    const base = buildMinionSitePhaseState({ site: GOBEL_MIRLOND, characters: [GORBAG], hand: [] });
    const withLock = recomputeDerived(addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND },
    ]));
    const after = dispatch(setupAutoAttackStep(withLock), { type: 'pass', player: PLAYER_1 });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.detainment).toBe(false);
  });

  test('the card does NOT convert detainment for a non-minion (hero) company', () => {
    const base = buildSitePhaseState({ site: GOBEL_MIRLOND, characters: [ARAGORN], hand: [] });
    const withLock = recomputeDerived(addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND },
    ]));
    const after = dispatch(setupAutoAttackStep(withLock), { type: 'pass', player: PLAYER_1 });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(true);
  });

  // ── Effect 4d: an extra copy of the first auto-attack against a minion company ──

  test('a minion company faces an additional copy of the first auto-attack after the printed attacks', () => {
    const base = buildMinionSitePhaseState({ site: GOBEL_MIRLOND, characters: [GORBAG], hand: [] });
    const withLock = recomputeDerived(addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND },
    ]));
    // Jump to "all printed attacks resolved" (Gobel Mírlond lists exactly one).
    const atDone = {
      ...setupAutoAttackStep(withLock),
      phaseState: { ...(setupAutoAttackStep(withLock).phaseState as SitePhaseState), automaticAttacksResolved: 1 },
    } as GameState;
    const after = dispatch(atDone, { type: 'pass', player: PLAYER_1 });
    // The extra attack (an exact copy of the Men 4/9) is now live.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(9);
    expect((after.phaseState as SitePhaseState).siteLockMinionAttackDone).toBe(true);
  });

  test('the additional attack fires exactly once (not again on the next pass)', () => {
    const base = buildMinionSitePhaseState({ site: GOBEL_MIRLOND, characters: [GORBAG], hand: [] });
    const withLock = recomputeDerived(addP2CardsInPlay(base, [
      { instanceId: mint(), definitionId: NO_STRANGERS, status: CardStatus.Untapped, attachedToSite: GOBEL_MIRLOND },
    ]));
    // Already faced the extra attack (flag set); no printed attacks remain.
    const spent: GameState = {
      ...setupAutoAttackStep(withLock),
      phaseState: {
        ...(setupAutoAttackStep(withLock).phaseState as SitePhaseState),
        automaticAttacksResolved: 2,
        siteLockMinionAttackDone: true,
      },
    };
    const after = dispatch(spent, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeNull();
    expect((after.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('a minion company faces NO additional attack when the card is absent', () => {
    const base = buildMinionSitePhaseState({ site: GOBEL_MIRLOND, characters: [GORBAG], hand: [] });
    const atDone = {
      ...setupAutoAttackStep(base),
      phaseState: { ...(setupAutoAttackStep(base).phaseState as SitePhaseState), automaticAttacksResolved: 1 },
    } as GameState;
    const after = dispatch(atDone, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeNull();
    expect((after.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
