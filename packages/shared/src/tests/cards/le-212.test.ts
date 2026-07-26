/**
 * @module le-212.test
 *
 * Card test: Not Slay Needlessly (le-212)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Card text:
 *   "Playable on an attack by Elves, Dwarves, Dúnedain, or Men. Against a
 *    covert company, the attack is canceled. Otherwise, -2 to the attack's
 *    prowess. Cannot be duplicated on a given attack."
 *
 * Effects:
 *   1. cancel-attack — when defender.covert AND enemy.race matches Elf/Dwarf/
 *      Dúnedain/Man.
 *   2. modify-attack (fromHand, defender, prowessModifier: -2) — when NOT
 *      defender.covert AND enemy.race matches Elf/Dwarf/Dúnedain/Man.
 *   3. duplication-limit (scope: attack, max: 1) — prevents a second copy from
 *      being played on the same attack.
 *
 * The race lists carry both the plural spellings used by hazard-creature card
 * data ("elves", "men") and the singular identifiers a site's automatic-attack
 * `creatureType` normalizes to ("elf", "man") — see `normalizeCreatureRace`.
 * Without the singular forms the card is silently unplayable on a site's
 * automatic-attack (e.g. Rivendell's "Elves — 4 strikes with 8 prowess").
 *
 * Covert/overt is computed from company composition (rule glossary):
 *   - Overt: contains Orc, Troll, or Balrog character, or an overt-marking ally.
 *   - Covert: none of the above.
 *
 * | # | Rule                                                      | Status  |
 * |---|-----------------------------------------------------------|---------|
 * | 1 | Race filter: only vs Elf/Dwarf/Dúnedain/Men attacks       | OK      |
 * | 2 | Covert company → cancel the attack                        | OK      |
 * | 3 | Non-covert → -2 to attack prowess                         | OK      |
 * | 4 | Cannot be duplicated on a given attack                    | OK      |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  RESOURCE_PLAYER,
  viableActions, dispatch,
  makeCancelWindowCombat,
  buildSitePhaseState, setupAutoAttackStep,
  expectInDiscardPile,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, ModifyAttackAction } from '../../index.js';

const NSN = 'le-212' as CardDefinitionId;

// Hazard creatures — LE pool, sorted by race.
const ELF_LORD = 'le-69' as CardDefinitionId;    // race "elves"
const SONS_OF_KINGS = 'le-91' as CardDefinitionId; // race "dúnedain"
const AMBUSHER = 'le-59' as CardDefinitionId;     // race "men"
const HOBGOBLINS = 'le-77' as CardDefinitionId;   // race "orc" (control — not Elf/Dwarf/Dúnedain/Men)

// Minion characters.
const GORBAG = 'le-11' as CardDefinitionId;   // orc, mind 6 — overt race
const SHAGRAT = 'le-39' as CardDefinitionId;  // orc, mind 6
const ASTERNAK = 'le-1' as CardDefinitionId;  // man, mind 5 — covert race (no Orc/Troll/Balrog)

// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA = 'le-392' as CardDefinitionId;        // shadow-hold (non-haven, company destination)
const RIVENDELL_MINION = 'as-160' as CardDefinitionId; // automatic-attacks: Elves (4/8), Dúnedain (3/10)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a base game state with NSN in the resource player's hand. */
function buildBase(opts: { nsnCopies?: number } = {}) {
  const hand = Array.from({ length: opts.nsnCopies ?? 1 }, () => NSN);
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [GORBAG] }],
        hand,
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
}

