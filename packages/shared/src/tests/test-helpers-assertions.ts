/**
 * @module test-helpers-assertions
 *
 * Assertion helpers used across the test suite: pile/hand membership checks
 * (expectInHand/expectNotInHand/expectInPile/expectNotInPile/expectInDiscardPile/
 * expectNotInDiscardPile), character checks (expectCharInPlay, expectCharNotInPlay,
 * expectCharStatus, expectCharItemCount), the shared getCharacter lookup they
 * build on, and the assertEveryInstanceReachable invariant check. Split out of
 * test-helpers.ts (re-exported from the barrel); imports only engine modules and
 * the query/constant base layers, so nothing imports it back (no cycle).
 */

import { expect } from 'vitest';
import { createGame } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import { effectiveGeneralInfluence, generalInfluenceControlLimit } from '../engine/reducer-utils.js';
import { Phase, Alignment } from '../index.js';
import type { GameState, CardDefinitionId, CardInstanceId, CardInstance, SitePhaseState, OpponentInfluenceAttemptAction, LongEventPhaseState, CreatureKeyingMatch, CompanyId, CardInPlay, CharacterInPlay, AllyInPlay } from '../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS } from '../index.js';
import type { EvaluatedAction } from '../rules/types.js';
import { resolveInstanceId } from '../types/state.js';
import { ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR, EOWYN, BEREGOND, BARD_BOWMAN, ANBORN, SAM_GAMGEE, FATTY_BOLGER, PEATH, THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI, SARUMAN, IORETH, GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING, HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, SAPLING_OF_THE_WHITE_TREE, GWAIHIR, TREEBEARD, ASSASSIN, CAVE_DRAKE, ORC_GUARD, ORC_WARBAND, ORC_LIEUTENANT, ORC_PATROL, ORC_WATCH, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, HOBGOBLINS, FOOLISH_WORDS, LURE_OF_THE_SENSES, ALONE_AND_UNADVISED, LOST_IN_FREE_DOMAINS, STEALTH, RIVER, SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS, CONCEALMENT, DODGE, DARK_QUARRELS, HALFLING_STRENGTH, MARVELS_TOLD, LITTLE_SNUFFLER, AND_FORTH_HE_HASTENED, WIZARDS_LAUGHTER, VANISHMENT, AN_UNEXPECTED_OUTPOST, TWO_OR_THREE_TRIBES_PRESENT, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR, DUNNISH_CLAN_HOLD, HENNETH_ANNUN, LOND_GALEN, TOLFALAS, EDHELLOND, WELLINGHALL, ISENGARD, WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN, MEN_OF_ANFALAS, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RANGERS_OF_ITHILIEN, RIDERS_OF_ROHAN, DUNLENDINGS } from '../index.js';
import type { PileKey } from './test-helpers-constants.js';
import { findCharInstanceId, findInPile } from './test-helpers-queries.js';

/** Assert the given instance ID is currently in the player's hand. */
export function expectInHand(
  state: GameState,
  playerIdx: number,
  instanceId: CardInstanceId,
): void {
  expect(state.players[playerIdx].hand.find(c => c.instanceId === instanceId)).toBeDefined();
}

/** Assert the given instance ID is NOT in the player's hand (moved/discarded). */
export function expectNotInHand(
  state: GameState,
  playerIdx: number,
  instanceId: CardInstanceId,
): void {
  expect(state.players[playerIdx].hand.find(c => c.instanceId === instanceId)).toBeUndefined();
}

/** Get the {@link CharacterInPlay} object for a character by definition ID. */
export function getCharacter(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): CharacterInPlay {
  const id = findCharInstanceId(state, playerIdx, defId);
  return state.players[playerIdx].characters[id];
}

/** Assert a character (located by definition ID) currently has the expected status. */
export function expectCharStatus(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
  expected: CardStatus,
): void {
  expect(getCharacter(state, playerIdx, defId).status).toBe(expected);
}

/** Get the {@link AllyInPlay} object for an ally (located by definition ID) attached to a character. */
export function getAlly(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  allyDefId: CardDefinitionId,
): AllyInPlay {
  const ally = getCharacter(state, playerIdx, charDefId).allies.find(a => a.definitionId === allyDefId);
  if (!ally) throw new Error(`Ally ${allyDefId as string} not found on character ${charDefId as string}`);
  return ally;
}

/** Assert an ally (located by definition ID) attached to a character has the expected status. */
export function expectAllyStatus(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  allyDefId: CardDefinitionId,
  expected: CardStatus,
): void {
  expect(getAlly(state, playerIdx, charDefId, allyDefId).status).toBe(expected);
}

/** Assert a character (located by definition ID) has the expected number of items. */
export function expectCharItemCount(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
  expected: number,
): void {
  expect(getCharacter(state, playerIdx, defId).items).toHaveLength(expected);
}

/**
 * Assert a card is in the given pile for the player, matched by either
 * definition or instance ID.
 */
export function expectInPile(
  state: GameState,
  playerIdx: number,
  pile: PileKey,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  const found = findInPile(state, playerIdx, pile, idOrDefId);
  expect(found).toBeDefined();
}

/**
 * Assert a card is in the player's discard pile, matched by either
 * definition or instance ID. Short-hand for the most common
 * {@link expectInPile} call.
 */
export function expectInDiscardPile(
  state: GameState,
  playerIdx: number,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  expectInPile(state, playerIdx, 'discardPile', idOrDefId);
}

/**
 * Assert a card is NOT in the given pile for the player, matched by either
 * definition or instance ID.
 */
export function expectNotInPile(
  state: GameState,
  playerIdx: number,
  pile: PileKey,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  const found = findInPile(state, playerIdx, pile, idOrDefId);
  expect(found).toBeUndefined();
}

