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
 *   1. Play-window — site phase only (`play-window` phase: "site").
 *   2. Play-target — a `play-target` (character, `targetScope: "any-player"`,
 *      `requiresControlledShadowMagicUserAtSite`) filtered to exclude Ringwraith
 *      and Wizard races. A candidate qualifies only when the acting player
 *      controls a shadow-magic user (a Ringwraith, or a character with the
 *      `shadow-magic` skill) in a company at the candidate's current site — a
 *      different character than the candidate. The target may be an opponent's.
 *   3. Target corruption check — a `malady-without-healing` apply enqueues a
 *      corruption check (modifier -1) on the target, rolled by the target's
 *      controller, carrying `awardKillMpTo` (the caster).
 *   4. Follow-up body check — if the target survives the corruption check, the
 *      caster rolls a standalone body check (modified +1 if the target is
 *      tapped/wounded); a modified roll exceeding the target's body eliminates
 *      the character (CoE 3.I.2.1).
 *   5. Kill MP — a *hero* target eliminated by either check credits the caster
 *      the hero's marshalling points as kill MP (`bonusKillMarshallingPoints`,
 *      folded into `mp.kill`).
 *   6. Caster's cost — unless the caster's co-located shadow-magic user is a
 *      Ringwraith, that user makes a corruption check modified by -5.
 *
 * Rule coverage:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Playable in site phase on a co-located opponent hero                     | IMPLEMENTED |
 * | 2 | Not playable when the shadow-magic user is at a different site           | IMPLEMENTED |
 * | 3 | Not playable when no co-located character can use shadow-magic           | IMPLEMENTED |
 * | 4 | Ringwraith and Wizard characters are excluded as targets                | IMPLEMENTED |
 * | 5 | Not offered during the organization phase                               | IMPLEMENTED |
 * | 6 | Target corruption check (-1) enqueued for the target's controller       | IMPLEMENTED |
 * | 7 | Non-Ringwraith shadow-magic user makes a -5 corruption check             | IMPLEMENTED |
 * | 8 | Ringwraith shadow-magic user makes NO corruption check                  | IMPLEMENTED |
 * | 9 | Surviving hero fails the body check → eliminated, caster gets kill MP    | IMPLEMENTED |
 * |10 | Surviving hero passes the body check → survives, no kill MP             | IMPLEMENTED |
 * |11 | The body check is +1 when the target is tapped                          | IMPLEMENTED |
 * |12 | Hero eliminated by the corruption check → kill MP, no body check         | IMPLEMENTED |
 * |13 | Co-location across the hero/minion versions of one site                 | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   MALADY (le-159)     - minion short event (this card)
 *   ADUNAPHEL (le-50)   - Ringwraith shadow-magic user (caster's enabler; no -5)
 *   CIRYAHER (le-6)     - non-Ringwraith (Dúnadan) shadow-magic user (-5 enabler)
 *   GORBAG (le-11)      - Orc minion, NOT a shadow-magic user
 *   LEGOLAS (tw-168)    - hero target (Elf, body 8, 2 marshalling points, no corruption bonus)
 *   GANDALF (tw-156)    - Wizard avatar (excluded target)
 *   PALANTIR (tw-296)   - Palantír of Amon Sûl, item worth 3 corruption points
 *   SITE / SITE_B       - minion sites used to place / separate companies
 *   RIVENDELL_MINION (as-160) / RIVENDELL_HERO (tw-421) - the two alignment
 *                         versions of one physical location, used to check that
 *                         co-location is matched by site name, not card id
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, executeAction, viableActions,
  findCharInstanceId, findHandCardId, getCharacter, expectInPile,
  PLAYER_1, PLAYER_2, Phase,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, SitePhaseState, PlayShortEventAction } from '../../index.js';
import { Alignment, CardStatus } from '../../index.js';

const MALADY = 'le-159' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const PALANTIR = 'tw-296' as CardDefinitionId;
const SITE = 'le-367' as CardDefinitionId;
const SITE_B = 'le-390' as CardDefinitionId;
const RIVENDELL_MINION = 'as-160' as CardDefinitionId;
const RIVENDELL_HERO = 'tw-421' as CardDefinitionId;

/** A play-resources SitePhaseState with the first company active. */
const SITE_PHASE_STATE: SitePhaseState = {
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

/**
 * Build a site-phase state: a Ringwraith caster (P1) at `casterSite` with the
 * given characters and le-159 in hand, and a Wizard (hero) opponent (P2) at
 * `targetSite` with the given characters.
 */
type Build = {
  casterChars: CardDefinitionId[];
  targetChars: Array<CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[]; status?: CardStatus }>;
  casterSite?: CardDefinitionId;
  targetSite?: CardDefinitionId;
  phase?: Phase;
};

