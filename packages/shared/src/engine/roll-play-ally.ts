/**
 * @module roll-play-ally
 *
 * The `roll-play-ally` short-event mechanic — Here, There, or Yonder (td-123):
 * "Tap a character during his site phase at a tapped or untapped Ruins & Lairs.
 * Make a roll modified by +3 if character is a diplomat. An ally may be played
 * and placed under the character's control if the result is greater than 6 plus
 * the ally's mind stat and the ally is not restricted from moving in this
 * site's region. If an ally is played, tap the site if it is not already
 * tapped."
 *
 * Flow: the short event is declared with the tapped character as its cost
 * (`targetScoutInstanceId`) and rides the chain of effects (CoE 9.4/9.5). On
 * un-negated resolution {@link applyShortEventRollPlayAlly} rolls 2d6 for the
 * character and enqueues an `ally-placement-offer` pending resolution carrying
 * the roll total. The offer's legal actions ({@link allyPlacementOfferCandidates})
 * list every hand ally that clears the roll and may legally join the company;
 * accepting attaches the ally to the character and taps the site.
 */

import type { CardDefinition, AllyCard, SiteCard } from '../types/cards.js';
import { isAllyCard, isCharacterCard, isSiteCard } from '../types/cards.js';
import type { CardInstanceId, GameState, GameAction, PlayerId, PlayerState, Company, GameEffect, EvaluatedAction, PendingResolution } from '../index.js';
import type { Condition, RollPlayAllyEffect } from '../types/effects.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { getEffectiveSkills } from './effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { dequeueResolution, enqueueResolution } from './pending.js';
import { recomputeDerived } from './recompute-derived.js';
import type { ReducerResult } from './reducer-utils.js';
import {
  companyBlocksJoins, companyHasNoAllyRestriction, countAttachedInCompany, defById, diceRollEffect,
  findCharacterCompany, findDuplicationLimitEffect, getCardEffects, getOnEventEffects, isSelfDiscardMove,
  matchesDefinition, roll2d6, updatePlayer,
} from './reducer-utils.js';
import { manifestationOfEntityInPlay } from './manifestations.js';
import { wizardSpecificName } from './fallen-wizard-specific.js';

/** Find the card's `roll-play-ally` effect, if any. */
export function findRollPlayAllyEffect(def: CardDefinition | undefined): RollPlayAllyEffect | undefined {
  return getCardEffects(def).find((e): e is RollPlayAllyEffect => e.type === 'roll-play-ally');
}

/**
 * True when `allyDef` is restricted from moving to `siteDef` — i.e. its
 * printed "Discard if his company moves to a site that is not in …" clause
 * (CRF 22: an ally's movement restriction) would fire were its company to
 * move to that site. Both encodings are honoured: a `bearer-company-moves`
 * self-discard (evaluated against `destination.*`) and a
 * `company-arrives-at-site` self-discard (evaluated against `site.*`). An
 * `ally-movement-restriction-exemption` the player carries (Radagast wh-8)
 * lifts the restriction for matching allies.
 */
export function allyRestrictedFromMovingTo(
  state: GameState,
  player: PlayerState,
  allyDef: CardDefinition,
  siteDef: SiteCard,
): boolean {
  const siteCtx = { name: siteDef.name, region: siteDef.region, siteType: siteDef.siteType };
  const fires = (event: 'bearer-company-moves' | 'company-arrives-at-site', ctx: Record<string, unknown>): boolean =>
    getOnEventEffects(allyDef, event).some(e => isSelfDiscardMove(e.apply) && (!e.when || matchesCondition(e.when, ctx)));
  const restricted = fires('bearer-company-moves', { destination: siteCtx })
    || fires('company-arrives-at-site', { site: siteCtx });
  if (!restricted) return false;

  const exemptions: (Condition | null)[] = [];
  for (const def of [
    ...player.cardsInPlay.map(c => defById(state, c.definitionId)),
    ...Object.values(player.characters).map(c => defById(state, c.definitionId)),
  ]) {
    for (const eff of getCardEffects(def)) {
      if (eff.type === 'ally-movement-restriction-exemption') exemptions.push(eff.filter ?? null);
    }
  }
  return !exemptions.some(f => f === null || matchesDefinition(allyDef, f));
}