/**
 * Assert a card is NOT in the player's discard pile, matched by either
 * definition or instance ID. Short-hand for the most common
 * {@link expectNotInPile} call.
 */
export function expectNotInDiscardPile(
  state: GameState,
  playerIdx: number,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  expectNotInPile(state, playerIdx, 'discardPile', idOrDefId);
}

// ─── Convenience state mutations ───────────────────────────────────────────

/** Assert a character (by instance ID) is present in the player's characters map. */
export function expectCharInPlay(
  state: GameState,
  playerIdx: number,
  charId: CardInstanceId,
): void {
  expect(state.players[playerIdx].characters[charId]).toBeDefined();
}

/** Assert a character (by instance ID) has been removed from the player's characters map. */
export function expectCharNotInPlay(
  state: GameState,
  playerIdx: number,
  charId: CardInstanceId,
): void {
  expect(state.players[playerIdx].characters[charId]).toBeUndefined();
}

/**
 * Invariant check for "no card instance may ever disappear": independently walk
 * every gameplay zone that can hold a {@link CardInstance} and assert
 * {@link resolveInstanceId} resolves each one back to its definition id. This is
 * an independent oracle (a separate walk, not a call into the resolver's own
 * enumeration), so it fails if the resolver stops covering a zone — the class of
 * bug that left trophies unreachable. Call it on any post-action state in a test
 * to assert the invariant holds there.
 */
export function assertEveryInstanceReachable(state: GameState): void {
  const found: { id: CardInstanceId; defId: CardDefinitionId; where: string }[] = [];
  const add = (c: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId } | null | undefined, where: string): void => {
    if (c) found.push({ id: c.instanceId, defId: c.definitionId, where });
  };
  const addAll = (cards: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[], where: string): void => {
    for (const c of cards) add(c, where);
  };

  for (const p of state.players) {
    for (const ch of Object.values(p.characters)) {
      add(ch, 'character');
      addAll(ch.items, 'item');
      addAll(ch.allies, 'ally');
      addAll(ch.hazards, 'char-hazard');
      addAll(ch.trophies ?? [], 'trophy');
    }
    addAll(p.cardsInPlay, 'cardsInPlay');
    for (const co of p.companies) {
      add(co.currentSite, 'currentSite');
      add(co.destinationSite, 'destinationSite');
      addAll(co.onGuardCards, 'onGuard');
      addAll(co.hazards, 'company-hazard');
    }
    for (const a of p.agents) {
      add(a.character, 'agent');
      addAll(a.character.items, 'agent-item');
      addAll(a.character.allies, 'agent-ally');
      addAll(a.character.hazards, 'agent-hazard');
      addAll(a.character.trophies ?? [], 'agent-trophy');
      addAll(a.siteStack, 'agent-site');
    }
    addAll(p.hand, 'hand');
    addAll(p.playDeck, 'playDeck');
    addAll(p.discardPile, 'discardPile');
    addAll(p.siteDeck, 'siteDeck');
    addAll(p.siteDiscardPile, 'siteDiscardPile');
    addAll(p.sideboard, 'sideboard');
    addAll(p.killPile, 'killPile');
    addAll(p.outOfPlayPile, 'outOfPlayPile');
    for (const r of p.reservedCreatures) add(r.creature, 'reservedCreature');
  }
  if (state.chain) {
    for (const e of state.chain.entries) add(e.card, 'chain');
  }
  for (const h of state.hazardHosts) {
    add(h.hostCard, 'hazardHost.hostCard');
    add(h.rescueSiteCard, 'hazardHost.rescueSiteCard');
  }

  for (const { id, defId, where } of found) {
    expect(
      resolveInstanceId(state, id),
      `instance ${id as string} (held in ${where}) must be resolvable — no card instance may disappear`,
    ).toBe(defId);
  }
}

// Re-export commonly used things
export {
  createGame, reduce,
  Phase, Alignment,
  ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BARD_BOWMAN, ANBORN, SAM_GAMGEE, FATTY_BOLGER, PEATH,
  THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI,
  SARUMAN, IORETH,
  GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING, HAUBERK_OF_BRIGHT_MAIL,
  CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, SAPLING_OF_THE_WHITE_TREE,
  GWAIHIR, TREEBEARD,
  ASSASSIN, CAVE_DRAKE, ORC_GUARD, ORC_WARBAND, ORC_LIEUTENANT, ORC_PATROL, ORC_WATCH, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, HOBGOBLINS, FOOLISH_WORDS, LURE_OF_THE_SENSES, ALONE_AND_UNADVISED, LOST_IN_FREE_DOMAINS, STEALTH, RIVER,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS, CONCEALMENT, DODGE, DARK_QUARRELS, HALFLING_STRENGTH, MARVELS_TOLD, LITTLE_SNUFFLER, AND_FORTH_HE_HASTENED, WIZARDS_LAUGHTER, VANISHMENT,
  AN_UNEXPECTED_OUTPOST, TWO_OR_THREE_TRIBES_PRESENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR, DUNNISH_CLAN_HOLD, HENNETH_ANNUN, LOND_GALEN, TOLFALAS, EDHELLOND, WELLINGHALL, ISENGARD,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN, MEN_OF_ANFALAS, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RANGERS_OF_ITHILIEN, RIDERS_OF_ROHAN, DUNLENDINGS,
  CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS,
  effectiveGeneralInfluence, generalInfluenceControlLimit,
};
export type { GameConfig, QuickStartGameConfig, ReducerResult, CardInPlay, CardInstance, CardInstanceId, CardDefinitionId, CompanyId, OpponentInfluenceAttemptAction, SitePhaseState, LongEventPhaseState, CreatureKeyingMatch, EvaluatedAction };
