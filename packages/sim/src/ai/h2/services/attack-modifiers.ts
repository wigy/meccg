/**
 * @module ai/h2/services/attack-modifiers
 *
 * What the hazard events on the board are doing to the numbers of every attack.
 *
 * Both seats need this and neither may own it. The hazard side reads it to
 * price its own support events and to resolve bundles with the board's
 * modifiers applied; the defending side reads it because a company facing Orcs
 * while Minions Stir is out is facing *stronger* Orcs, and a `defence` that does
 * not know that under-states every harm it reports. Two private copies of the
 * reader would be two opinions about the same declared number, which is the
 * disagreement the service layer exists to prevent.
 *
 * It reads only what the DSL declares. A modifier whose condition this cannot
 * check is *dropped* rather than assumed to hold — an unread condition must
 * never inflate an attack the engine will not inflate.
 */

import type { CardDefinition, PlayerView } from '@meccg/shared';

/**
 * What a hazard event would add to every attack this turn, by creature race.
 *
 * Minions Stir declares six `stat-modifier` effects: +1 prowess and +1 strike
 * to Orc attacks, +2 of each instead if Doors of Night is in play, +1 of each
 * to Troll attacks. That is not card text a module has to guess at — it is a
 * declared change to the numbers the strike enumeration already runs on.
 *
 * Keyed by race, with `ALL_RACES` for a modifier that names none.
 */
export type AttackBoost = ReadonlyMap<string, { readonly prowess: number; readonly strikes: number }>;

/** The key a boost uses when it applies to every attack, whatever the race. */
export const ALL_RACES = '*';

/** A `stat-modifier` effect, as far as this module reads one. */
interface StatModifier {
  readonly type?: string;
  readonly stat?: string;
  readonly value?: number;
  readonly target?: string;
  readonly id?: string;
  readonly overrides?: string;
  readonly when?: Readonly<Record<string, unknown>>;
}

/**
 * Whether a card of that name is in play, for either player.
 *
 * `hypothetical` is the card whose play is being priced: an `inPlay` condition
 * naming it is satisfied in the arm of the counterfactual where it has been
 * played. That is the whole of Doors of Night's value here — it does nothing to
 * an attack itself, and everything to the modifiers that name it.
 */
export function inPlayNamed(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  name: string,
  hypothetical?: string,
): boolean {
  if (hypothetical !== undefined && hypothetical === name) return true;
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      if ((cardPool[card.definitionId] as unknown as { name?: string } | undefined)?.name === name) return true;
    }
  }
  return false;
}

/** The printed name of a definition, or its id. */
export function nameOfDefinition(def: CardDefinition | undefined, definitionId: string): string {
  return (def as unknown as { name?: string } | undefined)?.name ?? definitionId;
}

/**
 * The races an `enemy.race` clause names, or null when it is not one this can
 * read.
 *
 * Two shapes appear in the card data: a bare race (`"orc"`, Minions Stir) and a
 * list (`{ $in: ["spider", "animal"] }`, Full of Froth and Rage). The list shape
 * used to fall through the string check and take the *whole modifier* with it,
 * so a card whose only text is "all Spider and Animal attacks receive +2
 * prowess" declared nothing the AI could see: it never played it, never planned
 * around it, and priced it at nothing to keep.
 */
function racesOf(value: unknown): readonly string[] | null {
  if (typeof value === 'string') return [value];
  const list = (value as { $in?: unknown } | null)?.$in;
  if (Array.isArray(list) && list.length > 0 && list.every(race => typeof race === 'string')) {
    return list as readonly string[];
  }
  return null;
}

/**
 * Read a modifier's `when` clause: which races it applies to, and whether it
 * applies at all.
 *
 * Returns null for a clause this cannot read, which makes the caller drop the
 * modifier — an unread condition must never be assumed true, or the module
 * credits a boost the engine will not apply.
 */
