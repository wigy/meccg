/**
 * @module wh-114 — Radagast's Black Bird
 *
 * Card shape (documented here, not asserted against the JSON):
 *   - `minion-resource-ally`, `alignment: "stage"`, unique, prowess 2 / body 8 /
 *     mind 2 / direct-influence 3, skills Scout/Diplomat, MP 1 (ally category),
 *     stage-points 2. Carries the `radagast-specific` keyword.
 *   - effects: stage-points 2; play-flags `playable-at-tapped-site`,
 *     `no-tap-on-play`, `influences-factions`; a `return-to-hand` effect firing
 *     `during` the organization phase and when its controller leaves play; and a
 *     `cancel-strike` (`cost: { tap: self }`).
 *   - `playableAt: [{ any: true }]` — Radagast may play it at any site.
 *
 * Text: "Unique. Radagast specific. Playable at one of your Wizardhavens [{H}].
 * You may return Radagast's Black Bird to your hand: during your organization
 * phase or if its controlling character leaves active play. Radagast may play
 * this ally at any site (tapped or untapped) and need not tap himself or the
 * site to do so. This ally may attempt to influence factions as if he were a
 * character. He may cancel a strike directed against him — tapping afterwards if
 * not already tapped."
 *
 * All tests drive the reducer / legal-action pipeline; none assert JSON shape.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, Phase, Alignment, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildFallenWizardSitePhaseState, buildFallenWizardOrgPhaseState,
  buildFallenWizardInfluenceState, buildTestState,
  attachAllyToChar, findCharInstanceId, findHandCardId, companyIdAt,
  viableActions, viableActionsForHandCard, dispatch, resolveChain,
  setCharStatus, makeCancelWindowCombat, makeBodyCheckCombat, actionAs,
  MORIA, MINAS_TIRITH, ISENGARD, LEGOLAS,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, InfluenceAttemptAction, CancelStrikeAction,
} from '../../index.js';

const BLACK_BIRD = 'wh-114' as CardDefinitionId;
const RADAGAST_FW = 'wh-8' as CardDefinitionId; // Fallen-wizard Radagast (DI 5, body 9)
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId; // hero faction, influence # 8, at Minas Tirith

/** Instance id of the (single) Black Bird ally borne by Radagast. */
function blackBirdOn(state: ReturnType<typeof buildTestState>): CardInstanceId {
  const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST_FW);
  const ally = state.players[RESOURCE_PLAYER].characters[radagastId]?.allies
    .find(a => a.definitionId === BLACK_BIRD);
  if (!ally) throw new Error('Black Bird not attached to Radagast');
  return ally.instanceId;
}