/**
 * Why `allyDef` may not be played under `characterId` in `company` through a
 * `roll-play-ally` offer with the given roll total, or `null` when it may.
 * Mirrors the ally gates of the ordinary site-phase play (uniqueness incl.
 * eliminated copies, manifestations, company duplication limit, company join
 * blocks, wizard-specific control) — but never the ally's printed
 * `playableAt` nor the site's tapped status, which the event waives.
 */
export function rollPlayAllyIneligibility(
  state: GameState,
  player: PlayerState,
  company: Company,
  characterId: CardInstanceId,
  allyDef: AllyCard,
  rollTotal: number,
  threshold: number,
): string | null {
  const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  if (!siteDef || !isSiteCard(siteDef)) return 'company is not at a site';
  if (rollTotal <= threshold + allyDef.mind) {
    return `roll ${rollTotal} is not greater than ${threshold} + mind ${allyDef.mind}`;
  }
  if (allyRestrictedFromMovingTo(state, player, allyDef, siteDef)) {
    return `restricted from moving in ${siteDef.region}`;
  }
  const manifestation = manifestationOfEntityInPlay(state, allyDef);
  if (manifestation) return `a manifestation (${manifestation}) is already in play`;
  if (allyDef.unique) {
    const inPlay = state.players.some(p =>
      Object.values(p.characters).some(ch => ch.allies.some(a => defById(state, a.definitionId)?.name === allyDef.name)));
    const eliminated = state.players.some(p =>
      p.outOfPlayPile.some(c => !c.removedFromGame && defById(state, c.definitionId)?.name === allyDef.name));
    if (inPlay || eliminated) return 'unique and already in play';
  }
  const dupLimit = findDuplicationLimitEffect(allyDef, 'company');
  if (dupLimit && countAttachedInCompany(state, player, company, allyDef.name, 'allies') >= dupLimit.max) {
    return 'cannot be duplicated in a given company';
  }
  if (companyBlocksJoins(state, company.id)) return 'no ally may join this company';
  if (companyHasNoAllyRestriction(state, player, company)) return 'no ally may be in this company';
  const requiredController = wizardSpecificName(allyDef);
  if (requiredController !== null) {
    const charDef = defById(state, player.characters[characterId]?.definitionId);
    if (!isCharacterCard(charDef) || charDef.name !== requiredController) return `only ${requiredController} may control it`;
  }
  return null;
}

/**
 * Hand allies a queued `ally-placement-offer` may place under its character.
 */
export function allyPlacementOfferCandidates(
  state: GameState,
  player: PlayerState,
  characterId: CardInstanceId,
  rollTotal: number,
  threshold: number,
): CardInstanceId[] {
  const company = findCharacterCompany(player.companies, characterId);
  if (!company) return [];
  const out: CardInstanceId[] = [];
  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    if (!isAllyCard(def)) continue;
    const reason = rollPlayAllyIneligibility(state, player, company, characterId, def, rollTotal, threshold);
    if (reason) {
      logDetail(`ally-placement-offer: ${def.name} not offered — ${reason}`);
      continue;
    }
    out.push(card.instanceId);
  }
  return out;
}

/**
 * Resolve a `roll-play-ally` short event once its chain entry resolves
 * un-negated: roll 2d6 for the tapped character (+`diplomatBonus` when he is a
 * diplomat) and enqueue the `ally-placement-offer` carrying the total. When
 * the character has left play in the meantime the roll is skipped.
 */
export function applyShortEventRollPlayAlly(
  state: GameState,
  def: CardDefinition,
  sourceInstanceId: CardInstanceId,
  actor: PlayerId,
  characterId: CardInstanceId | undefined,
): ReducerResult & { effects?: readonly GameEffect[] } {
  const effect = findRollPlayAllyEffect(def);
  if (!effect) return { state, error: `${def.name}: no roll-play-ally effect` };
  if (!characterId) return { state, error: `${def.name}: no tapped character` };
  const playerIndex = getPlayerIndex(state, actor);
  const player = state.players[playerIndex];
  const char = player.characters[characterId];
  const charDef = char ? defById(state, char.definitionId) : undefined;
  if (!char || !isCharacterCard(charDef)) return { state, error: `${def.name}: character ${characterId as string} is no longer in play` };

  const isDiplomat = getEffectiveSkills(state, char, charDef).includes('diplomat');
  const modifier = isDiplomat ? effect.diplomatBonus : 0;
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  logDetail(`${def.name}: ${charDef.name} rolls ${roll.die1} + ${roll.die2}${modifier ? ` + ${modifier} (diplomat)` : ''} = ${total} — allies with mind below ${total - effect.threshold} may be played`);
  const rollEffect = diceRollEffect(player.name, roll, `${def.name}: ${charDef.name}`, total);

  const next = enqueueResolution({ ...state, rng, cheatRollTotal }, {
    source: sourceInstanceId,
    actor,
    scope: { kind: 'phase', phase: state.phaseState.phase },
    kind: {
      type: 'ally-placement-offer',
      characterInstanceId: characterId,
      rollTotal: total,
      threshold: effect.threshold,
      tapSite: effect.tapSite === true,
    },
  });
  return { state: next, effects: [rollEffect] };
}

