/**
 * @module rule-8.37-trophies
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.37: Trophies
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a defending player's company defeats an opponent's creature, the defending player may take the creature as a "trophy" by placing it under the control of an Orc or Troll character that faced one of the creature's strikes. A trophy is treated as a minor item worth zero corruption points (for the purpose of all effects while it is being used as a trophy, including effects that would require an item to be discarded), but it cannot be transferred nor stored.
 * Half-orcs cannot take trophies.
 * Character cards cannot be used as trophies.
 * Defeated Dragon manifestations may be used as trophies, including Dragon factions.
 * Creatures being used as trophies provide the same number of kill marshalling points that they would to the defeating player if the creature was not being used as a trophy (i.e. the creature's normal value for non-detainment attacks, and zero marshalling points for detainment attacks).
 * A character's attributes are modified based on the total number of marshalling points printed on its trophy cards (regardless of how many points the cards are worth to the player):
 * • 1 total MP: +1 direct influence
 * • 2 total MPs: +1 direct influence, +1 prowess
 * • 3 total MPs: +2 direct influence, +1 prowess
 * • 4 or more total MPs: +2 direct influence, +2 prowess
 * Prowess bonuses from trophies are applied to a maximum of 9.
 * If a player would discard a trophy that is currently worth marshalling points to that player, the creature card is placed in the player's marshalling point pile. If a player would discard a trophy that is currently not worth marshalling points to that player, the creature card is removed from play.
 */

import { describe, test } from 'vitest';

describe('Rule 8.37 — Trophies', () => {
  test.todo('Orc or Troll that defeats creature strike may take it as trophy (minor item, 0 CP); provides DI/prowess bonuses based on total MP');
  test.todo('3.IV.2 — Detainment-creature trophy on Orc/Troll scores 0 kill-MP at Free Council; §3.IV.3 printed-MP attribute bonuses still apply');
});
