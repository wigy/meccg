/**
 * @module as-50.test
 *
 * Card test: Mount Slain (as-50)
 * Type: hero-resource-event, subtype Permanent-event, alignment wizard,
 * non-unique. Marshalling points: 2 (miscellaneous).
 *
 * Card text: "Playable during any player's turn if a strike against one of
 * your companies from a Ringwraith attack or Nazgûl creature fails. If
 * still in active play following its body check, discard the Ringwraith."
 *
 * Rule interpretation ("the Ringwraith" — no CRF ruling exists for this
 * card): "a Ringwraith attack" (a CvCC strike delivered by a ringwraith-race
 * attacking character) and "a Nazgûl creature" (a ringwraith-race
 * hazard-creature attack) are the two ways a ringwraith-race strike can
 * reach a company. "The Ringwraith" (definite article, no antecedent when
 * the trigger is a Nazgûl creature) is the idiom used throughout the AS/LE/WH
 * pool for a minion player's own singular revealed Ringwraith avatar (e.g.
 * Morgul-blade le-205: "your Ringwraith"; Helm of Fear as-126: "the
 * Ringwraith's company") — not necessarily the specific creature/character
 * that delivered the failed strike. The card therefore always resolves
 * against the opponent's avatar, found programmatically
 * ({@link findPlayerAvatar}), regardless of which ringwraith-race source
 * triggered the window.
 *
 * Distinct rules:
 *   1. Play-window — combat `after-attack`, gated on `attack.ringwraithStrikeFailed`
 *      (a strike delivered by a ringwraith-race attacker that did not wound —
 *      CoE 3.iv.7 `'success'`/`'survived'`/`'tie'`). Race is read from
 *      `combat.creatureRace` for creature-sourced attacks, or from the
 *      specific attacking character's definition for a CvCC strike.
 *   2. No player-chosen bearer — the card resolves automatically against the
 *      opponent's revealed Ringwraith avatar (`mount-slain` self-enters-play
 *      apply); it never attaches to anything.
 *   3. Body check — a standalone 2d6-vs-body check, rolled by the avatar's own
 *      controller; a roll exceeding its body eliminates it (CoE 3.I.2.1).
 *   4. Forced discard — if the avatar survives the body check, it is
 *      discarded anyway.
 *   5. No target — if the opponent has no revealed Ringwraith avatar in play,
 *      the card fizzles (still discarded, no further effect).
 *   6. The card itself never remains in play — it discards itself immediately
 *      on resolution.
 *
 * Playable: YES
 *
 * Fixtures:
 *   MOUNT_SLAIN (as-50)  - this card
 *   REN_RW (le-56)       - minion Ringwraith avatar (mind null, body 10, race ringwraith)
 *   AKHORAHIL (tw-4)     - Nazgûl hazard-creature (race ringwraith, prowess 16, body 9)
 *   ABDUCTOR (tw-1)      - Man hazard-creature (race man) — negative race control
 *   ARAGORN (tw-120)     - hero character facing the strikes (prowess 6, body 9)
 *   LOND_GALEN (tw-407)  - hero border-hold (company's home site)
 *   DOL_GULDUR (le-367)  - minion haven (Ren the Ringwraith's company site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  makeMHState,
  playCreatureHazardAndResolve, runCreatureCombat, resolveChain, executeAction,
  findCharInstanceId, findHandCardId, companyIdAt,
  viableActions, dispatch, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, PlayPermanentEventAction } from '../../index.js';

const MOUNT_SLAIN = 'as-50' as CardDefinitionId;
const REN_RW = 'le-56' as CardDefinitionId;
const AKHORAHIL = 'tw-4' as CardDefinitionId;
const ABDUCTOR = 'tw-1' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const LOND_GALEN = 'tw-407' as CardDefinitionId;
const LORIEN = 'tw-406' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/**
 * A hero company (moving, holding `heroHand`) faced by a minion hazard
 * player whose own company (holding Ren the Ringwraith, the avatar under
 * test) sits elsewhere, and whose hand holds `minionHand` (hazard creatures).
 * The hero's resolved M/H path runs through Harondor, satisfying the named-
 * region keying alternative shared by every Nazgûl creature.
 */
