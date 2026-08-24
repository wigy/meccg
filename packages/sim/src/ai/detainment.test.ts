/**
 * @module ai/detainment.test
 *
 * That the hazard seat predicts the flag the engine will compute, and predicts
 * it from the keying the play was actually offered under.
 *
 * The rule itself (CoE §3.II) is the engine's and is tested there. What is this
 * service's own is the translation: the defending seat's alignment out of the
 * view, the site the company will be standing at when the attack lands, and the
 * declared keying off the action rather than the union of everything the card
 * could have keyed to — the last of which is the difference between "Orc-patrol
 * is detainment" and "Orc-patrol is detainment when it came in on the Dark-hold".
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CreatureKeyingMatch, OpponentCompanyView, PlayerView } from '@meccg/shared';
import { attackIsDetainment } from './detainment.js';

const cardPool = loadCardPool();

/** The definition id of a card by printed name. */
function idOf(name: string): string {
  const id = Object.keys(cardPool).find(key =>
    (cardPool[key] as unknown as { name?: string }).name === name);
  expect(id).toBeDefined();
  return id!;
}

/** A hazard seat facing a company of the given alignment. */
function seatAgainst(alignment: string): PlayerView {
  return {
    self: { cardsInPlay: [] },
    opponent: { alignment, cardsInPlay: [] },
  } as unknown as PlayerView;
}

/**
 * The company under attack: where it stands, and where it is heading.
 *
 * Sites are named by definition id rather than by printed name, because the
 * names that matter here are printed on more than one card — every set has its
 * own Moria and its own Under-gates, and they do not carry the same rules.
 */
function companyAt(siteId: string | null, movingTo: string | null = null): OpponentCompanyView {
  return {
    id: 'company-p1-0',
    characters: [],
    currentSite: siteId === null ? null : { definitionId: siteId },
    revealedDestinationSite: movingTo === null ? null : { definitionId: movingTo },
  } as unknown as OpponentCompanyView;
}

/** Goblin-gate: "creatures other than Nazgûl attack normally, not as detainment". */
const GOBLIN_GATE = 'le-378';

/** The Under-gates (Balrog): every attack there is detainment. */
const UNDER_GATES = 'ba-100';

/** How the engine said this creature was keyed to the path. */
function keyedBy(method: CreatureKeyingMatch['method'], value: string): CreatureKeyingMatch {
  return { method, value };
}

/** Orc-patrol keys to Wilderness/Shadow/Dark and to R&L/Shadow-hold/Dark-hold. */
const ORC_PATROL = idOf('Orc-patrol');

describe('who is defending', () => {
  test('a hero company faces no detainment attack from an ordinary creature', () => {
    // §3.II.2 is a minion/Balrog rule. Against a Wizard player the same Orc
    // attack that would be detainment elsewhere simply wounds.
    expect(attackIsDetainment(
      seatAgainst('wizard'), cardPool, companyAt(null), ORC_PATROL, keyedBy('site-type', 'dark-hold'),
    )).toBe(false);
  });

  test('a Fallen-wizard company is a hero company for this purpose (2.IV.vii.F1)', () => {
    expect(attackIsDetainment(
      seatAgainst('fallen-wizard'), cardPool, companyAt(null), ORC_PATROL, keyedBy('region-type', 'dark'),
    )).toBe(false);
  });

  test('a creature whose own text detains hero companies is detainment against one', () => {
    // §3.II.2 also fires off the attack itself, which is how the whole LE/AS
    // hero-hunting family works — and that family is the one a hazard side
    // holding both kinds has to decide the order of.
    expect(attackIsDetainment(
      seatAgainst('wizard'), cardPool, companyAt(null), idOf('Wandering Eldar'),
    )).toBe(true);
  });

  test('a minion company faces a detainment attack when the creature is keyed to a Dark-hold', () => {
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(null), ORC_PATROL, keyedBy('site-type', 'dark-hold'),
    )).toBe(true);
  });
});

describe('the keying the play was made under', () => {
  test('the same creature played on its Wilderness keying is a normal attack', () => {
    // Orc-patrol could have been played on its Dark-hold keying; it was not, and
    // only the alternative actually used justifies detainment (§3.II.2.R1).
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(null), ORC_PATROL, keyedBy('region-type', 'wilderness'),
    )).toBe(false);
  });

  test('with no declared keying the union is used, as the engine does for a reveal', () => {
    // An on-guard placement has not committed to a keying yet, so every
    // alternative the card carries is live — Dark among them.
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(null), ORC_PATROL,
    )).toBe(true);
  });

  test('an Orc keyed to a Shadow-land is detainment by race (§3.II.2.R2)', () => {
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(null), ORC_PATROL, keyedBy('region-type', 'shadow'),
    )).toBe(true);
  });
});

describe('the site the attack lands at', () => {
  test('a site that says its attacks are not detainment is read', () => {
    // Without reading the site this would come back detainment on the Dark-hold
    // keying alone.
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(GOBLIN_GATE), ORC_PATROL,
      keyedBy('site-type', 'dark-hold'),
    )).toBe(false);
  });

  test('the site read is where the company is going, not where it stands', () => {
    // The attack lands at the destination, so that is the site whose rules
    // apply — the engine's own `resolveDefendingSiteDef`. Standing at a site
    // that forces detainment does not make the attack one.
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(UNDER_GATES, GOBLIN_GATE), ORC_PATROL,
      keyedBy('site-type', 'dark-hold'),
    )).toBe(false);
    // ...and the reverse: a Wilderness keying that is no detainment anywhere
    // else becomes one at a site whose every attack is.
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(GOBLIN_GATE, UNDER_GATES), ORC_PATROL,
      keyedBy('region-type', 'wilderness'),
    )).toBe(true);
  });
});

describe('what is not an attack at all', () => {
  test('a card that is not a creature is never a detainment attack', () => {
    expect(attackIsDetainment(
      seatAgainst('ringwraith'), cardPool, companyAt(null), idOf('Doors of Night'),
    )).toBe(false);
  });
});