describe("Radagast's Black Bird (wh-114)", () => {
  beforeEach(() => resetMint());

  // ─── Radagast may play it at any site, without tapping himself or the site ──

  test('Radagast plays the ally at a non-Wizardhaven site without tapping himself or the site', () => {
    const state = buildFallenWizardSitePhaseState({
      characters: [RADAGAST_FW], site: MORIA, hand: [BLACK_BIRD],
    });
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST_FW);

    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_BIRD);
    expect(plays).toHaveLength(1);

    const after = dispatch(state, plays[0].action);
    // Ally attached to Radagast…
    const radagast = after.players[RESOURCE_PLAYER].characters[radagastId];
    expect(radagast.allies.some(a => a.definitionId === BLACK_BIRD)).toBe(true);
    // …and neither Radagast nor the site tapped ("need not tap himself or the site").
    expect(radagast.status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    // The site's normal resource slot is untouched (no-tap play does not consume it).
    const sp = after.phaseState as { resourcePlayed?: boolean };
    expect(sp.resourcePlayed).toBe(false);
  });

  test('playable even at a tapped site (tapped or untapped)', () => {
    const state = buildFallenWizardSitePhaseState({
      characters: [RADAGAST_FW], site: MORIA, hand: [BLACK_BIRD], siteStatus: CardStatus.Tapped,
    });
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_BIRD);
    expect(plays).toHaveLength(1);
    const after = dispatch(state, plays[0].action);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST_FW);
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].allies.some(a => a.definitionId === BLACK_BIRD)).toBe(true);
  });

  test('Radagast may play it even while he is tapped (need not tap himself)', () => {
    const base = buildFallenWizardSitePhaseState({
      characters: [RADAGAST_FW], site: MORIA, hand: [BLACK_BIRD],
    });
    const state = setCharStatus(base, RESOURCE_PLAYER, RADAGAST_FW, CardStatus.Tapped);
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_BIRD);
    expect(plays).toHaveLength(1);
  });

  // ─── Radagast specific: only Radagast may control it ────────────────────────

  test('a non-Radagast character cannot control it (Radagast specific)', () => {
    const state = buildFallenWizardSitePhaseState({
      characters: [LEGOLAS], site: MORIA, hand: [BLACK_BIRD],
    });
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLACK_BIRD);
    expect(plays).toHaveLength(0);
  });

  // ─── May attempt to influence factions as if he were a character ────────────

  test('the ally may attempt to influence a faction, using its direct influence', () => {
    const base = buildFallenWizardInfluenceState({
      avatar: RADAGAST_FW, p1Site: MINAS_TIRITH, p2Site: ISENGARD,
      p1Hand: [MEN_OF_ANORIEN],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(state);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_ANORIEN);

    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === factionId);

    const birdAttempt = attempts.find(a => a.influencingCharacterId === birdId);
    expect(birdAttempt).toBeDefined();
    // influence # 8 − DI 3 = 5.
    expect(birdAttempt!.need).toBe(5);
  });

  test('a successful ally influence attempt places the faction in play and taps the ally', () => {
    const base = buildFallenWizardInfluenceState({
      avatar: RADAGAST_FW, p1Site: MINAS_TIRITH, p2Site: ISENGARD,
      p1Hand: [MEN_OF_ANORIEN],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(state);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_ANORIEN);

    const birdAttempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === birdId);
    expect(birdAttempt).toBeDefined();

    // Declare, pass the chain, then resolve the pending influence roll (forced high).
    const afterChain = resolveChain(dispatch(state, birdAttempt!));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const after = dispatch({ ...afterChain, cheatRollTotal: 12 }, roll);

    // Faction succeeded (roll 12 + DI 3 = 15 ≥ 8) → into the player's play area.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_ANORIEN)).toBe(true);
    // The influencing ally tapped, exactly as an influencing character would.
    const radagastId = findCharInstanceId(after, RESOURCE_PLAYER, RADAGAST_FW);
    const bird = after.players[RESOURCE_PLAYER].characters[radagastId].allies.find(a => a.instanceId === birdId);
    expect(bird!.status).toBe(CardStatus.Tapped);
  });

  // ─── May cancel a strike directed against him, tapping afterwards ───────────

  test('taps to cancel a strike directed against itself', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [RADAGAST_FW] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBird = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(withBird);
    const withCombat = makeCancelWindowCombat(withBird, { attackSourceType: 'creature', strikesTotal: 1 });

    // Assign the single strike directly to the Black Bird (ally as target).
    const r2 = dispatch(withCombat, { type: 'assign-strike', player: PLAYER_1, characterId: birdId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = viableActions(r2, PLAYER_1, 'cancel-strike')
      .filter(a => actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === birdId);
    expect(cancels).toHaveLength(1);
    expect(actionAs<CancelStrikeAction>(cancels[0].action).targetCharacterId).toBe(birdId);

    const r3 = dispatch(r2, cancels[0].action);
    // Single strike canceled → combat ends.
    expect(r3.combat).toBeNull();
  });

  test('may cancel even an automatic-attack strike (no keying restriction)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [RADAGAST_FW] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBird = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(withBird);
    const withCombat = makeCancelWindowCombat(withBird, { attackSourceType: 'automatic-attack', strikesTotal: 1 });

    const r2 = dispatch(withCombat, { type: 'assign-strike', player: PLAYER_1, characterId: birdId, tapped: false });
    const cancels = viableActions(r2, PLAYER_1, 'cancel-strike')
      .filter(a => actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === birdId);
    expect(cancels).toHaveLength(1);
  });

  // ─── May be returned to hand during the organization phase ──────────────────

  test('may be returned to hand during the organization phase', () => {
    const base = buildFallenWizardOrgPhaseState({
      characters: [RADAGAST_FW], site: ISENGARD, hand: [],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(state);

    const returns = viableActions(state, PLAYER_1, 'return-attached-to-hand')
      .filter(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === birdId);
    expect(returns).toHaveLength(1);

    const after = dispatch(state, returns[0].action);
    // In hand, and no longer attached to Radagast.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === birdId)).toBe(true);
    const radagastId = findCharInstanceId(after, RESOURCE_PLAYER, RADAGAST_FW);
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].allies.some(a => a.instanceId === birdId)).toBe(false);
  });

  // ─── Returns to hand when its controlling character leaves active play ──────

  test('returns to hand (not discard) when its controlling character is eliminated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [RADAGAST_FW] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withBird = attachAllyToChar(base, RESOURCE_PLAYER, RADAGAST_FW, BLACK_BIRD);
    const birdId = blackBirdOn(withBird);
    const radagastId = findCharInstanceId(withBird, RESOURCE_PLAYER, RADAGAST_FW);
    const wounded = setCharStatus(withBird, RESOURCE_PLAYER, RADAGAST_FW, CardStatus.Inverted);
    const ready = {
      ...wounded,
      combat: makeBodyCheckCombat({ companyId: companyIdAt(withBird, RESOURCE_PLAYER), characterId: radagastId }),
      cheatRollTotal: 12,
    };

    const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);

    // Radagast eliminated…
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === radagastId)).toBe(true);
    // …and the Black Bird returned to hand, not discarded.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === birdId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === birdId)).toBe(false);
  });
});