function mhBase(opts: {
  heroChars: CardDefinitionId[];
  heroHand?: CardDefinitionId[];
  minionChars: CardDefinitionId[];
  minionHand?: CardDefinitionId[];
  /**
   * 'harondor' (default) keys every Nazgûl creature via their named-region
   * alternative (regionNames only, no site-type requirement). 'border' keys
   * a plain border-hold creature like Abductor (regionTypes: border,
   * siteTypes: border-hold — both must hold on the resolved path/site).
   */
  path?: 'harondor' | 'border';
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: LOND_GALEN, characters: opts.heroChars }],
        hand: opts.heroHand ?? [],
        siteDeck: [LORIEN],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.minionChars }],
        hand: opts.minionHand ?? [],
        siteDeck: [MINAS_MORGUL],
      },
    ],
  });
  const phaseState = opts.path === 'border'
    ? makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Cardolan'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      })
    : makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Harondor'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Minas Morgul',
      });
  return { ...state, phaseState };
}

/** The after-attack offer queued for the hero player, if any. */
function offerFor(state: GameState) {
  return state.pendingResolutions.find(r => r.kind.type === 'post-attack-play-offer');
}

/**
 * Play `creature` against the hero company and fight the single strike out,
 * so the company has "faced" the attack (rule 8.03) and the after-attack
 * window has had its chance to open.
 *
 * `strikeRoll` is a raw 2d6 cheat total (2-12) — NOT a guaranteed-outcome
 * total. To reliably defeat a strike, pass `tapToFight: true` (full prowess,
 * no stay-untapped penalty) with `strikeRoll: 12`: 12 + prowess 6 = 18 beats
 * every creature prowess used in this file (16, 10).
 */
function faceCreature(
  state: GameState,
  creature: CardDefinitionId,
  struckChar: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
  tapToFight = false,
  keying: import('../../types/actions-movement-hazard.js').CreatureKeyingMatch = { method: 'region-name', value: 'Harondor' },
): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, creature);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const inCombat = playCreatureHazardAndResolve(state, PLAYER_2, cardId, companyId, keying);
  expect(inCombat.combat).not.toBeNull();
  return runCreatureCombat(inCombat, struckChar, strikeRoll, bodyRoll, tapToFight);
}

