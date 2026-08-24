/**
 * @module combat-strike
 *
 * The strike-resolution core of a combat: resolving individual strikes
 * (`resolveStrikeCore`, `resolveStrikeCvCC`), the `handleResolveStrike` action
 * handler, strike-phase advancement (`nextStrikePhase`), combatant elimination
 * (`eliminateCombatantFromStrike`), follower pruning (`pruneLeaderFollowers`),
 * the creature prowess delta and character-status update helpers. Extracted
 * from `reducer-combat.ts` as the full, provably-closed transitive closure of
 * `handleResolveStrike`/`resolveStrikeCore` — it calls no other `reducer-combat`
 * function. `reducer-combat` imports the entry points it still dispatches
 * one-way from here; this module imports only shared leaves plus `finalizeCombat`
 * (combat-finalize) and the `combat-hazard-play` helpers (also one-way), so no
 * cycle forms.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, CombatState, GameAction, GameEffect, CardInstanceId, CardDefinition } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { CharacterInPlay, ItemInPlay } from '../types/state-cards.js';
import type { ReducerResult } from './reducer-utils.js';
import type { AbsorbWoundEffect, CancelPrisonerTakingEffect } from '../types/effects.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard, isItemCard } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany } from './legal-actions/combat.js';
import { allyEffectiveProwess } from './ally-stats.js';
import { resolveInstanceId } from '../types/state.js';
import { clonePlayers, companyById, defById, diceRollEffect, getCardEffects, partitionLeavingAllies, ringwraithReclaimMark, roll2d6, toCardInstance, wrongActionType } from './reducer-utils.js';
import { defenderAlignmentLabel } from './detainment.js';
import { computeCombatProwess, computeStayUntappedPenalty, buildInPlayNames } from './recompute-derived.js';
import { enemyRaceContext } from './effects/index.js';
import { findTakePrisonerHazard, applyTakePrisoner, applyTakePrisonerAtSite } from './combat-hazard-play.js';
import { finalizeCombat } from './combat-finalize.js';
import { partitionLeavingTrophies } from './trophy-dispersal.js';

/**
 * When a follower character leaves play, removes their ID from their leader's
 * followers list. This prevents stale follower references after elimination.
 */
export function pruneLeaderFollowers(
  chars: Record<string, CharacterInPlay>,
  eliminatedId: CardInstanceId,
  controlledBy: 'general' | CardInstanceId,
): Record<string, CharacterInPlay> {
  if (controlledBy === 'general') return chars;
  const leaderId = controlledBy as string;
  const leader = chars[leaderId];
  if (!leader) return chars;
  return { ...chars, [leaderId]: { ...leader, followers: leader.followers.filter(f => f !== eliminatedId) } };
}

/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
/**
 * Compute the next combat phase after all strikes are assigned or a strike finishes resolving.
 * If multiple unresolved strikes remain, enters choose-strike-order so the defender picks.
 * If exactly one remains, auto-selects it and goes to resolve-strike.
 * Returns null if all strikes are resolved (caller should finalize combat).
 */
export function nextStrikePhase(combat: CombatState): Partial<CombatState> | null {
  const unresolvedIndices: number[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    if (!combat.strikeAssignments[i].resolved) unresolvedIndices.push(i);
  }
  if (unresolvedIndices.length === 0) return null;
  if (unresolvedIndices.length === 1) {
    logDetail(`One unresolved strike remaining (index ${unresolvedIndices[0]}) — auto-selecting`);
    // Reset the attacker's Step 1 window and agent roll for the new strike sequence.
    return { phase: 'resolve-strike', currentStrikeIndex: unresolvedIndices[0], bodyCheckTarget: null, attackerStep1Done: false, agentRollTotal: undefined };
  }
  logDetail(`${unresolvedIndices.length} unresolved strikes — defender chooses order`);
  return { phase: 'choose-strike-order', bodyCheckTarget: null };
}

/**
 * Advance combat after a strike concludes: merge `combat` into `state` and
 * either continue with the next strike phase (via {@link nextStrikePhase}) or,
 * when no unresolved strikes remain, finalize the combat. This is the shared
 * tail of every strike-resolution handler.
 *
 * Multi-attack cancel-by-tap creatures (Assassin tw-8, Slayer le-90, Nameless
 * Thing dm-109 — `forceSingleTarget` + `combat-cancel-attack-by-tap`) let the
 * defender hold back a cancel and use it after facing an earlier attack: CRF 22
 * "you may decide to cancel one of the attacks after facing another attack."
 * So before advancing, reopen the cancel-by-tap sub-phase at each attack
 * boundary (every `strikesPerAttack` strikes resolved) while cancels and
 * unresolved strikes both remain. Carrion Feeders' wounded-strike variant
 * (`cancelStrikeAgainstWounded`) has no such clause and is excluded via the
 * `forceSingleTarget` gate (it never sets that flag).
 */