export function conditionOf(
  when: Readonly<Record<string, unknown>> | undefined,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  hypothetical?: string,
): { races: readonly string[]; applies: boolean } | null {
  if (!when) return { races: [ALL_RACES], applies: true };
  const clauses = Array.isArray(when.$and) ? (when.$and as Readonly<Record<string, unknown>>[]) : [when];
  let races: readonly string[] = [ALL_RACES];
  let applies = true;
  for (const clause of clauses) {
    const keys = Object.keys(clause);
    if (keys.length !== 1) return null;
    const [key] = keys;
    const value = clause[key];
    if (key === 'enemy.race') {
      const named = racesOf(value);
      if (!named) return null;
      races = named;
    } else if (key === 'inPlay') {
      if (typeof value !== 'string') return null;
      applies &&= inPlayNamed(view, cardPool, value, hypothetical);
    } else {
      // A condition this does not know how to check: drop the modifier rather
      // than assume it holds.
      return null;
    }
  }
  return { races, applies };
}

/**
 * The attack boost a hazard event declares, or null when it declares none.
 *
 * `overrides` is what makes Minions Stir readable: the +2 variants name the +1
 * variants they replace, so the two are not summed when Doors of Night is out.
 */
export function attackBoostOf(
  def: CardDefinition | undefined,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  hypothetical?: string,
): AttackBoost | null {
  const effects = (def as unknown as { effects?: readonly StatModifier[] } | undefined)?.effects ?? [];
  const entries: { key: string; races: readonly string[]; stat: string; value: number; overrides?: string }[] = [];
  effects.forEach((effect, index) => {
    if (effect.type !== 'stat-modifier' || effect.target !== 'all-attacks') return;
    if (effect.stat !== 'prowess' && effect.stat !== 'strikes') return;
    const condition = conditionOf(effect.when, view, cardPool, hypothetical);
    if (!condition || !condition.applies) return;
    entries.push({
      key: effect.id ?? `#${index}`,
      races: condition.races,
      stat: effect.stat,
      value: effect.value ?? 0,
      overrides: effect.overrides,
    });
  });
  if (entries.length === 0) return null;

  const replaced = new Set(entries.map(e => e.overrides).filter((id): id is string => id !== undefined));
  const boost = new Map<string, { prowess: number; strikes: number }>();
  for (const entry of entries) {
    if (replaced.has(entry.key)) continue;
    // One effect may name several races; each gets its own entry, because a
    // boost is looked up by the race printed on the attacking creature.
    for (const race of entry.races) {
      const current = boost.get(race) ?? { prowess: 0, strikes: 0 };
      boost.set(race, entry.stat === 'prowess'
        ? { ...current, prowess: current.prowess + entry.value }
        : { ...current, strikes: current.strikes + entry.value });
    }
  }
  return boost.size > 0 ? boost : null;
}

/** Merge two boosts, race by race. Absent is zero on both sides. */
export function mergeBoosts(a: AttackBoost | null, b: AttackBoost | null): AttackBoost | null {
  if (!a) return b;
  if (!b) return a;
  const merged = new Map<string, { prowess: number; strikes: number }>(a);
  for (const [race, added] of b) {
    const current = merged.get(race) ?? { prowess: 0, strikes: 0 };
    merged.set(race, {
      prowess: current.prowess + added.prowess,
      strikes: current.strikes + added.strikes,
    });
  }
  return merged;
}

/** Two boosts are the same when every race gets the same numbers. */
export function sameBoost(a: AttackBoost | null, b: AttackBoost | null): boolean {
  const races = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
  for (const race of races) {
    const left = a?.get(race) ?? { prowess: 0, strikes: 0 };
    const right = b?.get(race) ?? { prowess: 0, strikes: 0 };
    if (left.prowess !== right.prowess || left.strikes !== right.strikes) return false;
  }
  return true;
}

/**
 * What the hazard events *already in play* are doing to every attack.
 *
 * A long event lasts the turn and a permanent one lasts the game, so Minions
 * Stir on the board is not a card waiting to be played — it is a change to the
 * numbers every bundle from here on is resolved with. Reading it only at the
 * moment it is played, as this module did at first, priced the play correctly
 * and then went on under-valuing every creature behind it.
 *
 * Restricted to hazard events, because the modifier is the hazard side's: a
 * resource card that happens to declare an all-attacks modifier is the other
 * seat's business, and crediting it here would price our bundle with their card.
 */