/** Play Mount Slain through the open after-attack window and resolve the chain. */
function playMountSlain(state: GameState): GameState {
  expect(offerFor(state)).toBeDefined();
  const play = viableActions(state, PLAYER_1, 'play-permanent-event').find(
    ea => (ea.action as PlayPermanentEventAction).cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, MOUNT_SLAIN),
  );
  expect(play).toBeDefined();
  expect((play!.action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
  return resolveChain(dispatch(state, play!.action));
}

describe('Mount Slain (as-50)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: the after-attack play window ──────────────────────────────────

  test('a parried strike from a Nazgûl creature opens the after-attack play window', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const after = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);

    expect(after.combat).toBeNull();
    const offer = offerFor(after);
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);
    const mountSlainId = findHandCardId(after, RESOURCE_PLAYER, MOUNT_SLAIN);
    expect(offer!.kind.type === 'post-attack-play-offer' && offer!.kind.cardInstanceIds).toContain(mountSlainId);
  });

  test('a strike that wounds the character does NOT open the window', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    // Aragorn loses the roll outright — the strike wounds him, so it did not fail.
    const after = faceCreature(state, AKHORAHIL, ARAGORN, 2, 2);

    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeUndefined();
  });

  test('a parried strike from a non-Ringwraith creature does NOT open the window', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [ABDUCTOR], path: 'border',
    });
    const after = faceCreature(state, ABDUCTOR, ARAGORN, 12, null, true, { method: 'region-type', value: 'border' });

    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeUndefined();
  });

  test('no window opens when the card is not in hand', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const after = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    expect(offerFor(after)).toBeUndefined();
  });

  test('the card is NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: LOND_GALEN, characters: [ARAGORN] }],
          hand: [MOUNT_SLAIN], siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [REN_RW] }],
          hand: [], siteDeck: [MINAS_MORGUL],
        },
      ],
    });
    const mountSlainId = findHandCardId(state, RESOURCE_PLAYER, MOUNT_SLAIN);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-permanent-event' && ea.action.cardInstanceId === mountSlainId,
    );
    expect(plays).toHaveLength(0);
  });

  test('the offer can be declined with pass, closing the window', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const faced = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    expect(offerFor(faced)).toBeDefined();

    const after = dispatch(faced, { type: 'pass', player: PLAYER_1 });
    expect(offerFor(after)).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MOUNT_SLAIN)).toBe(true);
    const renId = findCharInstanceId(after, HAZARD_PLAYER, REN_RW);
    expect(after.players[HAZARD_PLAYER].characters[renId]).toBeDefined();
  });

  // ── Rules 2–4: playing it forces a body check on the opponent's avatar ────

  test('playing the card discards itself immediately and enqueues a body check on the Ringwraith', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const faced = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    const after = playMountSlain(faced);

    // The card is gone from hand and sits in the hero's discard pile — it
    // never enters play.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MOUNT_SLAIN)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MOUNT_SLAIN)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, MOUNT_SLAIN);

    const renId = findCharInstanceId(after, HAZARD_PLAYER, REN_RW);
    const bodyCheck = after.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(bodyCheck).toBeDefined();
    expect(bodyCheck!.actor).toBe(PLAYER_2); // Ren's own controller rolls
    expect((bodyCheck!.kind as { targetCharacterId?: string }).targetCharacterId).toBe(renId);
    expect((bodyCheck!.kind as { threshold: number }).threshold).toBe(10); // Ren's body
  });

  test('a body check roll exceeding body eliminates the Ringwraith', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const faced = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    const played = playMountSlain(faced);
    const renId = findCharInstanceId(played, HAZARD_PLAYER, REN_RW);

    const after = executeAction(played, PLAYER_2, 'resolve-dice-check', 11); // 11 > body 10
    expect(after.players[HAZARD_PLAYER].characters[renId]).toBeUndefined();
    expectInDiscardPile(after, RESOURCE_PLAYER, MOUNT_SLAIN);
  });

  test('a body check roll not exceeding body still discards the Ringwraith', () => {
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [REN_RW], minionHand: [AKHORAHIL],
    });
    const faced = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    const played = playMountSlain(faced);
    const renId = findCharInstanceId(played, HAZARD_PLAYER, REN_RW);

    const after = executeAction(played, PLAYER_2, 'resolve-dice-check', 8); // 8 is not > body 10 — survives the check
    expect(after.players[HAZARD_PLAYER].characters[renId]).toBeUndefined(); // but is still discarded
    expectInDiscardPile(after, HAZARD_PLAYER, REN_RW);
  });

  // ── Rule 5: no target — fizzle ─────────────────────────────────────────────

  test('fizzles harmlessly when the opponent has no revealed Ringwraith avatar', () => {
    // Give the minion company a non-avatar character instead of Ren the Ringwraith.
    const LUITPRAND = 'le-23' as CardDefinitionId;
    const state = mhBase({
      heroChars: [ARAGORN], heroHand: [MOUNT_SLAIN],
      minionChars: [LUITPRAND], minionHand: [AKHORAHIL],
    });
    const faced = faceCreature(state, AKHORAHIL, ARAGORN, 12, 2, true);
    const after = playMountSlain(faced);

    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MOUNT_SLAIN)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, MOUNT_SLAIN);
    expect(after.pendingResolutions.some(r => r.kind.type === 'dice-check')).toBe(false);
  });
});