export function advanceStrikeOrFinalize(
  state: GameState,
  combat: CombatState,
  effects?: GameEffect[],
): ReducerResult {
  if (combat.forceSingleTarget && combat.cancelByTapRemaining && combat.cancelByTapRemaining > 0) {
    const strikesPerAttack = combat.strikesPerAttack ?? 1;
    const resolvedCount = combat.strikeAssignments.filter(a => a.resolved).length;
    const unresolvedCount = combat.strikeAssignments.length - resolvedCount;
    if (resolvedCount > 0 && unresolvedCount > 0 && resolvedCount % strikesPerAttack === 0) {
      logDetail(`Cancel-by-tap window reopens after facing an attack: ${combat.cancelByTapRemaining} cancel(s) still available`);
      const newState = { ...state, combat: { ...combat, phase: 'assign-strikes' as const, assignmentPhase: 'cancel-by-tap' as const } };
      return effects ? { state: newState, effects } : { state: newState };
    }
  }

  const next = nextStrikePhase(combat);
  if (next) {
    const newState = { ...state, combat: { ...combat, ...next } };
    return effects ? { state: newState, effects } : { state: newState };
  }
  return finalizeCombat({ ...state, combat }, effects);
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
 * Search a character's own allies for one carrying `cancel-prisoner-taking`
 * (`scope: "controlling-character"`) — the ally the player may discard to
 * cancel a prisoner-taking outcome against this character (Noble Hound
 * dm-179). Returns the ally's card instance, or `null` if none qualifies.
 */
export function findCancelPrisonerTakingAlly(
  state: GameState,
  charData: CharacterInPlay,
): { instanceId: CardInstanceId } | null {
  for (const ally of charData.allies) {
    const def = defById(state, ally.definitionId);
    const hasCancelEffect = getCardEffects(def).some(
      (e): e is CancelPrisonerTakingEffect => e.type === 'cancel-prisoner-taking' && e.scope === 'controlling-character',
    );
    if (hasCancelEffect) return { instanceId: ally.instanceId };
  }
  return null;
}

/**
 * Core strike resolution shared by `resolve-strike`, `play-dodge`, and
 * `play-reroll-strike`.
 *
 * Rolls 2d6 + prowess vs strike prowess, determines the outcome, applies
 * tap/wound to the character or ally, and advances combat to body-check or
 * the next strike. The four resolution modes differ only in:
 * - prowess modifier (stay-untapped takes -3; tap and dodge are full; reroll
 *   is full or -3 depending on `rerollStayUntapped`)
 * - whether the character taps on success/tie (reroll taps like tap mode
 *   unless `rerollStayUntapped`, in which case it behaves like untap mode)
 * - dodge adds a body penalty for the resulting body check
 * - reroll makes two 2d6 rolls and keeps the better total
 *
 * `preAppliedDefender` lets callers pre-mutate the defender (e.g. dodge
 * discards a card from hand before resolving); this must NOT alter
 * characters or companies, only piles.
 *
 * `rerollStayUntapped` carries the defender's independent CoE 3.iv.3 choice
 * for reroll mode (e.g. Swift Strokes, Lucky Strike): the card's own text
 * doesn't say anything about tapping, so the defender still gets to apply
 * the usual -3 stay-untapped penalty instead of tapping. Ignored outside
 * `mode === 'reroll'`.
 */
export function resolveStrikeCore(
  state: GameState,
  combat: CombatState,
  mode: 'tap' | 'untap' | 'dodge' | 'reroll',
  dodgeBodyPenalty: number,
  preAppliedDefender: PlayerState | null,
  rerollStayUntapped = false,
): ReducerResult {
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Look up combatant stats — may be a character or an ally (CoE rule 2.V.2.2)
  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = preAppliedDefender ?? state.players[defPlayerIndex];
  const charData = defPlayer.characters[strike.characterId];
  const company = companyById(defPlayer.companies, combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;
  if (!charData && !allyMatch) return { state, error: 'Character not found' };

  const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
  const targetStatus = charData?.status ?? allyMatch!.ally.status;
  const charDef = defById(state, targetDefId);

  // Compute effective prowess
  let prowess: number;
  if (combat.defenderProwessFromMind && !allyMatch && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
    // Neeker-breekers: use the character's mind attribute as base prowess
    prowess = charDef.mind;
    logDetail(`Defender prowess from mind: ${charDef.mind} (${charDef.name ?? targetDefId as string})`);
  } else if (allyMatch) {
    prowess = allyEffectiveProwess(state, allyMatch.ally);
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef)) {
    // Thread the resolution mode so "when tapping to face a strike" prowess
    // modifiers (Stabbing Tongue of Fire ba-81, Whip of Many Thongs ba-82)
    // apply only in `tap` mode and not when the character stays untapped.
    prowess = computeCombatProwess(state, charData, charDef, combat.creatureRace, mode);
  } else {
    prowess = charData.effectiveStats.prowess;
  }
  // Stay untapped penalty (MEBA: -1 for The Balrog; 0 with Thong of Fire as-132)
  if (mode === 'untap' || (mode === 'reroll' && rerollStayUntapped)) prowess -= computeStayUntappedPenalty(state, charData, charDef);
  if (targetStatus === CardStatus.Tapped) prowess -= 1;
  if (targetStatus === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes;
  const supportBonus = strike.supportCount ?? 0;
  prowess += supportBonus; // CoE rule 3.iv.4: +1 per supporting character/ally
  const modifyStrikeBonus = strike.strikeProwessBonus ?? 0;
  if (modifyStrikeBonus !== 0) {
    logDetail(`Strike event prowess modifier: ${formatSignedNumber(modifyStrikeBonus)}`);
    prowess += modifyStrikeBonus;
  }

  // Roll dice. Reroll mode makes two rolls and keeps the better total; the
  // discarded roll is logged and emitted as an effect so both rolls appear
  // in history.
  let roll;
  let rng;
  let cheatRollTotal;
  const rollLabel = mode === 'dodge' ? 'Strike (dodge)' : mode === 'reroll' ? 'Strike (reroll)' : 'Strike';
  const charLabel = charDef?.name ?? (targetDefId as string);
  const effects: GameEffect[] = [];

  if (mode === 'reroll') {
    const r1 = roll2d6(state);
    const r2 = roll2d6({ ...state, rng: r1.rng, cheatRollTotal: r1.cheatRollTotal });
    const t1 = r1.roll.die1 + r1.roll.die2;
    const t2 = r2.roll.die1 + r2.roll.die2;
    const firstBetter = t1 >= t2;
    const kept = firstBetter ? r1 : r2;
    const discarded = firstBetter ? r2 : r1;
    roll = kept.roll;
    rng = r2.rng;
    cheatRollTotal = r2.cheatRollTotal;
    logDetail(`${rollLabel}: rolled ${r1.roll.die1}+${r1.roll.die2}=${t1} and ${r2.roll.die1}+${r2.roll.die2}=${t2} → keeping ${kept.roll.die1}+${kept.roll.die2}=${kept.roll.die1 + kept.roll.die2}`);
    effects.push(diceRollEffect(defPlayer.name, discarded.roll, `${rollLabel} (discarded): ${charLabel}`));
    effects.push(diceRollEffect(defPlayer.name, kept.roll, `${rollLabel}: ${charLabel}`));
  } else {
    const single = roll2d6(state);
    roll = single.roll;
    rng = single.rng;
    cheatRollTotal = single.cheatRollTotal;
    effects.push(diceRollEffect(defPlayer.name, roll, `${rollLabel}: ${charLabel}`));
  }

  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;
  // For agent attacks, compare against the agent's rolled total (rule 3.iv.6.1).
  // A creature may gain prowess against the specific character it strikes
  // (e.g. Old Man Willow's "15 prowess against Hobbits"). This depends on the
  // defender's race, unknown until now, so it is applied per strike here.
  const defenderProwessDelta = combat.attackSource.type === 'agent' ? 0 : creatureDefenderProwessDelta(state, combat, charDef);
  const effectiveProwess = (combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess) + defenderProwessDelta;
  logDetail(`${rollLabel} resolution: ${targetDefId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs ${combat.attackSource.type === 'agent' ? `agent roll ${effectiveProwess}` : `creature prowess ${effectiveProwess}`}`);

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;
  if (characterTotal > effectiveProwess) {
    result = 'success';
    if (combat.detainment) {
      logDetail('Character defeats strike — detainment: no body check vs creature (CoE 3.II.1)');
    } else {
      if (combat.creatureBody !== null) bodyCheckTarget = 'creature';
      logDetail(`Character defeats strike — ${bodyCheckTarget ? 'body check vs creature' : 'creature has no body'}`);
    }
  } else if (characterTotal < effectiveProwess) {
    result = 'wounded';
    if (combat.detainment) {
      logDetail('Strike succeeds — detainment: character tapped, no body check');
    } else {
      bodyCheckTarget = 'character';
      logDetail('Strike succeeds — character wounded, body check vs character');
    }
  } else {
    result = 'success';
    logDetail(`Tie — ineffectual${mode === 'dodge' ? ' (dodge: no tap)' : ', character taps'}`);
  }

  // Liquid Fire (wh-52): a `defeat-attack-strikes` constraint consumed at
  // combat initiation forces every strike of this attack to be defeated
  // regardless of the roll — the strike still triggers the normal creature
  // body check when the creature has body (penalized separately by
  // `forcedDefeatBodyCheckModifier` in `handleBodyCheckRoll`).
  if (combat.forcedStrikeDefeat) {
    result = 'success';
    bodyCheckTarget = combat.creatureBody !== null ? 'creature' : null;
    logDetail(`Forced strike defeat (Liquid Fire) — strike automatically fails${bodyCheckTarget ? ', creature body check pending' : ''}`);
  }

  // discard-item strike effect (An Article Missing dm-43, Taladhan dm-25,
  // Thief tw-102, Pick-pocket tw-79): on a successful strike the defender is
  // not wounded; an item must instead be discarded (defender's choice) —
  // pooled from the whole company for 'discard-item', or scoped to just the
  // struck character for 'discard-item-character'.
  const discardItemEffect = result === 'wounded' && !combat.detainment
    && (combat.strikeEffect === 'discard-item' || combat.strikeEffect === 'discard-item-character');
  if (discardItemEffect) {
    logDetail(`${combat.strikeEffect as string} strike effect: successful strike — character not wounded; must discard one item`);
    result = 'success';
    bodyCheckTarget = null;
  }

  // take-prisoner (e.g. Flies and Spiders dm-58): if the strike succeeds
  // against a character (not an ally) who has a hazard with a take-prisoner
  // effect, the character is taken prisoner instead of wounded.
  // Rule 8.35: allies cannot be taken prisoner — this only fires for characters.
  const takePrisonerResult = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && charData
    ? findTakePrisonerHazard(state, defPlayerIndex, charData.hazards)
    : null;

  // Troll-purse (dm-95): a successful strike from a re-faced automatic-attack
  // takes the character prisoner at the bound site instead of wounding. Carried
  // on the combat as `trollPursePrisoner` (set by buildSiteReFaceCombat).
  const trollPursePrisoner = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && !takePrisonerResult && charData
    ? combat.trollPursePrisoner ?? null
    : null;

  // absorb-wound (e.g. Sable Shield le-341): if a successful strike would wound
  // the bearer (not an ally, not detainment, not already handled), check if any
  // item on the character has an absorb-wound effect. If so, the wound is
  // prevented; the combat transitions to shield-discard-roll so the attacker
  // rolls to determine whether the shield is discarded.
  const absorbWoundItem = result === 'wounded' && !combat.detainment && !allyMatch && !discardItemEffect && !takePrisonerResult && !trollPursePrisoner && charData
    ? charData.items.find(item => {
        const def = state.cardPool[item.definitionId] as { effects?: readonly AbsorbWoundEffect[] } | undefined;
        return (def?.effects ?? []).some(e => e.type === 'absorb-wound');
      })
    : null;

  if (absorbWoundItem) {
    logDetail(`absorb-wound: ${absorbWoundItem.instanceId as string} absorbs strike — ${strike.characterId as string} not wounded`);
    // Use 'success' locally so the character taps (not wounds) in the status
    // application block below. The assignment records 'absorbed' so finalizeCombat
    // does not count this as a creature defeat.
    result = 'success';
    bodyCheckTarget = null;
  }

  // Whether the combatant taps on a non-wounded outcome (CoE rule 3.iv.7:
  // tapped on both fail and tie "unless a -3 modification was applied in
  // Step 3"):
  //  - tap:    always (success or tie)
  //  - reroll: same as tap, unless the defender chose to stay untapped
  //  - untap:  never (the -3 penalty was paid specifically to stay untapped)
  //  - dodge:  never
  const tapOnNonWounded = mode === 'tap' || (mode === 'reroll' && !rerollStayUntapped);

  // Record strike assignment. Dodge tags the strike so the body check picks
  // up the body penalty (CoE rule 3.I +1 for already-wounded still applies).
  // absorb-wound: record 'absorbed' (not 'success') so finalizeCombat does not
  // treat the absorb as a creature defeat.
  const wasAlreadyWounded = targetStatus === CardStatus.Inverted;
  // A tie (characterTotal === effectiveProwess) leaves the character unharmed
  // (local `result` stays 'success' so the tap/status logic below fires, tapping
  // unless in 'untap' mode — see tapOnNonWounded above), but the strike is NOT
  // defeated (CoE rule 8.19 / 3.iv.7 — "ineffectual"). Record
  // it as 'tie' rather than 'success' so finalizeCombat does not count the strike as
  // defeating the creature and award kill-MP for it. Note: absorb-wound and the
  // wounded-derived overrides (discard-item) only fire when result was 'wounded',
  // so they never coincide with a tie. A forced strike defeat (Liquid Fire wh-52,
  // Sacrifice of Form tw-321, Arrows Shorn of Ebony cascade) DOES fire on any
  // roll — the strike is defeated "regardless of the roll", so a tie must still
  // be recorded as 'success' or finalizeCombat would deny the defeat.
  const isTie = characterTotal === effectiveProwess && !combat.forcedStrikeDefeat;
  // take-prisoner: the character is captured, not wounded (CoE 8.35) — record
  // 'captured' so finalize-time wound triggers do not fire on the prisoner.
  // When a cancel-prisoner-taking ally can still intervene, keep 'wounded'
  // for now: an accepted cancel wounds the character normally, and the
  // decline handler rewrites the assignment to 'captured'.
  const cancelPrisonerAlly = (takePrisonerResult || trollPursePrisoner) && charData
    ? findCancelPrisonerTakingAlly(state, charData)
    : null;
  const assignmentResult = absorbWoundItem
    ? ('absorbed' as const)
    : (takePrisonerResult || trollPursePrisoner) && !cancelPrisonerAlly
      ? ('captured' as const)
      : isTie
        ? ('tie' as const)
        : result;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          resolved: true,
          result: assignmentResult,
          wasAlreadyWounded,
          strikeMode: mode,
          ...(mode === 'dodge' ? { dodged: true, dodgeBodyPenalty } : {}),
        }
      : a,
  );

  // wound-eliminates (Shelob's Lair spider, le-402): a wound dealt by this
  // attack eliminates the combatant immediately — no body check. Effects that
  // replace the wound entirely (absorb-wound and discard-item set result to
  // 'success'; take-prisoner is excluded explicitly) were handled above, so
  // only a genuine wound reaches here. Detainment strikes tap, never wound.
  if (combat.woundEliminates && result === 'wounded' && !combat.detainment && !takePrisonerResult && !trollPursePrisoner) {
    logDetail(`wound-eliminates: ${strike.characterId as string} wounded by ${combat.creatureRace ?? 'attack'} — immediately eliminated (no body check)`);
    return eliminateCombatantFromStrike(
      { ...state, rng, cheatRollTotal },
      { ...combat, strikeAssignments: newAssignments },
      effects,
    );
  }

  // Apply tap/wound to character or ally
  const newPlayers = clonePlayers(state);
  if (preAppliedDefender) newPlayers[defPlayerIndex] = preAppliedDefender;
  const workingDefender = newPlayers[defPlayerIndex];
  const newCharacters = { ...workingDefender.characters };

  if (allyMatch) {
    // Rule 8.36: allies cannot be taken prisoner, but they may face strikes
    // from untargeted attacks that would normally take a character prisoner
    // (e.g. a re-faced Troll-purse automatic-attack) — in that case the ally
    // is left entirely untouched: neither tapped nor wounded.
    if (!combat.trollPursePrisoner) {
      const hostChar = newCharacters[allyMatch.hostCharId];
      if (hostChar) {
        let newAllyStatus = allyMatch.ally.status;
        if (tapOnNonWounded && newAllyStatus === CardStatus.Untapped) {
          newAllyStatus = CardStatus.Tapped;
        }
        if (result === 'wounded' && !combat.detainment) {
          newAllyStatus = CardStatus.Inverted;
        } else if (result === 'wounded' && combat.detainment && !wasAlreadyWounded) {
          // CoE rule 3.II.1.1: a detainment strike never wounds — it taps an
          // untapped target instead. "tap" requires the card be initially
          // upright (glossary: "tap"), so an already-wounded (inverted) ally
          // stays wounded rather than being healed to tapped (mirrors the
          // character branch below).
          newAllyStatus = CardStatus.Tapped;
        }
        const newAllies = hostChar.allies.map(a =>
          a.instanceId === strike.characterId ? { ...a, status: newAllyStatus } : a,
        );
        newCharacters[allyMatch.hostCharId] = { ...hostChar, allies: newAllies };
      }
    } else {
      logDetail(`take-prisoner: ${strike.characterId as string} is an ally — untargeted prisoner-taking attack leaves it neither tapped nor wounded (rule 8.36)`);
    }
  } else {
    if (takePrisonerResult || trollPursePrisoner) {
      // cancel-prisoner-taking (Noble Hound dm-179): the controlling character
      // may carry an ally the player can discard to cancel the prisoner-taking
      // outcome and resolve the strike as a normal wound instead. Pause here
      // and let the defending player decide rather than applying prisoner
      // status immediately — applyTakePrisoner/applyTakePrisonerAtSite draw a
      // rescue site and add constraints that are not easily undone.
      const cancelAlly = cancelPrisonerAlly;
      if (cancelAlly) {
        logDetail(`cancel-prisoner-taking: ${cancelAlly.instanceId as string} may be discarded to cancel prisoner-taking of ${strike.characterId as string}`);
        const pausedCombat: CombatState = {
          ...combat,
          strikeAssignments: newAssignments,
          phase: 'cancel-prisoner-taking-choice',
          cancelPrisonerTakingOffer: { allyId: cancelAlly.instanceId },
        };
        return { state: { ...state, rng, cheatRollTotal, combat: pausedCombat }, effects };
      }
      // take-prisoner: character is not wounded; instead they become a prisoner.
      // Status stays as-is (not tapped, not wounded). Rule 8.35.
      const captor = takePrisonerResult?.hostCard.instanceId ?? trollPursePrisoner?.hostInstanceId;
      logDetail(`take-prisoner: ${strike.characterId as string} is taken prisoner by ${captor as string}`);
    } else {
      if (tapOnNonWounded && charData.status === CardStatus.Untapped) {
        newCharacters[strike.characterId] = { ...charData, status: CardStatus.Tapped };
      }
      if (result === 'wounded' && !combat.detainment) {
        newCharacters[strike.characterId] = {
          ...(newCharacters[strike.characterId] ?? charData),
          status: CardStatus.Inverted,
        };
      } else if (result === 'wounded' && combat.detainment) {
        // CoE rule 3.II.1.1: a detainment strike never wounds — it taps an
        // untapped target instead. "tap" requires the card be initially
        // upright (glossary: "tap"), so an already-wounded (inverted)
        // character stays wounded rather than being healed to tapped.
        if (!wasAlreadyWounded) {
          newCharacters[strike.characterId] = {
            ...(newCharacters[strike.characterId] ?? charData),
            status: CardStatus.Tapped,
          };
        }
      }

      // tap-low-mind (e.g. Wisp of Pale Sheen dm-113): "Any character facing a
      // strike whose mind is equal to or lower than the strike's prowess must
      // tap if untapped following the strike." Applies to characters (not
      // allies) regardless of strike outcome; wounded characters are now
      // inverted (not untapped) so are unaffected, as are avatars (mind null).
      if (combat.tapLowMindAfterStrike && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
        const finalChar = newCharacters[strike.characterId] ?? charData;
        if (charDef.mind <= combat.strikeProwess && finalChar.status === CardStatus.Untapped) {
          logDetail(`tap-low-mind: ${charLabel} mind ${charDef.mind} ≤ strike prowess ${combat.strikeProwess} — tapping following the strike`);
          newCharacters[strike.characterId] = { ...finalChar, status: CardStatus.Tapped };
        }
      }
    }
  }
  newPlayers[defPlayerIndex] = { ...workingDefender, characters: newCharacters, lastDiceRoll: roll };

  // Apply prisoner-taking: discard non-ring items, revert followers to GI,
  // add character-is-prisoner constraint, create HazardHost record.
  let postPrisonerState: GameState = { ...state, players: newPlayers, rng, cheatRollTotal };

  if (takePrisonerResult && charData) {
    postPrisonerState = applyTakePrisoner(
      postPrisonerState,
      defPlayerIndex,
      strike.characterId,
      takePrisonerResult,
    );
    // Override result and bodyCheckTarget: prisoner-taking skips wound/body-check
    bodyCheckTarget = null;
  } else if (trollPursePrisoner && charData) {
    postPrisonerState = applyTakePrisonerAtSite(
      postPrisonerState,
      defPlayerIndex,
      strike.characterId,
      trollPursePrisoner.hostInstanceId,
      trollPursePrisoner.siteInstanceId,
    );
    bodyCheckTarget = null;
  }

  // absorb-wound: shield absorbed the strike; transition to shield-discard-roll
  // so the attacking player rolls to determine if the shield is discarded.
  if (absorbWoundItem) {
    const combatWithShieldRoll: CombatState = {
      ...combat,
      strikeAssignments: newAssignments,
      phase: 'shield-discard-roll',
      shieldAbsorbItemId: absorbWoundItem.instanceId,
    };
    return { state: { ...postPrisonerState, combat: combatWithShieldRoll }, effects };
  }

  // face-strike-on-tap (Bow of Alatar wh-90): when the facing character parries
  // the strike he took via the item — the strike fails to wound him
  // (characterTotal >= effectiveProwess) — the attack's body is reduced for the
  // rest of the combat, making the creature easier to defeat via its body
  // checks. The reduction applies immediately, including to this strike's own
  // creature body check.
  const faceStrikeReduction = strike.reduceAttackBodyOnParry ?? 0;
  const strikeParried = characterTotal >= effectiveProwess;
  const combatBase: CombatState =
    faceStrikeReduction > 0 && strikeParried && combat.creatureBody !== null
      ? (() => {
          const reduced = Math.max(0, combat.creatureBody - faceStrikeReduction);
          logDetail(`Bow of Alatar: parried strike — attack body reduced ${combat.creatureBody} → ${reduced}`);
          return { ...combat, creatureBody: reduced };
        })()
      : combat;

  // Advance combat: body check, next strike, or finalize
  if (bodyCheckTarget) {
    const newCombat: CombatState = { ...combatBase, strikeAssignments: newAssignments, phase: 'body-check', bodyCheckTarget };
    return { state: { ...postPrisonerState, combat: newCombat }, effects };
  } else {
    // Arrows Shorn of Ebony (td-99): a strike marked cascadesOnDefeat that
    // ends up defeated with no creature body check pending (the creature has
    // no body, so 'success' here is already final) auto-defeats every other
    // still-unresolved strike of the same attack. When the creature DOES have
    // body, bodyCheckTarget is set and this branch is not reached — the
    // cascade decision is deferred to handleBodyCheckRoll instead, since
    // 'success' is not yet final until that body check resolves.
    const cascadeAutoDefeat = assignmentResult === 'success' && strike.cascadesOnDefeat === true;
    if (cascadeAutoDefeat) {
      logDetail('Cascade defeat (Arrows Shorn of Ebony): remaining strikes of this attack automatically defeated');
    }
    const combatWithAssignments = {
      ...combatBase,
      strikeAssignments: newAssignments,
      ...(cascadeAutoDefeat ? { forcedStrikeDefeat: true } : {}),
    };

    // discard-item strike effect: enter discard-item-from-company phase so the
    // defender must choose one item to discard before combat continues.
    // 'discard-item-character' (Pick-pocket tw-79) scopes the pool to items
    // borne by the struck character alone, not the whole company.
    if (discardItemEffect) {
      const companyCharIds = combat.strikeEffect === 'discard-item-character'
        ? [strike.characterId]
        : company?.characters ?? [];
      const allItems: ItemInPlay[] = companyCharIds.flatMap(charId => {
        const ch = newPlayers[defPlayerIndex].characters[charId];
        return ch ? [...ch.items] : [];
      });
      if (allItems.length > 0) {
        logDetail(`Entering discard-item-from-company phase: ${allItems.length} item(s) available`);
        const newCombat: CombatState = { ...combatWithAssignments, phase: 'discard-item-from-company', discardItemOptions: allItems };
        return { state: { ...postPrisonerState, combat: newCombat }, effects };
      }
      logDetail('discard-item strike effect: no items in company — effect skipped');
    }

    return advanceStrikeOrFinalize(postPrisonerState, combatWithAssignments, effects);
  }
}