export function boostInPlay(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options: { readonly hypothetical?: string; readonly excluding?: string } = {},
): AttackBoost | null {
  const { hypothetical, excluding } = options;
  let boost: AttackBoost | null = null;
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      if (excluding !== undefined && (card.instanceId as string) === excluding) continue;
      const def = cardPool[card.definitionId];
      if ((def as unknown as { cardType?: string } | undefined)?.cardType !== 'hazard-event') continue;
      boost = mergeBoosts(boost, attackBoostOf(def, view, cardPool, hypothetical));
    }
  }
  return boost;
}

/** What a boost adds to one creature, by the race printed on its card. */
export function boostFor(
  boost: AttackBoost | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
  definitionId: string,
): { prowess: number; strikes: number } {
  return boostForRace(
    boost,
    (cardPool[definitionId] as unknown as { race?: string } | undefined)?.race,
  );
}

/** What a boost adds to an attack made by a creature of that race. */
export function boostForRace(
  boost: AttackBoost | undefined | null,
  race: string | undefined | null,
): { prowess: number; strikes: number } {
  if (!boost) return { prowess: 0, strikes: 0 };
  const all = boost.get(ALL_RACES) ?? { prowess: 0, strikes: 0 };
  const byRace = race ? boost.get(race) ?? { prowess: 0, strikes: 0 } : { prowess: 0, strikes: 0 };
  return { prowess: all.prowess + byRace.prowess, strikes: all.strikes + byRace.strikes };
}

/**
 * A creature's own prowess/strikes bonus, conditioned on the defending company
 * having already faced a given race this M/H sub-phase (Orc-lieutenant tw-073:
 * "+4 prowess if played on a company that has already faced an Orc attack this
 * turn"; Orc-warband tw-076 declares the same shape).
 *
 * This is a *self* effect — no `target`, unlike `attackBoostOf`'s `all-attacks`
 * — so it only ever changes the creature's own attack, and only when it is the
 * second (or later) Orc-race attack the company faces. A bundle player who
 * ignores it always leads with the highest-prowess creature and never notices
 * that playing the weaker one first would have made the strong one stronger.
 */
export interface SelfFacedRaceBoost {
  /** The race that must already be in `company.facedRaces` for the bonus to apply. */
  readonly race: string;
  readonly prowess: number;
  readonly strikes: number;
}

/**
 * Reads a creature definition's own `company.facedRaces` self-conditional
 * stat-modifier, or null when it declares none. A `when` clause this cannot
 * read (anything but a single `company.facedRaces: { $includes: <race> }`
 * key) is dropped, same policy as `conditionOf`.
 */
export function selfFacedRaceBoostOf(def: CardDefinition | undefined): SelfFacedRaceBoost | null {
  const effects = (def as unknown as { effects?: readonly StatModifier[] } | undefined)?.effects ?? [];
  for (const effect of effects) {
    if (effect.type !== 'stat-modifier' || effect.target) continue;
    if (effect.stat !== 'prowess' && effect.stat !== 'strikes') continue;
    const when = effect.when;
    const keys = when ? Object.keys(when) : [];
    if (keys.length !== 1 || keys[0] !== 'company.facedRaces') continue;
    const clause = when![keys[0]] as { $includes?: unknown } | undefined;
    const race = clause?.$includes;
    if (typeof race !== 'string') continue;
    return {
      race,
      prowess: effect.stat === 'prowess' ? (effect.value ?? 0) : 0,
      strikes: effect.stat === 'strikes' ? (effect.value ?? 0) : 0,
    };
  }
  return null;
}

/**
 * Creature races a `hazardsEncountered` history has already resolved into an
 * attack, mirroring the engine's own `deriveFacedRaces` (`reducer-utils.ts`)
 * for the card pool this module already carries.
 */
export function facedRacesFromHistory(
  hazardNames: readonly string[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): ReadonlySet<string> {
  const races = new Set<string>();
  for (const name of hazardNames) {
    for (const def of Object.values(cardPool)) {
      const raw = def as unknown as { cardType?: string; name?: string; race?: string };
      if (raw.cardType !== 'hazard-creature' || raw.name !== name) continue;
      if (raw.race) races.add(raw.race);
      break;
    }
  }
  return races;
}