function build(opts: Build): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    phase: opts.phase ?? Phase.Site,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.casterSite ?? SITE, characters: opts.casterChars }],
        hand: [MALADY],
        siteDeck: [SITE],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: opts.targetSite ?? SITE, characters: opts.targetChars }],
        hand: [],
        siteDeck: [SITE],
      },
    ],
  });
  return (opts.phase ?? Phase.Site) === Phase.Site
    ? { ...state, phaseState: SITE_PHASE_STATE }
    : state;
}

/** Viable le-159 play actions targeting a specific character instance. */
function maladyActionsForTarget(state: GameState, targetId: CardInstanceId): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.targetCharacterId === targetId);
}

/** Play le-159 targeting `targetId`. */
function playMalady(state: GameState, targetId: CardInstanceId): GameState {
  const inst = findHandCardId(state, 0, MALADY);
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: inst,
    targetCharacterId: targetId,
  });
}

describe('A Malady Without Healing (le-159)', () => {
  beforeEach(() => resetMint());

  // ── Playability / targeting ──────────────────────────────────────────────

  test('playable in the site phase on a co-located opponent hero', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    expect(maladyActionsForTarget(state, legolasId)).toHaveLength(1);
  });

  test('not playable when the controlled shadow-magic user is at a different site than the target', () => {
    const state = build({
      casterChars: [ADUNAPHEL], targetChars: [LEGOLAS],
      casterSite: SITE_B, targetSite: SITE,
    });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    expect(maladyActionsForTarget(state, legolasId)).toHaveLength(0);
    // The card offers no viable play at all (its only target is unreachable).
    const inst = findHandCardId(state, 0, MALADY);
    const anyPlay = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === inst);
    expect(anyPlay).toHaveLength(0);
  });

  test('targets an opponent standing at the other alignment version of the same site', () => {
    // The caster's company holds minion Rivendell (as-160) while the opponent
    // holds hero Rivendell (tw-421). Both are the same physical location
    // (rule g.site.1), so the shadow-magic user is co-located with the target.
    const state = build({
      casterChars: [CIRYAHER], targetChars: [LEGOLAS],
      casterSite: RIVENDELL_MINION, targetSite: RIVENDELL_HERO,
    });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    expect(maladyActionsForTarget(state, legolasId)).toHaveLength(1);

    // Playing it splits the checks between the two players: the opponent rolls
    // the target's -1 check, the caster rolls his shadow-magic user's -5 check.
    const after = playMalady(state, legolasId);
    const ciryaherId = findCharInstanceId(state, 0, CIRYAHER);
    const targetCheck = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === legolasId,
    );
    expect(targetCheck?.actor).toBe(PLAYER_2);
    const casterCheck = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === ciryaherId,
    );
    expect(casterCheck?.actor).toBe(PLAYER_1);
    expect((casterCheck!.kind as { modifier: number }).modifier).toBe(-5);
  });

  test('not playable when no co-located character can use shadow-magic', () => {
    // Gorbag (Orc warrior/scout) is not a shadow-magic user, so he cannot
    // enable the malady even though he is co-located with the hero target.
    const state = build({ casterChars: [GORBAG], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    expect(maladyActionsForTarget(state, legolasId)).toHaveLength(0);
  });

  test('excludes Ringwraith and Wizard characters as targets', () => {
    // Co-located: caster's Ringwraith (Adûnaphel) enables the card; the hero
    // (Bilbo) is a legal target, but neither the Ringwraith nor the Wizard
    // (Gandalf) may be targeted.
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS, GANDALF] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    const gandalfId = findCharInstanceId(state, 1, GANDALF);
    const adunId = findCharInstanceId(state, 0, ADUNAPHEL);

    expect(maladyActionsForTarget(state, legolasId)).toHaveLength(1);
    expect(maladyActionsForTarget(state, gandalfId)).toHaveLength(0);
    expect(maladyActionsForTarget(state, adunId)).toHaveLength(0);
  });

  test('not offered during the organization phase', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS], phase: Phase.Organization });
    const inst = findHandCardId(state, 0, MALADY);
    const anyPlay = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === inst);
    expect(anyPlay).toHaveLength(0);
  });

  // ── Corruption checks enqueued on play ────────────────────────────────────

  test('enqueues a -1 corruption check on the target, rolled by its controller, crediting the caster', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    const after = playMalady(state, legolasId);

    const targetCheck = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === legolasId,
    );
    expect(targetCheck).toBeDefined();
    expect(targetCheck!.actor).toBe(PLAYER_2); // rolled by the target's controller
    const kind = targetCheck!.kind as { modifier: number; awardKillMpTo?: string };
    expect(kind.modifier).toBe(-1);
    expect(kind.awardKillMpTo).toBe(PLAYER_1); // caster receives kill MP
  });

  test('the non-Ringwraith shadow-magic user makes a -5 corruption check', () => {
    const state = build({ casterChars: [CIRYAHER], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    const ciryaherId = findCharInstanceId(state, 0, CIRYAHER);
    const after = playMalady(state, legolasId);

    const casterCheck = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === ciryaherId,
    );
    expect(casterCheck).toBeDefined();
    expect(casterCheck!.actor).toBe(PLAYER_1);
    expect((casterCheck!.kind as { modifier: number }).modifier).toBe(-5);
  });

  test('a Ringwraith shadow-magic user makes NO corruption check', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    const after = playMalady(state, legolasId);

    // The only corruption check queued is the target's, not one for the caster.
    const casterChecks = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check' && r.actor === PLAYER_1,
    );
    expect(casterChecks).toHaveLength(0);
  });

  // ── The checks: body check, elimination, kill MP ─────────────────────────

  test('a surviving hero that fails the body check is eliminated and credits the caster his kill MP', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    let s = playMalady(state, legolasId);

    // Target survives the corruption check (Legolas has 0 CP; roll 12, mod -1 → 11).
    s = executeAction(s, PLAYER_2, 'corruption-check', 12);
    expect(getCharacter(s, 1, LEGOLAS)).toBeDefined();

    // The body check is now queued for the caster; body 8 untapped → eliminate
    // on a modified roll > 8. Roll 12 eliminates Legolas.
    const bodyCheck = s.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(bodyCheck).toBeDefined();
    expect(bodyCheck!.actor).toBe(PLAYER_1);

    s = executeAction(s, PLAYER_1, 'resolve-dice-check', 12);

    expect(s.players[1].characters[legolasId]).toBeUndefined();
    expectInPile(s, 1, 'outOfPlayPile', LEGOLAS);
    expect(s.players[0].bonusKillMarshallingPoints).toBe(2); // Legolas's MP
    expect(s.players[0].marshallingPoints.kill).toBe(2);
  });

  test('a hero that passes the body check survives and awards no kill MP', () => {
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    let s = playMalady(state, legolasId);

    s = executeAction(s, PLAYER_2, 'corruption-check', 12); // survives
    // Untapped body 8: a modified roll of 8 is NOT greater than 8 → survives.
    s = executeAction(s, PLAYER_1, 'resolve-dice-check', 8);

    expect(s.players[1].characters[legolasId]).toBeDefined();
    expect(s.players[0].bonusKillMarshallingPoints ?? 0).toBe(0);
    expect(s.players[0].marshallingPoints.kill).toBe(0);
  });

  test('the body check is modified by +1 when the target is tapped', () => {
    // The same roll (8) that a body-8 untapped hero survives instead eliminates
    // a tapped hero, because the +1-if-tapped modifier makes 8 + 1 = 9 > 8.
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [{ defId: LEGOLAS, status: CardStatus.Tapped }] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    let s = playMalady(state, legolasId);

    s = executeAction(s, PLAYER_2, 'corruption-check', 12); // survives corruption
    s = executeAction(s, PLAYER_1, 'resolve-dice-check', 8); // 8 + 1 (tapped) > 8

    expect(s.players[1].characters[legolasId]).toBeUndefined();
    expectInPile(s, 1, 'outOfPlayPile', LEGOLAS);
    expect(s.players[0].marshallingPoints.kill).toBe(2);
  });

  test('a hero eliminated by the corruption check credits the caster kill MP and makes no body check', () => {
    // Legolas bears the Palantír of Amon Sûl (3 corruption points); a -1 check
    // that rolls 2 → total 1, two below CP 3 → eliminated (out of play).
    const state = build({ casterChars: [ADUNAPHEL], targetChars: [{ defId: LEGOLAS, items: [PALANTIR] }] });
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    let s = playMalady(state, legolasId);

    s = executeAction(s, PLAYER_2, 'corruption-check', 2);

    expect(s.players[1].characters[legolasId]).toBeUndefined();
    expectInPile(s, 1, 'outOfPlayPile', LEGOLAS);
    expect(s.players[0].marshallingPoints.kill).toBe(2);
    // No follow-up body check is queued once the target is already eliminated.
    expect(s.pendingResolutions.some(r => r.kind.type === 'dice-check')).toBe(false);
  });
});