/**
 * Eliminate the combatant (character or ally) targeted by the current strike,
 * regardless of any body check. Shared by the failed-body-check path
 * (`effectiveRoll > body`) and by "immediate elimination" attack rules such as
 * the Spider at Shelob's Lair (le-402, `wound-eliminates`). Per CoE rule 3.i.5
 * any remaining unresolved strikes against the same combatant auto-resolve as
 * successful; per CoE rule 3.I.2 each unwounded companion may salvage one of the
 * eliminated character's items. Allies are eliminated to the out-of-play pile
 * (CoE 2.V.2.2); their host's other cards are untouched.
 *
 * The current strike assignment is marked `'eliminated'`; the caller is
 * responsible for having already recorded it as `resolved` if needed.
 *
 * @param state - Current game state. For body checks this is the post-roll
 *   state; for immediate elimination it is the post-strike state.
 * @param combat - The active combat state (its `strikeAssignments` are rewritten).
 * @param effects - Accumulated game effects (e.g. dice rolls) to thread through.
 */
export function eliminateCombatantFromStrike(
  state: GameState,
  combat: CombatState,
  effects: GameEffect[],
): ReducerResult {
  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  const charData = defPlayer.characters[strike.characterId];
  const company = companyById(defPlayer.companies, combat.companyId);
  const allyMatch = !charData && company
    ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
    : undefined;

  // Per CoE rule 3.i.5: remaining unresolved strikes assigned to the same
  // combatant are considered successful (defeated by the defender).
  const newAssignments = combat.strikeAssignments.map((a, i) => {
    if (i === combat.currentStrikeIndex) return { ...a, resolved: true, result: 'eliminated' as const };
    if (!a.resolved && a.characterId === strike.characterId) {
      logDetail(`Strike ${i} auto-resolved as successful (eliminated combatant, CoE 3.i.5)`);
      return { ...a, resolved: true, result: 'success' as const };
    }
    return a;
  });

  const newPlayers2 = clonePlayers(state);
  const newPlayerData = { ...defPlayer };
  const combatWithElim = { ...combat, strikeAssignments: newAssignments };

  if (allyMatch) {
    // Ally eliminated — remove from host character and send to eliminated pile.
    const hostChar = newPlayerData.characters[allyMatch.hostCharId];
    if (hostChar) {
      const newAllies = hostChar.allies.filter(a => a.instanceId !== strike.characterId);
      newPlayerData.characters = {
        ...newPlayerData.characters,
        [allyMatch.hostCharId as string]: { ...hostChar, allies: newAllies },
      };
    }
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, {
      instanceId: strike.characterId,
      definitionId: allyMatch.ally.definitionId,
    }];
    newPlayers2[defPlayerIndex] = newPlayerData;

    return advanceStrikeOrFinalize({ ...state, players: newPlayers2 }, combatWithElim, effects);
  }

  // Character eliminated — remove from company and add to eliminated pile
  if (company) {
    newPlayerData.companies = newPlayerData.companies.map(c =>
      c.id === combat.companyId
        ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
        : c,
    );
  }
  const elimCharDefId = resolveInstanceId(state, strike.characterId);
  const elimCharInstance = { instanceId: strike.characterId, definitionId: elimCharDefId! };
  // CoE rule 3.v: in company vs. company combat, a defending character
  // eliminated by the attacker's strike awards its MP value to the attacker
  // as kill MP (killPile), mirroring the `attacker-character` body-check-target
  // path in combat-actions.ts. Outside CvCC (e.g. a hazard creature killing a
  // hero character), the eliminated character simply leaves play.
  if (combat.isCvCC) {
    const atkPlayerIdx = getPlayerIndex(state, combat.attackingPlayerId);
    newPlayers2[atkPlayerIdx] = { ...newPlayers2[atkPlayerIdx], killPile: [...newPlayers2[atkPlayerIdx].killPile, elimCharInstance] };
  } else {
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, elimCharInstance];
  }

  // Discard allies on the eliminated character immediately (an ally that returns
  // to hand when its controller leaves play — Radagast's Black Bird wh-114 —
  // goes to the owner's hand instead); hazards go to opposing (hazard) player.
  {
    const { toHand, toDiscard } = partitionLeavingAllies(state, charData.allies);
    if (toHand.length > 0) logDetail(`${toHand.length} ally(ies) return to hand from eliminated character`);
    newPlayerData.hand = [...newPlayerData.hand, ...toHand];
    newPlayerData.discardPile = [...newPlayerData.discardPile, ...toDiscard];
  }
  // Trophies on the eliminated Orc/Troll are relocated per CoE 3.IV.4 — worth
  // MP → the holder's marshalling-point pile, otherwise removed from play — or
  // the creature CardInstance would vanish with the deleted character.
  {
    const { toKillPile, toOutOfPlay } = partitionLeavingTrophies(state, charData, 'eliminated character');
    newPlayerData.killPile = [...newPlayerData.killPile, ...toKillPile];
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, ...toOutOfPlay];
  }
  newPlayers2[defPlayerIndex] = newPlayerData;
  const hazardPlayerElim = newPlayers2[1 - defPlayerIndex];
  let hazardDiscardElim = [...hazardPlayerElim.discardPile];
  for (const hazard of charData.hazards) {
    logDetail(`Discarding hazard ${hazard.instanceId as string} from eliminated character`);
    hazardDiscardElim = [...hazardDiscardElim, toCardInstance(hazard)];
  }
  newPlayers2[1 - defPlayerIndex] = { ...hazardPlayerElim, discardPile: hazardDiscardElim };

  const { [strike.characterId]: _, ...remainingChars } = newPlayers2[defPlayerIndex].characters;
  // Followers of the eliminated character lose their controller — revert to
  // general influence with the mind subtraction deferred to the player's next
  // organization phase (CoE rule 3.13 — combat never happens during the
  // controller's organization phase).
  const charsWithFreedFollowers = { ...remainingChars };
  for (const followerId of charData.followers) {
    const follower = charsWithFreedFollowers[followerId];
    if (follower) {
      logDetail(`Follower ${followerId as string} of eliminated character reverts to general influence (subtraction deferred, CoE 3.13)`);
      charsWithFreedFollowers[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true, ...ringwraithReclaimMark(state, follower) };
    }
  }
  const prunedChars = pruneLeaderFollowers(charsWithFreedFollowers, strike.characterId, charData.controlledBy);
  newPlayers2[defPlayerIndex] = { ...newPlayers2[defPlayerIndex], characters: prunedChars };

  // Per CoE rule 3.I.2: for each unwounded character in the same company,
  // an item the eliminated character controlled may be transferred (one per
  // recipient); "all other non-follower cards" the character controlled are
  // discarded immediately. `charData.items` also holds permanent events
  // attached via `in-play-on-character` (e.g. Align Palantír tw-190, which
  // is not itself an item but is stored alongside items for its bearer) —
  // those are not salvageable and go straight to the discard pile.
  const salvageItems = charData.items.filter(item => isItemCard(defById(state, item.definitionId)));
  const nonItemPermanentEvents = charData.items.filter(item => !isItemCard(defById(state, item.definitionId)));
  for (const item of nonItemPermanentEvents) {
    const itemDef = defById(state, item.definitionId);
    logDetail(`Discarding non-item permanent event "${itemDef?.name ?? item.instanceId as string}" from eliminated character (not salvageable, CoE 3.I.2)`);
  }
  if (nonItemPermanentEvents.length > 0) {
    newPlayers2[defPlayerIndex] = {
      ...newPlayers2[defPlayerIndex],
      discardPile: [...newPlayers2[defPlayerIndex].discardPile, ...nonItemPermanentEvents.map(toCardInstance)],
    };
  }
  const unwoundedRecipients: CardInstanceId[] = company
    ? company.characters
      .filter(ch => ch !== strike.characterId)
      .filter(ch => {
        const cd = newPlayerData.characters[ch];
        return cd && cd.status !== CardStatus.Inverted;
      })
    : [];

  if (salvageItems.length > 0 && unwoundedRecipients.length > 0) {
    logDetail(`Entering item-salvage phase: ${salvageItems.length} item(s) available, ${unwoundedRecipients.length} unwounded recipient(s)`);
    const combatWithSalvage: CombatState = {
      ...combatWithElim,
      phase: 'item-salvage',
      salvageItems,
      salvageRecipients: unwoundedRecipients,
    };
    return { state: { ...state, players: newPlayers2, combat: combatWithSalvage }, effects };
  }

  // No items or no recipients — discard all items immediately
  for (const item of salvageItems) {
    logDetail(`Discarding item ${item.instanceId as string} (no salvage possible)`);
    newPlayers2[defPlayerIndex] = {
      ...newPlayers2[defPlayerIndex],
      discardPile: [...newPlayers2[defPlayerIndex].discardPile, toCardInstance(item)],
    };
  }

  // Advance to next strike or finalize
  return advanceStrikeOrFinalize({ ...state, players: newPlayers2 }, combatWithElim, effects);
}

