/**
 * @module le-159.test
 *
 * Card test: A Malady Without Healing (le-159)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Shadow-magic.
 *
 * Card text:
 *   "Magic. Shadow-magic. Playable during the site phase on a non-Ringwraith,
 *    non-Wizard character at the same site as a shadow-magic-using character you
 *    control. Target character must make a corruption check modified by -1
 *    followed by a body check (modified by +1 if tapped). If target character is
 *    a hero and is eliminated by these checks, you receive his kill marshalling
 *    points. Unless the shadow-magic-user is a Ringwraith, he makes a corruption
 *    check modified by -5. May target an opponent's character."
 *
 * Distinct rules:
 *   1. Site-phase play window (`play-window` phase site).
 *   2. Play-target: a non-Ringwraith, non-Wizard character, on EITHER side
 *      (`play-target` character, `targetSide: any`, filter excludes ringwraith
 *      and wizard races) — "May target an opponent's character".
 *   3. Play requires a shadow-magic user you control at the caster's site
 *      (`requiresControlledShadowMagicUser`): no controlled shadow-magic user in
 *      the acting company ⇒ not playable.
 *   4. Target makes a corruption check modified by -1 (`enqueue-corruption-check
 *      modifier -1`), rolled by the target's controller.
 *   5. …followed by a body check modified by +1 if tapped (`enqueue-body-check`
 *      → a single-target dice-check that eliminates on roll+mods > body).
 *   6. If a hero target is eliminated by these checks, the caster's player
 *      receives his kill marshalling points (`creditKillMpToController`).
 *   7. Unless the shadow-magic-user is a Ringwraith, the caster makes a
 *      corruption check modified by -5 (`enqueue-corruption-check target
 *      active-company-shadow-magic-user modifier -5`); a Ringwraith caster is
 *      exempt (no check).
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | Not playable without a controlled shadow-magic user in the company    | IMPLEMENTED |
 * | 2 | Playable targeting an opponent's non-RW/non-wizard character          | IMPLEMENTED |
 * | 3 | Ringwraith / Wizard characters are NOT eligible targets               | IMPLEMENTED |
 * | 4 | Opponent's character not at the caster's site is NOT targetable       | IMPLEMENTED |
 * | 5 | Play enqueues target CC (-1) + body check + caster CC (-5)             | IMPLEMENTED |
 * | 6 | The target's corruption check is rolled by the target's controller    | IMPLEMENTED |
 * | 7 | Body check gains +1 when the target is tapped                          | IMPLEMENTED |
 * | 8 | Ringwraith caster makes NO -5 corruption check                        | IMPLEMENTED |
 * | 9 | Body check eliminates a hero target on a high roll → caster kill MP    | IMPLEMENTED |
 * | 10| Corruption check eliminates a hero target → caster kill MP            | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   MALADY (le-159)      - minion short event (this card)
 *   CIRYAHER (le-6)      - minion character, non-Ringwraith shadow-magic user (caster; makes -5 check)
 *   WITCH_KING (le-58)   - Ringwraith shadow-magic user (caster; exempt from -5 check)
 *   GORBAG (le-11)       - orc minion, NO shadow-magic (fails the caster gate; own non-RW target)
 *   LEGOLAS (tw-168)     - hero character (opponent victim; mind 6, body 8)
 *   GANDALF (tw-156)     - wizard character (excluded target)
 *   ARKENSTONE (le-418)  - greater item, 3 corruption points (raises the victim's CP)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, executeAction, attachItemToChar, recomputeDerived,
  viableActions, findHandCardId, getCharacter,
  PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, SitePhaseState,
} from '../../index.js';
import { Alignment, CardStatus } from '../../index.js';

const MALADY = 'le-159' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;
const WITCH_KING = 'le-58' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const ARKENSTONE = 'le-418' as CardDefinitionId;

const SHARED_SITE = 'tw-412' as CardDefinitionId; // Minas Tirith (free-hold)
const AWAY_SITE = 'le-411' as CardDefinitionId;    // Variag Camp (border-hold)
const MINION_SITE_DECK = 'le-390' as CardDefinitionId;

type CharEntry = CardDefinitionId | { defId: CardDefinitionId; status: CardStatus };

/**
 * Site-phase state: PLAYER_1 (minion) is the active caster company at
 * SHARED_SITE; PLAYER_2 (hero) has a company at `heroSite` (default the same
 * site). le-159 sits in PLAYER_1's hand.
 */
