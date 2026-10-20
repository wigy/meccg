/**
 * @module strike-prowess
 *
 * Single source of truth for the two numbers a strike roll compares: the
 * defending character's (or ally's) prowess for the strike and the strike's
 * prowess. {@link strikeProwessTerms} returns both as labelled terms so the
 * same calculation drives
 *
 * - the reducer's actual resolution (`resolveStrikeCore` in `combat-strike.ts`),
 * - the legal-action "need N+" preview (`legal-actions/combat.ts`), and
 * - the roll breakdown attached to the strike's `DiceRollEffect`, which
 *   clients render so both players see every modifier that applied.
 *
 * Keeping the preview and the reducer on one function guarantees the "need"
 * shown before the roll is the threshold the reducer actually uses.
 */

import type { GameState, CombatState, CardDefinition, RollTerm, StrikeAssignment } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { CharacterInPlay } from '../types/state-cards.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { resolveInstanceId } from '../types/state.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { allyEffectiveProwess } from './ally-stats.js';
import { companyById, defById, excessStrikePenalty, getCardEffects } from './reducer-utils.js';
import { defenderAlignmentLabel } from './detainment.js';
import { computeCombatProwessBreakdown, computeStayUntappedPenalty, buildInPlayNames } from './recompute-derived.js';
import { enemyRaceContext } from './effects/index.js';
import { findAllyInCompany } from './legal-actions/combat.js';

/** How the defender faces the strike (CoE 3.iv.3) — mirrors `resolveStrikeCore`'s `mode`. */
export type StrikeFacingMode = 'tap' | 'untap' | 'dodge' | 'reroll';

/** Result of {@link strikeProwessTerms}. */
export interface StrikeProwessTerms {
  /** Terms summing to the defender's prowess for this strike (added to 2d6). */
  readonly characterTerms: readonly RollTerm[];
  /** Terms summing to the strike's prowess the roll is compared against. */
  readonly creatureTerms: readonly RollTerm[];
  /** Sum of {@link characterTerms}. */
  readonly characterProwess: number;
  /** Sum of {@link creatureTerms}. */
  readonly opponentProwess: number;
  /** Smallest 2d6 result that defeats the strike (never below 2). */
  readonly need: number;
}

/** Sum the values of a term list. */
export function sumTerms(terms: readonly RollTerm[]): number {
  return terms.reduce((sum, t) => sum + t.value, 0);
}

/**
 * Compute the labelled prowess terms for both sides of `strike`.
 *
 * Character side, in order: base prowess (or mind for Neeker-breekers, or
 * ally prowess) plus one term per modifying card, then the stay-untapped
 * penalty (when `stayUntapped`), -1 tapped, -2 wounded, the excess-strike
 * penalty, +N support (CoE 3.iv.4), the strike-event bonus, and passive
 * `modify-attack` items. Creature side: the attack's strike prowess (or the
 * agent's roll, rule 3.iv.6.1) plus the creature's per-defender bonus (Old
 * Man Willow vs Hobbits).
 *
 * `defender` overrides the defending player's state (dodge pre-discards a
 * card from hand before resolving). Returns `null` when the strike target is
 * no longer in play.
 */