/** Resolve the current strike — roll dice and determine outcome. */
export function handleResolveStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'resolve-strike') return wrongActionType(state, action, 'resolve-strike');

  // CvCC two-step sub-phase
  if (combat.isCvCC) {
    const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
    if (!currentStrike) return { state, error: 'No current strike' };

    if (currentStrike.attackerTapToFight === undefined) {
      // Sub-step 1: attacker declares their -3 choice
      logDetail(`CvCC sub-step 1: attacker ${action.tapToFight ? 'taps' : 'stays untapped (-3)'}`);
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex
          ? { ...a, attackerTapToFight: action.tapToFight }
          : a,
      );
      return {
        state: { ...state, combat: { ...combat, strikeAssignments: newAssignments } },
      };
    }

    // Sub-step 2: defender resolves — both sides roll and compare
    return resolveStrikeCvCC(state, combat, action.tapToFight);
  }

  return resolveStrikeCore(state, combat, action.tapToFight ? 'tap' : 'untap', 0, null);
}

/**
 * CvCC dual-roll strike resolution (rule 8.38–8.39).
 *
 * Both sides roll 2d6 + prowess. Higher total wins; the loser is wounded
 * (body check). On a tie, both tap (unless they chose to stay untapped).
 *
 * Attacker's tap choice was already stored in `attackerTapToFight`.
 * Defender's tap choice is passed as `defenderTapToFight`.
 *
 * Prowess modifiers:
 * - Attacker: effectiveStats.prowess, −3 if !attackerTapToFight, −1 if tapped, −2 if wounded
 * - Defender: effectiveStats.prowess, −3 if !defenderTapToFight, −1 if tapped, −2 if wounded
 * - Support bonus applied to each side separately via supportCount
 */