function maladyState(opts: {
  minionChars: CharEntry[];
  heroChars?: CharEntry[];
  heroSite?: CardDefinitionId;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: SHARED_SITE, characters: opts.minionChars }],
        hand: [MALADY],
        siteDeck: [MINION_SITE_DECK],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: opts.heroSite ?? SHARED_SITE, characters: opts.heroChars ?? [] }],
        hand: [],
        siteDeck: [MINION_SITE_DECK],
      },
    ],
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...state, phaseState: sitePhaseState };
}

/** All viable le-159 play actions, with their chosen target character. */
function maladyActions(state: GameState): PlayShortEventAction[] {
  const inst = findHandCardId(state, RESOURCE_PLAYER, MALADY);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === inst);
}

/** The le-159 play action targeting a specific character instance. */
function maladyActionForTarget(state: GameState, targetId: CardInstanceId): PlayShortEventAction | undefined {
  return maladyActions(state).find(a => a.targetCharacterId === targetId);
}

describe('A Malady Without Healing (le-159)', () => {
  beforeEach(() => resetMint());

  // ── Caster gate: shadow-magic user you control ───────────────────────────

  test('not playable without a controlled shadow-magic user in the acting company', () => {
    // Gorbag is an orc with no shadow-magic; Legolas is a valid victim, but the
    // caster requirement fails ⇒ no viable play action at all.
    const state = maladyState({ minionChars: [GORBAG], heroChars: [LEGOLAS] });
    expect(maladyActions(state)).toHaveLength(0);
  });

  test('playable once a controlled shadow-magic user (Ciryaher) is present', () => {
    const state = maladyState({ minionChars: [CIRYAHER], heroChars: [LEGOLAS] });
    expect(maladyActions(state).length).toBeGreaterThan(0);
  });

  // ── Play-target: cross-side, non-RW / non-wizard, same site ──────────────

  test("an opponent's non-Ringwraith, non-Wizard character at the same site is targetable", () => {
    const state = maladyState({ minionChars: [CIRYAHER], heroChars: [LEGOLAS] });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    expect(maladyActionForTarget(state, legolasId)).toBeDefined();
  });

  test('Ringwraith and Wizard characters are excluded as targets', () => {
    const state = maladyState({
      minionChars: [CIRYAHER, WITCH_KING],
      heroChars: [LEGOLAS, GANDALF],
    });
    const witchId = getCharacter(state, PLAYER_1, WITCH_KING).instanceId;
    const gandalfId = getCharacter(state, PLAYER_2, GANDALF).instanceId;
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;

    const targets = new Set(maladyActions(state).map(a => a.targetCharacterId));
    expect(targets.has(witchId)).toBe(false);   // Ringwraith excluded
    expect(targets.has(gandalfId)).toBe(false); // Wizard excluded
    expect(targets.has(legolasId)).toBe(true);  // hero victim included
  });

  test("an opponent's character NOT at the caster's site is not targetable", () => {
    const state = maladyState({
      minionChars: [CIRYAHER],
      heroChars: [LEGOLAS],
      heroSite: AWAY_SITE,
    });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    expect(maladyActionForTarget(state, legolasId)).toBeUndefined();
  });

  // ── Play enqueues the three checks ───────────────────────────────────────

  test('playing on a hero victim enqueues target CC (-1), a body check, and caster CC (-5)', () => {
    const state = maladyState({ minionChars: [CIRYAHER], heroChars: [LEGOLAS] });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    const ciryaherId = getCharacter(state, PLAYER_1, CIRYAHER).instanceId;
    const after = dispatch(state, maladyActionForTarget(state, legolasId)!);

    const ccs = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    const bodyChecks = after.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(bodyChecks).toHaveLength(1);

    // Target corruption check: on Legolas, -1, rolled by the target's controller.
    const targetCC = ccs.find(r => (r.kind as { characterId?: CardInstanceId }).characterId === legolasId);
    expect(targetCC).toBeDefined();
    expect((targetCC!.kind as { modifier: number }).modifier).toBe(-1);
    expect(targetCC!.actor).toBe(PLAYER_2);

    // Caster corruption check: on Ciryaher, -5, rolled by the caster's player.
    const casterCC = ccs.find(r => (r.kind as { characterId?: CardInstanceId }).characterId === ciryaherId);
    expect(casterCC).toBeDefined();
    expect((casterCC!.kind as { modifier: number }).modifier).toBe(-5);
    expect(casterCC!.actor).toBe(PLAYER_1);

    // Body check: on Legolas, rolled by the target's controller, threshold = body.
    const bc = bodyChecks[0];
    expect(bc.actor).toBe(PLAYER_2);
    const bk = bc.kind as { threshold: number; comparison: string; targetCharacterId: CardInstanceId; modifiers: readonly { kind: string; value: number }[] };
    expect(bk.targetCharacterId).toBe(legolasId);
    expect(bk.comparison).toBe('gt');
    expect(bk.threshold).toBe(8); // Legolas body
    expect(bk.modifiers).toHaveLength(0); // untapped ⇒ no +1
  });

  test('body check gains +1 when the target is tapped', () => {
    const state = maladyState({
      minionChars: [CIRYAHER],
      heroChars: [{ defId: LEGOLAS, status: CardStatus.Tapped }],
    });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    const after = dispatch(state, maladyActionForTarget(state, legolasId)!);

    const bc = after.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(bc).toBeDefined();
    const mods = (bc!.kind as { modifiers: readonly { kind: string; value: number }[] }).modifiers;
    expect(mods).toContainEqual({ kind: 'constant', value: 1 });
  });

  // ── Ringwraith caster: no -5 check ───────────────────────────────────────

  test('a Ringwraith caster (Witch-king) makes NO corruption check', () => {
    const state = maladyState({ minionChars: [WITCH_KING], heroChars: [LEGOLAS] });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    const after = dispatch(state, maladyActionForTarget(state, legolasId)!);

    const ccs = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    // Only the target's -1 check; no caster check (Witch-king is a Ringwraith).
    expect(ccs).toHaveLength(1);
    expect((ccs[0].kind as { characterId: CardInstanceId }).characterId).toBe(legolasId);
    expect(after.pendingResolutions.some(r => r.kind.type === 'dice-check')).toBe(true);
  });

  // ── Kill MP: hero eliminated by these checks ─────────────────────────────

  test('body check eliminates a hero on a high roll → caster receives his kill MP', () => {
    const state = maladyState({ minionChars: [WITCH_KING], heroChars: [LEGOLAS] });
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;
    let s = dispatch(state, maladyActionForTarget(state, legolasId)!);

    // Target survives the -1 corruption check (Legolas CP 0 → any roll passes).
    s = executeAction(s, PLAYER_2, 'corruption-check', 8);
    expect(s.players[PLAYER_2].characters[legolasId as string]).toBeDefined();

    // Body check: roll 12 > body 8 → Legolas eliminated.
    s = executeAction(s, PLAYER_2, 'resolve-dice-check', 12);
    expect(s.players[PLAYER_2].characters[legolasId as string]).toBeUndefined();

    // Eliminated hero credited to the caster's (minion) out-of-play pile, scoring
    // kill MP equal to his mind (6); the hero owner scores nothing.
    const recomputed = recomputeDerived(s);
    expect(recomputed.players[PLAYER_1].outOfPlayPile.some(c => c.instanceId === legolasId)).toBe(true);
    expect(recomputed.players[PLAYER_1].marshallingPoints.kill).toBe(6);
    expect(recomputed.players[PLAYER_2].marshallingPoints.kill).toBe(0);
  });

  test('corruption check eliminates a corrupt hero → caster receives his kill MP', () => {
    let state = maladyState({ minionChars: [WITCH_KING], heroChars: [LEGOLAS] });
    // Give Legolas 3 corruption points so a low roll fails the -1 check lethally.
    state = attachItemToChar(state, PLAYER_2, LEGOLAS, ARKENSTONE);
    state = recomputeDerived(state);
    const legolasId = getCharacter(state, PLAYER_2, LEGOLAS).instanceId;

    let s = dispatch(state, maladyActionForTarget(state, legolasId)!);
    // Corruption check: roll 2 + (-1) = 1, well below CP 3 → hero eliminated.
    s = executeAction(s, PLAYER_2, 'corruption-check', 2);
    expect(s.players[PLAYER_2].characters[legolasId as string]).toBeUndefined();

    const recomputed = recomputeDerived(s);
    expect(recomputed.players[PLAYER_1].outOfPlayPile.some(c => c.instanceId === legolasId)).toBe(true);
    expect(recomputed.players[PLAYER_1].marshallingPoints.kill).toBe(6);
  });
});