export function strikeProwessTerms(
  state: GameState,
  combat: CombatState,
  strike: StrikeAssignment,
  mode: StrikeFacingMode,
  stayUntapped: boolean,
  defender?: PlayerState,
): StrikeProwessTerms | null {
  const defPlayer = defender ?? state.players[getPlayerIndex(state, combat.defendingPlayerId)];
  const charData = defPlayer.characters[strike.characterId];
  const company = companyById(defPlayer.companies, combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;
  if (!charData && !allyMatch) return null;

  const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
  const targetStatus = charData?.status ?? allyMatch!.ally.status;
  const charDef = defById(state, targetDefId);

  const characterTerms: RollTerm[] = [];
  if (combat.defenderProwessFromMind && !allyMatch && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
    // Neeker-breekers: use the character's mind attribute as base prowess
    logDetail(`Defender prowess from mind: ${charDef.mind} (${charDef.name ?? targetDefId as string})`);
    characterTerms.push({ label: 'mind', value: charDef.mind });
  } else if (allyMatch) {
    characterTerms.push({ label: 'prowess', value: allyEffectiveProwess(state, allyMatch.ally) });
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    // Thread the resolution mode so "when tapping to face a strike" prowess
    // modifiers (Stabbing Tongue of Fire ba-81, Whip of Many Thongs ba-82)
    // apply only in `tap` mode and not when the character stays untapped, and
    // thread `weaponsIneffective` so "weapons do not modify prowess against
    // these strikes" (Rock Fall, Earth-tremors dm-53) drops weapon-sourced
    // prowess bonuses for this strike.
    characterTerms.push(...computeCombatProwessBreakdown(state, charData, charDef, combat.creatureRace, mode, combat.weaponsIneffective));
  } else {
    characterTerms.push({ label: 'prowess', value: charData.effectiveStats.prowess });
  }
  // Stay untapped penalty (MEBA: -1 for The Balrog; 0 with Thong of Fire as-132)
  if (stayUntapped) {
    const penalty = computeStayUntappedPenalty(state, charData, charDef);
    if (penalty !== 0) characterTerms.push({ label: 'stays untapped', value: -penalty });
  }
  if (targetStatus === CardStatus.Tapped) characterTerms.push({ label: 'tapped', value: -1 });
  if (targetStatus === CardStatus.Inverted) characterTerms.push({ label: 'wounded', value: -2 });
  const excess = excessStrikePenalty(combat, strike.excessStrikes);
  if (excess !== 0) characterTerms.push({ label: 'excess strikes', value: -excess });
  const supportBonus = strike.supportCount ?? 0;
  if (supportBonus !== 0) characterTerms.push({ label: 'support', value: supportBonus }); // CoE rule 3.iv.4
  const modifyStrikeBonus = strike.strikeProwessBonus ?? 0;
  if (modifyStrikeBonus !== 0) {
    logDetail(`Strike event prowess modifier: ${formatSignedNumber(modifyStrikeBonus)}`);
    characterTerms.push({ label: 'strike event', value: modifyStrikeBonus });
  }
  if (charData && !allyMatch) {
    characterTerms.push(...passiveModifyAttackProwessTerms(state, charData, combat.weaponsIneffective));
  }

  // For agent attacks, compare against the agent's rolled total (rule 3.iv.6.1).
  // A creature may gain prowess against the specific character it strikes
  // (e.g. Old Man Willow's "15 prowess against Hobbits"). This depends on the
  // defender's race, unknown until now, so it is applied per strike here.
  const creatureTerms: RollTerm[] = [];
  if (combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined) {
    creatureTerms.push({ label: 'agent roll', value: combat.agentRollTotal });
  } else {
    creatureTerms.push({ label: 'prowess', value: combat.strikeProwess });
  }
  const defenderProwessDelta = combat.attackSource.type === 'agent' ? 0 : creatureDefenderProwessDelta(state, combat, charDef);
  if (defenderProwessDelta !== 0) {
    creatureTerms.push({ label: `vs ${charDef && isCharacterCard(charDef) ? charDef.race : 'defender'}`, value: defenderProwessDelta });
  }

  const characterProwess = sumTerms(characterTerms);
  const opponentProwess = sumTerms(creatureTerms);
  return {
    characterTerms,
    creatureTerms,
    characterProwess,
    opponentProwess,
    need: Math.max(2, opponentProwess - characterProwess + 1),
  };
}

/**
 * Computes the per-strike prowess adjustment a creature gains against the
 * specific defending character based on its own `stat-modifier` self-effects
 * that are gated on the defender's race (e.g. Old Man Willow's "15 prowess
 * against Hobbits", encoded as `+2 when defender.race = hobbit`).
 *
 * Such modifiers cannot be folded into `combat.strikeProwess` at combat
 * initiation: the struck character — and therefore its race — is not known
 * until strike assignment. The defending company's *alignment* IS known at
 * initiation, so alignment-gated self-modifiers (e.g. Elf-lord Revealed in
 * Wrath's "+4 vs Ringwraith") are already baked into `strikeProwess`. To avoid
 * double-counting them, a modifier contributes here only when it matches the
 * struck character's race context but did NOT already match the race-less
 * (initiation-equivalent) context.
 *
 * Returns the extra prowess for this strike (0 when the source is not a
 * creature hazard, or no defender-race-gated modifier matches).
 */
export function creatureDefenderProwessDelta(
  state: GameState,
  combat: CombatState,
  charDef: CardDefinition | undefined,
): number {
  if (combat.attackSource.type !== 'creature') return 0;
  if (!charDef || !isCharacterCard(charDef)) return 0;
  const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
  const creatureDef = creatureDefId ? defById(state, creatureDefId) : undefined;
  if (!creatureDef) return 0;
  const effects = getCardEffects(creatureDef);
  if (!effects.length) return 0;

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defenderAlignment = defenderAlignmentLabel(state.players[defPlayerIndex].alignment);
  const enemy = { ...enemyRaceContext(combat), name: creatureDef.name ?? '', prowess: combat.strikeProwess, body: combat.creatureBody };
  // Race-less context mirrors what was available at combat initiation: the
  // defending company's alignment is known, an individual character's race is not.
  const baseCtx = {
    reason: 'combat' as const,
    inPlay: buildInPlayNames(state),
    enemy,
    defender: { alignment: defenderAlignment },
  };
  // Context augmented with the struck character's race.
  const raceCtx = { ...baseCtx, defender: { alignment: defenderAlignment, race: charDef.race } };

  let delta = 0;
  for (const effect of effects) {
    if (effect.type !== 'stat-modifier' || effect.stat !== 'prowess') continue;
    if (effect.target) continue; // company/all-* scoped modifiers are not the creature's own strike bonus
    if (!effect.when) continue; // unconditional modifiers are already in strikeProwess
    if (typeof effect.value !== 'number') continue;
    if (matchesContext(effect.when, raceCtx) && !matchesContext(effect.when, baseCtx)) {
      delta += effect.value;
      logDetail(`Creature "${creatureDef.name}" prowess ${formatSignedNumber(effect.value)} against ${charDef.race}${charDef.name ? ` (${charDef.name})` : ''}`);
    }
  }
  return delta;
}

/**
 * Sums the `prowessModifier` of every passive `modify-attack` (`scope:
 * "current-strike"`, `passive: true`) effect carried by items attached to
 * the struck character. Unlike the activated `current-strike` path (which
 * requires a `tap-item-for-strike` action), a passive modifier applies to
 * every strike against its bearer automatically, with no cost and no
 * consumption. Added directly to the defender's own effective prowess for
 * the strike — mathematically identical to reducing the attack's prowess,
 * since the strike is decided by comparing the two. Used by Morgul-blade
 * (le-205): "Each strike against the Ringwraith receives ... -1 prowess."
 * Returns 0 when the character bears no such item.
 *
 * `weaponsIneffective` (Rock Fall, Earth-tremors dm-53; also Lava Flows,
 * Trap) skips any contributing item carrying the `weapon` keyword — "weapons
 * do not modify prowess against these strikes" excludes a weapon's own
 * passive prowess effect on itself just as it excludes an ordinary printed
 * weapon prowess bonus (see {@link computeCombatProwess}).
 */
export function passiveModifyAttackProwessBonus(
  state: GameState,
  charData: CharacterInPlay,
  weaponsIneffective?: boolean,
): number {
  return passiveModifyAttackProwessTerms(state, charData, weaponsIneffective).reduce((sum, t) => sum + t.value, 0);
}

/**
 * Per-item form of {@link passiveModifyAttackProwessBonus}: one labelled
 * term per contributing item, for the strike-roll breakdown.
 */
export function passiveModifyAttackProwessTerms(
  state: GameState,
  charData: CharacterInPlay,
  weaponsIneffective?: boolean,
): RollTerm[] {
  const terms: RollTerm[] = [];
  for (const item of charData.items) {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    if (weaponsIneffective && (itemDef as { keywords?: readonly string[] }).keywords?.includes('weapon')) continue;
    for (const effect of getCardEffects(itemDef)) {
      if (effect.type !== 'modify-attack' || effect.scope !== 'current-strike' || !effect.passive) continue;
      if (typeof effect.prowessModifier !== 'number') continue;
      const name = (itemDef as { name?: string }).name ?? (item.definitionId as string);
      logDetail(`Passive modify-attack prowess bonus ${formatSignedNumber(effect.prowessModifier)} from ${name}`);
      terms.push({ label: name, value: effect.prowessModifier, sourceDefinitionId: item.definitionId });
    }
  }
  return terms;
}