export function resolveStrikeCvCC(
  state: GameState,
  combat: CombatState,
  defenderTapToFight: boolean,
): ReducerResult {
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved or missing' };
  if (strike.attackingCharacterId == null) return { state, error: 'CvCC strike has no attacking character' };
  if (strike.attackerTapToFight === undefined) return { state, error: 'Attacker has not declared -3 choice' };

  const atkSource = combat.attackSource;
  if (atkSource.type !== 'company-attack') return { state, error: 'Not a CvCC attack' };

  // Look up attacker character
  const atkPlayerIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const atkPlayer = state.players[atkPlayerIdx];
  const atkCharData = atkPlayer.characters[strike.attackingCharacterId];
  if (!atkCharData) return { state, error: `Attacking character ${strike.attackingCharacterId as string} not found` };
  const atkCharDef = defById(state, atkCharData.definitionId);
  const atkCharName = (atkCharDef as { name?: string } | undefined)?.name ?? (strike.attackingCharacterId as string);

  // Look up defender character
  const defPlayerIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIdx];
  const defCharData = defPlayer.characters[strike.characterId];
  if (!defCharData) return { state, error: `Defending character ${strike.characterId as string} not found` };
  const defCharDef = defById(state, defCharData.definitionId);
  const defCharName = (defCharDef as { name?: string } | undefined)?.name ?? (strike.characterId as string);

  // Compute attacker prowess
  let atkProwess = atkCharData.effectiveStats.prowess;
  if (!strike.attackerTapToFight) atkProwess -= computeStayUntappedPenalty(state, atkCharData, atkCharDef);
  if (atkCharData.status === CardStatus.Tapped) atkProwess -= 1;
  if (atkCharData.status === CardStatus.Inverted) atkProwess -= 2;

  // Compute defender prowess
  let defProwess = defCharData.effectiveStats.prowess;
  if (!defenderTapToFight) defProwess -= computeStayUntappedPenalty(state, defCharData, defCharDef);
  if (defCharData.status === CardStatus.Tapped) defProwess -= 1;
  if (defCharData.status === CardStatus.Inverted) defProwess -= 2;
  if (strike.excessStrikes > 0) defProwess -= strike.excessStrikes;
  defProwess += (strike.supportCount ?? 0);
  defProwess += (strike.strikeProwessBonus ?? 0);

  // Roll for attacker
  const atkRollResult = roll2d6(state);
  const atkRoll = atkRollResult.roll;
  const atkTotal = atkRoll.die1 + atkRoll.die2 + atkProwess;

  // Roll for defender using updated RNG state
  const defState = { ...state, rng: atkRollResult.rng, cheatRollTotal: atkRollResult.cheatRollTotal };
  const defRollResult = roll2d6(defState);
  const defRoll = defRollResult.roll;
  const defTotal = defRoll.die1 + defRoll.die2 + defProwess;

  logDetail(`CvCC dual-roll: ${atkCharName} (${atkPlayer.name}) rolls ${atkRoll.die1}+${atkRoll.die2}=${atkRoll.die1 + atkRoll.die2} + prowess ${atkProwess} = ${atkTotal} (lastDiceRoll → players[${atkPlayerIdx}])`);
  logDetail(`CvCC dual-roll: ${defCharName} (${defPlayer.name}) rolls ${defRoll.die1}+${defRoll.die2}=${defRoll.die1 + defRoll.die2} + prowess ${defProwess} = ${defTotal} (lastDiceRoll → players[${defPlayerIdx}])`);

  const effects: GameEffect[] = [
    diceRollEffect(atkPlayer.name, atkRoll, `CvCC Strike: ${atkCharName}`, atkTotal),
    diceRollEffect(defPlayer.name, defRoll, `CvCC Strike: ${defCharName}`, defTotal),
  ];

  // Determine outcome
  const newPlayers = clonePlayers(state);
  // Store dice rolls so the UI can display them in the text log
  newPlayers[atkPlayerIdx] = { ...newPlayers[atkPlayerIdx], lastDiceRoll: atkRoll };
  newPlayers[defPlayerIdx] = { ...newPlayers[defPlayerIdx], lastDiceRoll: defRoll };

  let defResult: 'success' | 'wounded' | 'eliminated';
  let atkResult: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'attacker-character' | null = null;
  const defWasAlreadyWounded = defCharData.status === CardStatus.Inverted;
  const atkWasAlreadyWounded = atkCharData.status === CardStatus.Inverted;

  if (atkTotal > defTotal) {
    // Attacker wins: defender wounded, attacker taps (unless -3)
    defResult = 'wounded';
    atkResult = 'success';
    bodyCheckTarget = 'character';
    logDetail(`CvCC: attacker wins (${atkTotal} > ${defTotal}) — defender wounded`);
    if (strike.attackerTapToFight && atkCharData.status === CardStatus.Untapped) {
      newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Tapped);
      logDetail(`CvCC: attacker taps`);
    }
  } else if (defTotal > atkTotal) {
    // Defender wins: attacker wounded, defender taps (unless -3)
    defResult = 'success';
    atkResult = 'wounded';
    bodyCheckTarget = 'attacker-character';
    logDetail(`CvCC: defender wins (${defTotal} > ${atkTotal}) — attacker wounded`);
    if (defenderTapToFight && defCharData.status === CardStatus.Untapped) {
      newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Tapped);
      logDetail(`CvCC: defender taps`);
    }
  } else {
    // Tie: both tap unless -3, no wound, no body check
    defResult = 'success';
    atkResult = 'success';
    bodyCheckTarget = null;
    logDetail(`CvCC: tie (${atkTotal} = ${defTotal}) — both tap (unless -3)`);
    if (strike.attackerTapToFight && atkCharData.status === CardStatus.Untapped) {
      newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Tapped);
    }
    if (defenderTapToFight && defCharData.status === CardStatus.Untapped) {
      newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Tapped);
    }
  }

  // Apply wound to loser
  if (defResult === 'wounded') {
    newPlayers[defPlayerIdx] = updatePlayerCharacterStatus(newPlayers[defPlayerIdx], strike.characterId, CardStatus.Inverted);
    logDetail(`CvCC: defending character ${defCharName} is wounded`);
  }
  if (atkResult === 'wounded') {
    newPlayers[atkPlayerIdx] = updatePlayerCharacterStatus(newPlayers[atkPlayerIdx], strike.attackingCharacterId, CardStatus.Inverted);
    logDetail(`CvCC: attacking character ${atkCharName} is wounded`);
  }

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          resolved: bodyCheckTarget === null,
          result: defResult,
          attackerResult: atkResult,
          wasAlreadyWounded: defWasAlreadyWounded,
          attackerWasAlreadyWounded: atkWasAlreadyWounded,
        }
      : a,
  );

  const combatWithAssignments: CombatState = {
    ...combat,
    strikeAssignments: newAssignments,
    bodyCheckTarget,
    rng: defRollResult.rng,
    cheatRollTotal: defRollResult.cheatRollTotal,
  } as CombatState & { rng: unknown; cheatRollTotal: unknown };

  const stateWithRoll: GameState = {
    ...state,
    rng: defRollResult.rng,
    cheatRollTotal: defRollResult.cheatRollTotal,
    players: newPlayers,
    combat: combatWithAssignments,
  };

  if (bodyCheckTarget !== null) {
    const combatInBodyCheck: CombatState = { ...combatWithAssignments, phase: 'body-check', bodyCheckTarget };
    return { state: { ...stateWithRoll, combat: combatInBodyCheck }, effects };
  }

  // No body check — advance to next strike
  return advanceStrikeOrFinalize(stateWithRoll, combatWithAssignments, effects);
}

/** Update a player's character to a new status (inline utility for CvCC). */
export function updatePlayerCharacterStatus(
  player: import('../types/state-player.js').PlayerState,
  charId: CardInstanceId,
  status: CardStatus,
): import('../types/state-player.js').PlayerState {
  const ch = player.characters[charId];
  if (!ch) return player;
  return {
    ...player,
    characters: {
      ...player.characters,
      [charId as string]: { ...ch, status },
    },
  };
}