describe('Not Slay Needlessly (le-212)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 2: -2 prowess vs. matching races (non-covert) ────────────────────

  test('modify-attack is available against an Elf (elves) creature', () => {
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess: 10,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as ModifyAttackAction;
    expect(act.player).toBe(PLAYER_1);
    expect(act.cardInstanceId).toBe(state.players[RESOURCE_PLAYER].hand[0].instanceId);
  });

  test('modify-attack is available against a Dúnedain creature', () => {
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: SONS_OF_KINGS,
      creatureRace: 'dúnedain',
      strikeProwess: 8,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
  });

  test('modify-attack is available against a Men creature', () => {
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: AMBUSHER,
      creatureRace: 'men',
      strikeProwess: 7,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
  });

  test('modify-attack is NOT available against a non-matching race (Orc)', () => {
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: HOBGOBLINS,
      creatureRace: 'orc',
      strikeProwess: 10,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    // Race filter excludes Orc — no modify-attack action should be generated.
    expect(actions).toHaveLength(0);
  });

  test('playing NSN reduces the attack prowess by 2', () => {
    const strikeProwess = 10;
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess,
    });
    const [action] = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, action.action);

    expect(after.combat?.strikeProwess).toBe(strikeProwess - 2);
  });

  test('NSN is discarded from hand after playing (short-event lifecycle)', () => {
    const state = makeCancelWindowCombat(buildBase(), {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess: 10,
    });
    const [action] = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, action.action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, NSN);
  });

  // ─── Effect 4: cannot be duplicated on a given attack ────────────────────────

  test('cannot play a second copy on the same attack (per-attack duplication limit)', () => {
    // Two copies of NSN in hand.
    const base = buildBase({ nsnCopies: 2 });
    const state = makeCancelWindowCombat(base, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess: 10,
    });

    // Before playing: both copies are available.
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(2);

    // Play the first copy.
    const [action] = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, action.action);

    // After playing: the second copy is blocked by the duplication limit.
    // The player still has one NSN in hand but the attack constraint blocks it.
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(viableActions(after, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  // ─── Regression: site automatic-attacks use normalized singular races ────────

  test('modify-attack is available against a site automatic-attack by Elves', () => {
    // A site's automatic-attack `creatureType: "Elves"` is normalized to the
    // singular race "elf" on the combat state (Rivendell as-160, 4 strikes at
    // 8 prowess). The card must still be playable against it.
    const state = makeCancelWindowCombat(buildBase(), {
      attackSourceType: 'automatic-attack',
      creatureRace: 'elf',
      strikesTotal: 4,
      strikeProwess: 8,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    expect(after.combat?.strikeProwess).toBe(6);
  });

  test('modify-attack is available against a Dúnedain site automatic-attack (3 strikes, 10 prowess)', () => {
    // The reported save: Rivendell's 2nd automatic-attack, "Dúnedain — 3 strikes
    // with 10 prowess", normalized to the race "dunadan" on the combat state.
    const state = makeCancelWindowCombat(buildBase(), {
      attackSourceType: 'automatic-attack',
      creatureRace: 'dunadan',
      strikesTotal: 3,
      strikeProwess: 10,
    });
    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    expect(after.combat?.strikeProwess).toBe(8);
  });

  test('modify-attack is offered on a real site automatic-attack driven through the site phase', () => {
    // End-to-end through the engine (no hand-built combat): a minion company at
    // Rivendell (as-160, the site from the reported game) triggers the site's
    // first automatic-attack, "Elves — 4 strikes with 8 prowess". The site's
    // `creatureType` is normalized to the singular race "elf", which is what the
    // card's race filter has to match.
    const state = setupAutoAttackStep(
      buildSitePhaseState({ site: RIVENDELL_MINION, characters: [GORBAG], hand: [NSN] }),
    );
    const inCombat = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat?.creatureRace).toBe('elf');

    const actions = viableActions(inCombat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(inCombat, actions[0].action);
    expect(after.combat?.strikeProwess).toBe(6);
  });

  // ─── Regression: must not be playable outside of an appropriate attack ───────

  test('NOT playable as a resource short event during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [GORBAG] }],
          hand: [NSN],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const nsnInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId === nsnInstanceId);
    expect(playable).toHaveLength(0);
  });

  // ─── Effect 1: cancel vs. covert company ─────────────────────────────────────

  test('against a covert company: cancel-attack is available for a matching race', () => {
    // Asternak is a Man (covert race) — company has no Orc/Troll/Balrog → covert.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ASTERNAK] }],
          hand: [NSN],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = makeCancelWindowCombat(base, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess: 10,
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('the cancel branch only fires vs covert companies; overt companies get -2 prowess', () => {
    // GORBAG is Orc (overt race) → overt company gets modify-attack, not cancel.
    const overtState = makeCancelWindowCombat(buildBase(), {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikeProwess: 10,
    });
    expect(viableActions(overtState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    expect(viableActions(overtState, PLAYER_1, 'modify-attack')).toHaveLength(1);
  });
});