/**
 * Place `allyInstanceId` from the player's hand under `characterId` and, when
 * `tapSite` is set, tap the character's company's current site.
 */
export function placeOfferedAlly(
  state: GameState,
  playerIndex: number,
  characterId: CardInstanceId,
  allyInstanceId: CardInstanceId,
  tapSite: boolean,
): ReducerResult {
  const player = state.players[playerIndex];
  const handCard = player.hand.find(c => c.instanceId === allyInstanceId);
  if (!handCard) return { state, error: `Ally ${allyInstanceId as string} not in hand` };
  const char = player.characters[characterId];
  if (!char) return { state, error: `Character ${characterId as string} no longer in play` };
  const company = findCharacterCompany(player.companies, characterId);
  logDetail(`ally-placement-offer: ${defById(state, handCard.definitionId)?.name ?? '?'} joins ${defById(state, char.definitionId)?.name ?? '?'}${tapSite ? ' — site taps' : ''}`);
  const next = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: p.hand.filter(c => c.instanceId !== allyInstanceId),
    characters: {
      ...p.characters,
      [characterId as string]: {
        ...char,
        allies: [...char.allies, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
      },
    },
    companies: tapSite && company?.currentSite
      ? p.companies.map(co => co.id === company.id && co.currentSite
        ? { ...co, currentSite: { ...co.currentSite, status: CardStatus.Tapped } }
        : co)
      : p.companies,
  }));
  return { state: next };
}

/**
 * Legal actions for a queued `ally-placement-offer`: one
 * `play-ally-placement-offer` per eligible hand ally, plus `pass` to decline.
 */
export function allyPlacementOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'ally-placement-offer') return [];
  const actions: EvaluatedAction[] = [{ action: { type: 'pass', player: actor }, viable: true }];
  const player = state.players.find(p => p.id === actor);
  if (!player) return actions;
  const { characterInstanceId, rollTotal, threshold } = top.kind;
  for (const allyId of allyPlacementOfferCandidates(state, player, characterInstanceId, rollTotal, threshold)) {
    actions.push({
      action: { type: 'play-ally-placement-offer', player: actor, cardInstanceId: allyId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Resolve a queued `ally-placement-offer`: `pass` declines (nothing is
 * played, the site stays as it is); `play-ally-placement-offer` re-validates
 * the chosen ally, places it under the offer's character and taps the site.
 */
export function applyAllyPlacementOfferResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'ally-placement-offer') return null;
  if (action.type === 'pass') {
    logDetail('ally-placement-offer: player declines — no ally played');
    return { state: dequeueResolution(state, top.id) };
  }
  if (action.type !== 'play-ally-placement-offer') {
    return { state, error: `Pending ally-placement-offer requires 'play-ally-placement-offer' or pass, got '${action.type}'` };
  }
  if (action.player !== top.actor) return { state, error: 'Wrong player for pending ally-placement-offer' };
  const playerIndex = getPlayerIndex(state, action.player);
  const { characterInstanceId, rollTotal, threshold, tapSite } = top.kind;
  const candidates = allyPlacementOfferCandidates(state, state.players[playerIndex], characterInstanceId, rollTotal, threshold);
  if (!candidates.includes(action.cardInstanceId)) {
    return { state, error: `${action.cardInstanceId as string} may not be played by this ally-placement offer` };
  }
  const placed = placeOfferedAlly(state, playerIndex, characterInstanceId, action.cardInstanceId, tapSite);
  if (placed.error) return placed;
  return { state: recomputeDerived(dequeueResolution(placed.state, top.id)) };
}
