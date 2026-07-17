/**
 * @module grant-action-apply
 *
 * Resolves the `activate-granted-action` action — the single entry point every
 * phase reducer delegates to when a character activates a card- or
 * constraint-granted ability (corruption removal, transform-site, cancel
 * effects, item placement, sub-attacks, …). Extracted wholesale from
 * `reducer-organization.ts` so it sits below both `reducer-organization` and
 * `reducer-events` in the dependency graph: `reducer-events` previously had to
 * import `handleGrantActionApply` from `reducer-organization` while
 * `reducer-organization` imported the event-play handlers from
 * `reducer-events`, forming an import cycle. The subsystem calls neither module,
 * so relocating it here breaks that cycle — every phase reducer (organization,
 * events, free-council, end-of-turn, movement-hazard, site) now imports
 * `handleGrantActionApply` from this leaf instead.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, GameAction, GameEffect, CharacterInPlay, PlayerState, CardInstanceId } from '../index.js';
import type { ReducerResult } from './reducer-utils.js';
import { formatSignedNumber } from '../format-helpers.js';
import { shuffle } from '../rng.js';
import { getPlayerIndex } from '../state-utils.js';
import { CardStatus, cardStatusFromName } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { roll2d6, diceRollEffect, clonePlayers, toCardInstance, updatePlayer, updateCharacter, findCharacterCompany, getCardEffects, defById } from './reducer-utils.js';
import { enqueueCorruptionCheck, addConstraint, removeConstraint } from './pending.js';
import { recomputeDerived } from './recompute-derived.js';
import { collectCharacterEffects, resolveCheckModifier, resolveDef } from './effects/index.js';
import { applyMove as applyMoveLocal } from './reducer-move.js';
import { applyCost } from './cost-evaluator.js';

/**
 * Context for executing a grant-action apply: everything the inner
 * dispatch needs. Kept in one record so the recursive apply walker
 * (e.g. `roll-then-apply` → onSuccess) can reuse it without repeating
 * argument lists.
 */
interface GrantApplyContext {
  readonly action: Extract<GameAction, { type: 'activate-granted-action' }>;
  readonly playerIndex: number;
  readonly charName: string;
  readonly sourceName: string;
  readonly sourceCardDefinitionId: import('../types/common.js').CardDefinitionId;
}

/** Result of running one apply: the updated character plus optional
 *  engine effects (dice rolls) and post-write state transforms (adding
 *  constraints, enqueuing corruption checks). The caller writes
 *  `updatedChar` back to players first, then folds `stateOps` over the
 *  resulting state so the transforms see the tapped/detached character.
 */
type ApplyOk = {
  updatedChar: CharacterInPlay;
  effects: GameEffect[];
  stateOps: Array<(state: GameState) => GameState>;
};

/**
 * Move a fetched item instance from the player's discard pile, sideboard, or
 * hand onto a recipient character's `items`, untapped (The Forge-master wh-117
 * `place-item-on-character` apply). The item is searched across all three zones
 * by instance ID; the recipient is one of the activating player's characters.
 * No card instance is lost — the item simply changes zones.
 */
function placeFetchedItemOnCharacter(
  state: GameState,
  playerIndex: number,
  itemId: CardInstanceId,
  recipientId: CardInstanceId,
): GameState {
  const player = state.players[playerIndex];
  const zones: readonly (keyof Pick<PlayerState, 'hand' | 'discardPile' | 'sideboard'>)[] = ['hand', 'discardPile', 'sideboard'];
  let sourceZone: typeof zones[number] | null = null;
  let card: { instanceId: CardInstanceId; definitionId: import('../types/common.js').CardDefinitionId } | null = null;
  for (const zone of zones) {
    const hit = player[zone].find(c => c.instanceId === itemId);
    if (hit) { sourceZone = zone; card = { instanceId: hit.instanceId, definitionId: hit.definitionId }; break; }
  }
  if (!sourceZone || !card) {
    logDetail(`place-item-on-character: item ${itemId as string} not found in hand/discard/sideboard`);
    return state;
  }
  const recipientDef = resolveDef(state, recipientId);
  logDetail(`place-item-on-character: placing ${defById(state, card.definitionId)?.name ?? card.definitionId as string} from ${sourceZone} onto ${recipientDef?.name ?? recipientId as string} (untapped)`);
  const itemInPlay = { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped };
  const sZone = sourceZone;
  return updatePlayer(state, playerIndex, p => {
    const pile = (p[sZone] as readonly { instanceId: CardInstanceId }[]).filter(c => c.instanceId !== itemId);
    const withZoneRemoved: PlayerState = { ...p, [sZone]: pile };
    return updateCharacter(withZoneRemoved, recipientId, c => ({ ...c, items: [...c.items, itemInPlay] }));
  });
}

/**
 * Apply a single TriggeredAction in a grant-action context. Mutates
 * `newPlayers` in place (via assignment to indices) and returns the
 * updated character + any engine effects produced (e.g. dice rolls) +
 * any state-level transforms to apply after the character is written
 * back (constraint additions, resolution enqueues).
 */
function runGrantApply(
  state: GameState,
  apply: import('../types/effects.js').TriggeredAction,
  char: CharacterInPlay,
  newPlayers: import('../types/state.js').PlayerState[],
  ctx: GrantApplyContext,
  rngRef: { rng: GameState['rng']; cheatRollTotal: GameState['cheatRollTotal'] },
): ApplyOk | { error: string } {
  if (apply.type === 'sequence') {
    if (!apply.apps || apply.apps.length === 0) {
      return { updatedChar: char, effects: [], stateOps: [] };
    }
    let currentChar = char;
    const allEffects: GameEffect[] = [];
    const allOps: Array<(s: GameState) => GameState> = [];
    for (const sub of apply.apps) {
      const r = runGrantApply(state, sub, currentChar, newPlayers, ctx, rngRef);
      if ('error' in r) return r;
      currentChar = r.updatedChar;
      allEffects.push(...r.effects);
      allOps.push(...r.stateOps);
    }
    return { updatedChar: currentChar, effects: allEffects, stateOps: allOps };
  }

  if (apply.type === 'set-character-status' && apply.target === 'bearer') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const statusEnum = cardStatusFromName(apply.status);
    logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} → status ${apply.status}`);
    return { updatedChar: { ...char, status: statusEnum }, effects: [], stateOps: [] };
  }

  if (apply.type === 'set-character-status' && apply.target === 'target-character') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `set-character-status target-character: action has no targetCardId on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    if (!company.characters.includes(targetCardId)) {
      return { error: `set-character-status target-character: target ${targetCardId as string} not in ${ctx.charName}'s company` };
    }
    const targetChar = bearerPlayer.characters[targetCardId];
    if (!targetChar) {
      return { error: `set-character-status target-character: target ${targetCardId as string} not found` };
    }
    const statusEnum = cardStatusFromName(apply.status);
    const targetDef = defById(state, targetChar.definitionId);
    const targetName = targetDef?.name ?? '?';
    logDetail(`Grant-action ${ctx.action.actionId}: ${targetName} → status ${apply.status}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      characters: {
        ...bearerPlayer.characters,
        [targetCardId as string]: { ...targetChar, status: statusEnum },
      },
    };
    const updatedChar = targetCardId === ctx.action.characterId
      ? { ...char, status: statusEnum }
      : char;
    return { updatedChar, effects: [], stateOps: [] };
  }

  // target-instance: apply a status change to any character in any company/player
  // by instance ID (used by untap-companion-at-site — target may be in a different company).
  if (apply.type === 'set-character-status' && apply.target === 'target-instance') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `set-character-status target-instance: action has no targetCardId on ${ctx.sourceName}` };
    }
    const statusEnum = cardStatusFromName(apply.status);
    // Find the target across all players
    for (let pi = 0; pi < newPlayers.length; pi++) {
      const p = newPlayers[pi];
      const targetChar = p.characters[targetCardId];
      if (!targetChar) continue;
      const targetDef = defById(state, targetChar.definitionId);
      const targetName = targetDef?.name ?? '?';
      logDetail(`Grant-action ${ctx.action.actionId}: ${targetName} (player ${p.id as string}) → status ${apply.status}`);
      newPlayers[pi] = {
        ...p,
        characters: {
          ...p.characters,
          [targetCardId as string]: { ...targetChar, status: statusEnum },
        },
      };
      const updatedChar2 = targetCardId === ctx.action.characterId
        ? { ...char, status: statusEnum }
        : char;
      return { updatedChar: updatedChar2, effects: [], stateOps: [] };
    }
    return { error: `set-character-status target-instance: target ${targetCardId as string} not found` };
  }

  // company: set the given status on every character in the bearer's company
  // (Strangling Coils ba-76: "untap all tapped characters in The Balrog's
  // company"). Untapping is idempotent for already-untapped members.
  if (apply.type === 'set-character-status' && apply.target === 'company') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const statusEnum = cardStatusFromName(apply.status);
    logDetail(`Grant-action ${ctx.action.actionId}: setting all ${company.characters.length} character(s) in company ${company.id as string} → status ${apply.status}`);
    const updatedChars = { ...bearerPlayer.characters };
    for (const memberId of company.characters) {
      const member = updatedChars[memberId];
      if (!member) continue;
      updatedChars[memberId] = { ...member, status: statusEnum };
    }
    newPlayers[ctx.playerIndex] = { ...bearerPlayer, characters: updatedChars };
    const updatedChar = updatedChars[ctx.action.characterId] ?? char;
    return { updatedChar, effects: [], stateOps: [] };
  }

  if (apply.type === 'increment-company-extra-region-distance') {
    const amount = apply.amount ?? 1;
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const currentExtra = company.extraRegionDistance ?? 0;
    logDetail(`Grant-action ${ctx.action.actionId}: company ${company.id as string} extraRegionDistance ${currentExtra} → ${currentExtra + amount}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id ? { ...c, extraRegionDistance: currentExtra + amount } : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'set-company-special-movement') {
    if (apply.specialMovement === undefined) {
      return { error: `set-company-special-movement missing specialMovement on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    logDetail(`Grant-action ${ctx.action.actionId}: company ${company.id as string} → specialMovement=${apply.specialMovement}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id ? { ...c, specialMovement: apply.specialMovement } : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'add-constraint') {
    const constraintKind = apply.constraint;
    if (!constraintKind) {
      return { error: `add-constraint missing constraint kind on ${ctx.sourceName}` };
    }
    // Most constraint kinds added via grant-action carry no payload
    // (see {@link constraintKindWithoutPayload}). A small set of
    // payload-carrying kinds — currently only `company-stat-modifier`
    // used by discard-to-boost items (Orc-draughts et al.) — read their
    // fields off the apply clause.
    let kind = buildPayloadConstraintKind(constraintKind, apply)
      ?? constraintKindWithoutPayload(constraintKind);
    // Site-bound constraint kinds resolve their `siteDefinitionId` from the
    // bearer's company's current site (e.g. Blasting Fire wh-51, discarded
    // during the site phase to act on the site the company is facing).
    if (!kind && (constraintKind === 'skip-automatic-attacks' || constraintKind === 'influence-at-site-modifier')) {
      const bearerCompany = findCharacterCompany(newPlayers[ctx.playerIndex].companies, ctx.action.characterId);
      const siteDefId = bearerCompany?.currentSite?.definitionId;
      if (!siteDefId) {
        return { error: `add-constraint: ${constraintKind} requires the bearer's company to be at a site (${ctx.sourceName})` };
      }
      if (constraintKind === 'skip-automatic-attacks') {
        kind = { type: 'site-flag', flag: 'skip-automatic-attacks', siteDefinitionId: siteDefId };
      } else {
        const value = typeof apply.value === 'number' ? apply.value : 0;
        kind = { type: 'influence-at-site-modifier', siteDefinitionId: siteDefId, value };
      }
    }
    if (!kind) {
      return { error: `add-constraint: unsupported constraint kind "${constraintKind}" from grant-action (${ctx.sourceName})` };
    }
    const scope = parseConstraintScope(apply.scope, newPlayers[ctx.playerIndex], ctx.action.characterId, ctx.action.player);
    if (!scope) {
      return { error: `add-constraint: unknown or unresolved scope "${apply.scope ?? ''}" on ${ctx.sourceName}` };
    }
    const target = resolveConstraintTarget(apply.target, newPlayers[ctx.playerIndex], ctx.action.characterId, ctx.action.player, ctx.action);
    if (!target) {
      return { error: `add-constraint: cannot resolve target "${apply.target ?? ''}" on ${ctx.sourceName}` };
    }
    const sourceId = ctx.action.sourceCardId;
    const sourceDefId = ctx.sourceCardDefinitionId;
    // METD §5: hazard-limit-modifier additions during the site phase
    // have no effect — the limit is locked at site reveal.
    if (kind.type === 'hazard-limit-modifier' && state.phaseState.phase === Phase.Site) {
      logDetail(`Grant-action ${ctx.action.actionId}: hazard-limit-modifier ignored — site-phase additions have no effect (METD §5)`);
      return { updatedChar: char, effects: [], stateOps: [] };
    }
    logDetail(`Grant-action ${ctx.action.actionId}: adding constraint ${constraintKind} (scope ${apply.scope ?? '?'})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => addConstraint(s, { source: sourceId, sourceDefinitionId: sourceDefId, scope, target, kind }),
      ],
    };
  }

  if (apply.type === 'enqueue-corruption-check') {
    const modifier = apply.modifier ?? 0;
    const characterId = ctx.action.characterId;
    const actor = ctx.action.player;
    const sourceId = ctx.action.sourceCardId;
    const reason = ctx.sourceName;
    // The corruption check resolves in the phase in which the
    // grant-action was activated. For Organization-only abilities
    // (e.g. Promptings of Wisdom) this is `Phase.Organization`; for
    // any-phase and cross-phase abilities (e.g. Magical Harp, which
    // may fire during the owner's Site phase, the opponent's Site
    // phase, or the Free Council) the current phase is correct.
    const currentPhase = state.phaseState.phase;
    logDetail(`Grant-action ${ctx.action.actionId}: enqueueing corruption check on ${ctx.charName} (reason: ${reason}, modifier ${modifier}, phase: ${currentPhase})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => enqueueCorruptionCheck(s, {
          source: sourceId,
          actor,
          scope: { kind: 'phase', phase: currentPhase },
          characterId,
          modifier,
          reason,
        }),
      ],
    };
  }

  if (apply.type === 'roll-check') {
    const checkName = apply.check;
    if (!checkName) {
      return { error: `roll-check missing check on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const { roll, rng, cheatRollTotal } = roll2d6({ ...state, rng: rngRef.rng, cheatRollTotal: rngRef.cheatRollTotal });
    rngRef.rng = rng;
    rngRef.cheatRollTotal = cheatRollTotal;
    const base = roll.die1 + roll.die2;

    let modifier = 0;
    const checkContext = { reason: checkName };
    for (const compCharId of company.characters) {
      const compChar = bearerPlayer.characters[compCharId];
      if (!compChar) continue;
      const charEffects = collectCharacterEffects(state, compChar, checkContext);
      modifier += resolveCheckModifier(charEffects, checkName);
    }
    const total = base + modifier;

    let targetName = '';
    if (ctx.action.targetCardId) {
      for (const compCharId of company.characters) {
        const compChar = bearerPlayer.characters[compCharId];
        if (!compChar) continue;
        const targetItem = compChar.items.find(i => i.instanceId === ctx.action.targetCardId);
        if (targetItem) {
          const targetDef = defById(state, targetItem.definitionId);
          targetName = targetDef?.name ?? '';
          break;
        }
      }
    }

    const baseLabel = apply.label ?? checkName;
    const labelSuffix = targetName
      ? `${ctx.charName} tests ${targetName}`
      : ctx.charName;
    const label = `${baseLabel}: ${labelSuffix}`;
    if (modifier !== 0) {
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${base}, modifier ${formatSignedNumber(modifier)} → ${total} (${checkName})`);
    } else {
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${total} (${checkName})`);
    }

    const rollEffect = diceRollEffect(bearerPlayer.name, roll, label);
    newPlayers[ctx.playerIndex] = { ...newPlayers[ctx.playerIndex], lastDiceRoll: roll };
    return { updatedChar: char, effects: [rollEffect], stateOps: [] };
  }

  if (apply.type === 'cancel-chain-entry') {
    if (apply.select !== 'most-recent-unresolved-hazard') {
      return { error: `cancel-chain-entry: unsupported select "${apply.select ?? ''}" on ${ctx.sourceName}` };
    }
    const chain = state.chain;
    if (!chain) return { error: `cancel-chain-entry: no active chain on ${ctx.sourceName}` };
    let entryIndex = -1;
    for (let i = chain.entries.length - 1; i >= 0; i--) {
      const e = chain.entries[i];
      if (e.resolved || e.negated || !e.card) continue;
      const def = defById(state, e.card.definitionId);
      if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) {
        entryIndex = i;
        break;
      }
    }
    if (entryIndex === -1) {
      return { error: `cancel-chain-entry: no unresolved hazard entry to cancel on ${ctx.sourceName}` };
    }
    const entry = chain.entries[entryIndex];
    const entryDef = entry.card ? defById(state, entry.card.definitionId) : null;
    logDetail(`Grant-action ${ctx.action.actionId}: canceling chain entry ${entryIndex} (${entryDef?.name ?? '?'})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const liveChain = s.chain;
          if (!liveChain) return s;
          const newEntries = liveChain.entries.map((e, i) => i === entryIndex ? { ...e, negated: true } : e);
          let nextState: GameState = { ...s, chain: { ...liveChain, entries: newEntries } };
          if (entry.card) {
            const hazardPlayerIndex = nextState.players.findIndex(p => p.id === entry.declaredBy);
            if (hazardPlayerIndex >= 0) {
              const hazardPlayer = nextState.players[hazardPlayerIndex];
              const newPlayersLocal = clonePlayers(nextState);
              newPlayersLocal[hazardPlayerIndex] = {
                ...hazardPlayer,
                discardPile: [...hazardPlayer.discardPile, toCardInstance(entry.card)],
              };
              nextState = { ...nextState, players: newPlayersLocal };
            }
          }
          return nextState;
        },
      ],
    };
  }

  if (apply.type === 'remove-constraint') {
    if (apply.select !== 'constraint-source' && apply.select !== undefined) {
      return { error: `remove-constraint: unsupported select "${apply.select}" on ${ctx.sourceName}` };
    }
    const sourceId = ctx.action.sourceCardId;
    logDetail(`Grant-action ${ctx.action.actionId}: removing constraints sourced from ${ctx.sourceName}`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const matchingIds = s.activeConstraints.filter(c => c.source === sourceId).map(c => c.id);
          let next = s;
          for (const id of matchingIds) next = removeConstraint(next, id);
          return next;
        },
      ],
    };
  }

  if (apply.type === 'move') {
    // Generic card-movement primitive. The legacy per-move effect types
    // (discard-self, fetch-to-deck, bounce-hazard-events, …) have been
    // migrated onto this single branch. See
    // `specs/2026-04-23-card-move-primitive-plan.md`.
    if (!apply.select || !apply.from || !apply.to) {
      return { error: `move apply missing select/from/to on ${ctx.sourceName}` };
    }
    const moveEffect: import('../types/effects.js').MoveEffect = {
      type: 'move',
      select: apply.select,
      from: apply.from,
      to: apply.to,
      ...(apply.toOwner !== undefined ? { toOwner: apply.toOwner } : {}),
      ...(apply.filter !== undefined ? { filter: apply.filter } : {}),
      ...(apply.count !== undefined ? { count: apply.count } : {}),
      ...(apply.shuffleAfter !== undefined ? { shuffleAfter: apply.shuffleAfter } : {}),
      ...(apply.corruptionCheck !== undefined ? { corruptionCheck: apply.corruptionCheck } : {}),
      ...(apply.cardName !== undefined ? { cardName: apply.cardName } : {}),
    };
    const moveCtx: import('./reducer-move.js').MoveContext = {
      sourceCardId: ctx.action.sourceCardId,
      sourcePlayerIndex: ctx.playerIndex,
      ...(ctx.action.targetCardId ? { targetCardId: ctx.action.targetCardId } : {}),
      ...(ctx.action.characterId ? { targetCharacterId: ctx.action.characterId } : {}),
    };
    const fromLabel = Array.isArray(moveEffect.from)
      ? `[${moveEffect.from.join(',')}]`
      : String(moveEffect.from);
    logDetail(`Grant-action ${ctx.action.actionId}: move (select=${moveEffect.select}, from=${fromLabel}, to=${String(moveEffect.to)})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const r = applyMoveLocal(s, moveEffect, moveCtx);
          if ('error' in r) {
            logDetail(`move apply failed: ${r.error}`);
            return s;
          }
          return r.state;
        },
      ],
    };
  }

  if (apply.type === 'enqueue-pending-fetch') {
    const fromSources = apply.fetchFrom ?? ['discard-pile'];
    const count = apply.fetchCount ?? 1;
    const shuffle = apply.fetchShuffle ?? true;
    const fetchTo = apply.fetchTo ?? 'deck';
    const filter = apply.filter ?? {};
    const characterId = ctx.action.characterId;
    const sourceId = ctx.action.sourceCardId;
    const ccModifier = apply.postCorruptionCheckModifier ?? 0;
    // Site-playability restriction (Strider ba-1): capture the bearer's
    // company's current site now, so the pending fetch can gate candidates
    // on being playable there.
    let playableAtSite: import('../types/common.js').CardDefinitionId | undefined;
    if (apply.playableAtBearerSite === true) {
      const company = findCharacterCompany(newPlayers[ctx.playerIndex].companies, characterId);
      const siteInstId = company?.currentSite?.instanceId;
      playableAtSite = siteInstId !== undefined ? resolveInstanceId(state, siteInstId) : undefined;
      if (playableAtSite === undefined) {
        return { error: `enqueue-pending-fetch: ${ctx.charName} has no current site for the playable-at-site restriction` };
      }
    }
    logDetail(`Grant-action ${ctx.action.actionId}: enqueueing fetch-to-${fetchTo} from [${fromSources.join(', ')}] (count=${count}, shuffle=${shuffle}, postCorruptionCheck=${!!apply.postCorruptionCheck}, ccModifier=${ccModifier}${playableAtSite !== undefined ? `, playable at ${playableAtSite as string}` : ''})`);
    const sitePart = playableAtSite !== undefined ? { playableAtSite } : {};
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => ({
          ...s,
          pendingEffects: [
            ...s.pendingEffects,
            {
              type: 'card-effect' as const,
              cardInstanceId: sourceId,
              effect: {
                type: 'fetch-to-deck' as const,
                source: fromSources,
                filter,
                count,
                shuffle,
                to: fetchTo,
                ...sitePart,
              },
              skipDiscard: true,
              ...(apply.postCorruptionCheck
                ? { postCorruptionCheck: { characterId, modifier: ccModifier } }
                : {}),
            },
          ],
        }),
      ],
    };
  }

  if (apply.type === 'place-item-on-character') {
    // The Forge-master wh-117: the chosen item (ctx.action.targetCardId) is
    // moved from the player's discard pile / sideboard / hand onto the chosen
    // recipient (ctx.action.recipientCharacterId) at the bearer's site,
    // untapped. The bearer-tap cost was already paid; the recipient is not
    // tapped. Deferred to a stateOp so it runs on the post-cost state.
    const itemId = ctx.action.targetCardId;
    const recipientId = ctx.action.recipientCharacterId;
    if (!itemId || !recipientId) {
      return { error: `place-item-on-character: missing item or recipient on ${ctx.sourceName}` };
    }
    return {
      updatedChar: char,
      effects: [],
      stateOps: [s => placeFetchedItemOnCharacter(s, ctx.playerIndex, itemId, recipientId)],
    };
  }

  if (apply.type === 'roll-then-apply') {
    const { roll, rng, cheatRollTotal } = roll2d6({ ...state, rng: rngRef.rng, cheatRollTotal: rngRef.cheatRollTotal });
    rngRef.rng = rng;
    rngRef.cheatRollTotal = cheatRollTotal;
    // METD §7 / rule 10.08: the no-tap variant of corruption removal
    // applies a -3 modifier to the roll. Standard variant is unmodified.
    const noTap = (ctx.action as { noTap?: true }).noTap === true;
    const modifier = noTap ? -3 : 0;
    const total = roll.die1 + roll.die2 + modifier;
    const modText = modifier !== 0 ? ` ${formatSignedNumber(modifier)}` : '';
    logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2}${modText} = ${total} vs threshold ${apply.threshold}${noTap ? ' (no-tap variant)' : ''}`);

    const playerName = newPlayers[ctx.playerIndex].name;
    const rollEffect = diceRollEffect(playerName, roll, `${ctx.sourceName}: ${ctx.charName}${noTap ? ' (no-tap)' : ''}`);
    newPlayers[ctx.playerIndex] = { ...newPlayers[ctx.playerIndex], lastDiceRoll: roll };

    const branch = total >= apply.threshold ? apply.onSuccess : apply.onFailure;
    const stateOpsExtra: ((s: GameState) => GameState)[] = [];
    if (noTap) {
      // Lock further attempts on this character+corruption-card pair
      // for the rest of the turn, regardless of roll outcome.
      const charId = ctx.action.characterId;
      const corruptionId = ctx.action.sourceCardId;
      const sourceDefId = ctx.sourceCardDefinitionId;
      stateOpsExtra.push((s: GameState) => addConstraint(s, {
        source: corruptionId,
        sourceDefinitionId: sourceDefId,
        scope: { kind: 'turn' },
        target: { kind: 'character', characterId: charId },
        kind: { type: 'corruption-removal-locked', characterId: charId, corruptionInstanceId: corruptionId },
      }));
    }
    if (!branch) {
      logDetail(`Grant-action ${ctx.action.actionId}: roll ${total >= apply.threshold ? 'succeeded' : 'failed'} — no branch, nothing to apply`);
      return { updatedChar: char, effects: [rollEffect], stateOps: stateOpsExtra };
    }
    const inner = runGrantApply(state, branch, char, newPlayers, ctx, rngRef);
    if ('error' in inner) return inner;
    return { updatedChar: inner.updatedChar, effects: [rollEffect, ...inner.effects], stateOps: [...stateOpsExtra, ...inner.stateOps] };
  }

  if (apply.type === 'untap-site') {
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const siteInstance = company.currentSite;
    if (!siteInstance) {
      return { error: `${ctx.charName}'s company has no current site` };
    }
    const siteDef = defById(state, siteInstance.definitionId);
    const siteName = siteDef?.name ?? '?';
    logDetail(`Grant-action ${ctx.action.actionId}: untapping site ${siteName}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id
          ? { ...c, currentSite: { ...siteInstance, status: CardStatus.Untapped } }
          : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'transform-site') {
    // Vile Fumes (wh-54): discard the item to permanently transform the
    // bearer's current site. Two `until-cleared` constraints, both filtered
    // by the site's definition ID so they affect "all versions of the site":
    //   1. attribute-modifier on `site.type` → Ruins & Lairs.
    //   2. replace-automatic-attacks → the bespoke Gas attack.
    // The item itself has already been discarded by the `cost.discard` step.
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const siteInstance = company.currentSite;
    if (!siteInstance) {
      return { error: `${ctx.charName}'s company has no current site` };
    }
    const overrideType = apply.overrideType;
    const attack = apply.attack;
    if (!overrideType || !attack) {
      return { error: `transform-site requires 'overrideType' and 'attack' on ${ctx.sourceName}` };
    }
    const siteDefId = siteInstance.definitionId;
    const companyId = company.id;
    const sourceId = ctx.action.sourceCardId;
    const sourceDefId = ctx.sourceCardDefinitionId;
    const siteName = defById(state, siteDefId)?.name ?? '?';
    logDetail(`Grant-action ${ctx.action.actionId}: transforming all versions of ${siteName} → ${overrideType}; automatic-attacks replaced with ${attack.creatureType} (${attack.strikes} strike, ${attack.prowess} prowess${attack.uncancelable ? ', uncancelable' : ''})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => addConstraint(s, {
          source: sourceId,
          sourceDefinitionId: sourceDefId,
          scope: { kind: 'until-cleared' },
          target: { kind: 'company', companyId },
          kind: {
            type: 'attribute-modifier',
            attribute: 'site.type',
            op: 'override',
            value: overrideType,
            filter: { 'site.definitionId': siteDefId },
          },
        }),
        s => addConstraint(s, {
          source: sourceId,
          sourceDefinitionId: sourceDefId,
          scope: { kind: 'until-cleared' },
          target: { kind: 'company', companyId },
          kind: {
            type: 'replace-automatic-attacks',
            siteDefinitionId: siteDefId,
            attack: {
              creatureType: attack.creatureType,
              strikes: attack.strikes,
              prowess: attack.prowess,
              ...(attack.body !== undefined ? { body: attack.body } : {}),
              ...(attack.uncancelable ? { uncancelable: true } : {}),
              ...(attack.eachCharacter ? { eachCharacter: true } : {}),
            },
          },
        }),
      ],
    };
  }

  if (apply.type === 'shuffle-deck-top') {
    // Shuffle the top N cards of the target player's play deck, keeping
    // them at the top in a new random order. Used by Palantír of Minas
    // Tirith to randomise the top 5 of both players' decks.
    const n = apply.count ?? 5;
    const isOpponent = apply.toOwner === 'opponent';
    const targetIndex = isOpponent ? 1 - ctx.playerIndex : ctx.playerIndex;
    const targetPlayer = newPlayers[targetIndex];
    if (!targetPlayer) {
      return { error: `shuffle-deck-top: player at index ${targetIndex} not found` };
    }
    const sliceSize = Math.min(n, targetPlayer.playDeck.length);
    if (sliceSize > 0) {
      const topN = targetPlayer.playDeck.slice(0, sliceSize);
      const [shuffled, newRng] = shuffle(topN, rngRef.rng);
      rngRef.rng = newRng;
      const newDeck = [...shuffled, ...targetPlayer.playDeck.slice(sliceSize)];
      const label = isOpponent ? "opponent's" : 'own';
      logDetail(`Grant-action ${ctx.action.actionId}: shuffling top ${sliceSize} of ${label} play deck`);
      newPlayers[targetIndex] = { ...newPlayers[targetIndex], playDeck: newDeck };
    }
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  // `discard-target-character` — discard the character identified by
  // action.targetCardId, along with all their items and allies, to the
  // owning player's discard pile. Followers revert to general influence.
  // Used by The Arkenstone (le-418): discard a Dwarf at the same site.
  if (apply.type === 'discard-target-character') {
    const targetCharId = ctx.action.targetCardId;
    if (!targetCharId) {
      return { error: `${ctx.sourceName}: discard-target-character requires targetCardId` };
    }
    let targetPlayerIndex = -1;
    for (let i = 0; i < newPlayers.length; i++) {
      if (newPlayers[i].characters[targetCharId]) {
        targetPlayerIndex = i;
        break;
      }
    }
    if (targetPlayerIndex === -1) {
      return { error: `${ctx.sourceName}: target character ${targetCharId as string} not found` };
    }
    const targetPlayerData = newPlayers[targetPlayerIndex];
    const targetChar = targetPlayerData.characters[targetCharId];
    if (!targetChar) {
      return { error: `${ctx.sourceName}: target character ${targetCharId as string} missing` };
    }
    const targetDefId = resolveInstanceId(state, targetCharId);
    const targetName = (targetDefId ? defById(state, targetDefId)?.name : undefined) ?? String(targetCharId);
    logDetail(`Grant-action ${ctx.action.actionId}: discarding ${targetName} to player ${targetPlayerIndex}'s discard pile`);

    // Remove character from all companies
    const newCompanies = targetPlayerData.companies.map(c => ({
      ...c,
      characters: c.characters.filter(ch => ch !== targetCharId),
    }));

    // Build new discard pile: character + items + allies; hazards go to their owner
    let newDiscard = [...targetPlayerData.discardPile];
    const hazardPlayerIdx = 1 - targetPlayerIndex;
    const newHazardDiscard = [...newPlayers[hazardPlayerIdx].discardPile];
    if (targetDefId) {
      newDiscard = [...newDiscard, { instanceId: targetCharId, definitionId: targetDefId }];
    }
    for (const item of targetChar.items) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding item ${item.instanceId as string} from ${targetName}`);
      newDiscard = [...newDiscard, toCardInstance(item)];
    }
    for (const ally of targetChar.allies) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding ally ${ally.instanceId as string} from ${targetName}`);
      newDiscard = [...newDiscard, toCardInstance(ally)];
    }
    for (const hazard of targetChar.hazards) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding hazard ${hazard.instanceId as string} from ${targetName}`);
      const hazOwner = ownerOf(hazard.instanceId);
      let hazOwnerIdx = newPlayers.findIndex(p => p.id === hazOwner);
      if (hazOwnerIdx === -1) hazOwnerIdx = targetPlayerIndex === 0 ? 1 : 0;
      if (hazOwnerIdx === targetPlayerIndex) {
        newDiscard = [...newDiscard, toCardInstance(hazard)];
      } else {
        newPlayers[hazOwnerIdx] = { ...newPlayers[hazOwnerIdx], discardPile: [...newPlayers[hazOwnerIdx].discardPile, toCardInstance(hazard)] };
      }
    }

    // Remove character from characters map and revert followers to GI
    const { [targetCharId]: _removed, ...remainingChars } = targetPlayerData.characters;
    let updatedChars = remainingChars;
    for (const followerId of targetChar.followers) {
      const follower = updatedChars[followerId];
      if (follower && follower.controlledBy === targetCharId) {
        logDetail(`Grant-action ${ctx.action.actionId}: reverting follower ${followerId as string} to general influence`);
        updatedChars = {
          ...updatedChars,
          [followerId as string]: { ...follower, controlledBy: 'general' as const },
        };
      }
    }

    newPlayers[targetPlayerIndex] = {
      ...targetPlayerData,
      companies: newCompanies,
      characters: updatedChars,
      discardPile: newDiscard,
    };
    newPlayers[hazardPlayerIdx] = { ...newPlayers[hazardPlayerIdx], discardPile: newHazardDiscard };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  return { error: `Unsupported grant-action apply ${JSON.stringify(apply)} on ${ctx.sourceName}` };
}

/**
 * Build an ActiveConstraint.kind for constraint names that carry no
 * payload. Returns null for kinds that need additional fields (those go
 * through the on-event path which knows how to read them from state).
 */
function constraintKindWithoutPayload(
  name: string,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  switch (name) {
    case 'cancel-return-and-site-tap':
      return { type: 'cancel-return-and-site-tap' };
    case 'cancel-character-discard':
      return { type: 'cancel-character-discard' };
    case 'deny-scout-resources':
      return { type: 'deny-scout-resources' };
    case 'no-creature-hazards-on-company':
      return { type: 'no-creature-hazards-on-company' };
    case 'auto-attack-duplicate':
      return { type: 'auto-attack-duplicate' };
    default:
      return null;
  }
}

/**
 * Build an ActiveConstraint.kind for constraint names whose payload is
 * read directly off the grant-action `apply` clause. Returns null for
 * kinds not handled here (fall back to {@link constraintKindWithoutPayload}).
 */
function buildPayloadConstraintKind(
  name: string,
  apply: import('../types/effects.js').TriggeredAction,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  // These payload kinds are only built for add-constraint applies; narrowing
  // here makes the Legacy payload fields (stat/value/siteType/subtype/check)
  // available without a cast.
  if (apply.type !== 'add-constraint') return null;
  if (name === 'company-stat-modifier') {
    if (apply.stat !== 'prowess' && apply.stat !== 'body') return null;
    if (typeof apply.value !== 'number') return null;
    return { type: 'company-stat-modifier', stat: apply.stat, value: apply.value };
  }
  if (name === 'hand-size-modifier') {
    if (typeof apply.value !== 'number') return null;
    return { type: 'hand-size-modifier', value: apply.value };
  }
  if (name === 'site-resource-unlocked') {
    if (typeof apply.subtype !== 'string') return null;
    // Either a fixed site type (Records Unread as-130: Information at any
    // Shadow-hold) or a compound site condition (A Panoply of Wings wh-37:
    // Information at any non-Haven/non-Shadow-hold/non-Dark-hold Wilderness site).
    if (typeof apply.siteType === 'string') {
      return { type: 'site-resource-unlocked', siteType: apply.siteType, subtype: apply.subtype };
    }
    if (apply.siteCondition) {
      return { type: 'site-resource-unlocked', siteCondition: apply.siteCondition, subtype: apply.subtype };
    }
    return null;
  }
  if (name === 'check-modifier') {
    // A one-shot roll modifier the engine collects when the targeted
    // character makes a matching check. Consumed the first time the targeted
    // character makes a check of the matching kind — e.g. When You Know More
    // (dm-163) taps a sage to add +2 to one influence attempt by a company-
    // mate, and When I Know Anything (td-166) adds +3 to one corruption check
    // by a character in the sage's company.
    if (typeof apply.check !== 'string') return null;
    if (typeof apply.value !== 'number') return null;
    return {
      type: 'check-modifier',
      check: apply.check,
      value: apply.value,
      ...(apply.autoPass ? { autoPass: true } : {}),
    };
  }
  return null;
}

/** Map a DSL scope string to a ConstraintScope. */
function parseConstraintScope(
  scopeName: string | undefined,
  player: import('../types/state.js').PlayerState,
  characterId: CardInstanceId,
  playerId: import('../types/common.js').PlayerId,
): import('../types/pending.js').ConstraintScope | null {
  switch (scopeName) {
    case 'turn':
      return { kind: 'turn' };
    case 'until-cleared':
      return { kind: 'until-cleared' };
    case 'next-organization-phase':
      // "through your next organization phase" (Shifter of Hues wh-115). Created
      // unarmed during the acting player's org phase; armed at that org phase's
      // end and cleared at the following one (see
      // `advanceNextOrganizationPhaseConstraints`).
      return { kind: 'next-organization-phase', player: playerId, armed: false };
    case 'company-site-phase':
    case 'company-mh-phase': {
      const company = findCharacterCompany(player.companies, characterId);
      if (!company) return null;
      return { kind: scopeName, companyId: company.id };
    }
    default:
      return null;
  }
}

/** Resolve a DSL target selector to a ConstraintTarget. */
function resolveConstraintTarget(
  targetName: string | undefined,
  player: import('../types/state.js').PlayerState,
  characterId: CardInstanceId,
  playerId: import('../types/common.js').PlayerId,
  action?: import('../types/actions-organization.js').ActivateGrantedAction,
): import('../types/pending.js').ActiveConstraint['target'] | null {
  switch (targetName ?? 'bearer-company') {
    case 'bearer-company': {
      const company = findCharacterCompany(player.companies, characterId);
      if (!company) return null;
      return { kind: 'company', companyId: company.id };
    }
    case 'player':
      return { kind: 'player', playerId };
    case 'action-target-company': {
      const companyId = action?.targetCompanyId;
      if (!companyId) return null;
      return { kind: 'company', companyId };
    }
    case 'action-target-character': {
      // The character carried on the action's `targetCardId` — used when a
      // grant-action modifies a specific other character's pending check
      // (When You Know More dm-163 boosts a company-mate's influence attempt;
      // When I Know Anything td-166 targets the character whose corruption
      // check is being resolved).
      const targetCharId = action?.targetCardId;
      if (!targetCharId) return null;
      return { kind: 'character', characterId: targetCharId };
    }
    default:
      return null;
  }
}

/**
 * Resolve an activated ability on a *bearer-less* in-play card — a card in the
 * player's `cardsInPlay` that is not attached to any character (currently an
 * in-play faction). Only the `discard: self` cost and the `add-constraint`
 * apply are supported: the source is discarded from `cardsInPlay` to the
 * controller's discard pile, then the declared constraint is added.
 *
 * Used by A Panoply of Wings (wh-37): "Discard this faction to make
 * information playable at such a site" — a `site-resource-unlocked` constraint
 * (Information, keyed to a compound `siteCondition`), scope `turn`, targeting
 * the discarding player.
 */
function handleInPlayCardGrantAction(
  state: GameState,
  action: Extract<GameAction, { type: 'activate-granted-action' }>,
  playerIndex: number,
): ReducerResult {
  const player = state.players[playerIndex];
  const source = player.cardsInPlay.find(c => c.instanceId === action.sourceCardId);
  if (!source) return { state, error: `in-play grant-action: source ${action.sourceCardId as string} not in play` };
  const sourceDef = defById(state, source.definitionId);
  const sourceName = sourceDef?.name ?? '?';

  const effect = getCardEffects(sourceDef).find(
    (e): e is import('../types/effects.js').GrantActionEffect =>
      e.type === 'grant-action' && e.action === action.actionId,
  );
  if (!effect?.apply) return { state, error: `in-play grant-action ${action.actionId} has no apply on ${sourceName}` };
  if (effect.cost.discard !== 'self') {
    return { state, error: `in-play grant-action ${action.actionId}: only discard-self cost supported (${sourceName})` };
  }
  const apply = effect.apply;
  if (apply.type !== 'add-constraint') {
    return { state, error: `in-play grant-action ${action.actionId}: only add-constraint apply supported (${sourceName})` };
  }

  // Discard the source card from cardsInPlay to the controller's discard pile.
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: newPlayers[playerIndex].cardsInPlay.filter(c => c.instanceId !== source.instanceId),
    discardPile: [...newPlayers[playerIndex].discardPile, { instanceId: source.instanceId, definitionId: source.definitionId }],
  };

  const constraintKind = apply.constraint ?? '';
  const kind = buildPayloadConstraintKind(constraintKind, apply) ?? constraintKindWithoutPayload(constraintKind);
  if (!kind) return { state, error: `in-play grant-action: unsupported constraint kind "${constraintKind}" on ${sourceName}` };
  const scope = parseConstraintScope(apply.scope, newPlayers[playerIndex], action.characterId, action.player);
  if (!scope) return { state, error: `in-play grant-action: unknown scope "${apply.scope ?? ''}" on ${sourceName}` };
  const target = resolveConstraintTarget(apply.target, newPlayers[playerIndex], action.characterId, action.player, action);
  if (!target) return { state, error: `in-play grant-action: cannot resolve target "${apply.target ?? ''}" on ${sourceName}` };

  logDetail(`In-play grant-action ${action.actionId}: discarding ${sourceName}, adding constraint ${constraintKind} (scope ${apply.scope ?? '?'})`);
  let finalState = recomputeDerived({ ...state, players: newPlayers });
  finalState = addConstraint(finalState, {
    source: source.instanceId,
    sourceDefinitionId: source.definitionId,
    scope,
    target,
    kind,
  });
  return { state: finalState, effects: [] };
}

/**
 * Generic handler for grant-action effects that declare an `apply`.
 * Pays the effect's cost (discard source attachment or tap the bearer)
 * then dispatches on `apply.type` to mutate state. Shared across all
 * phase reducers so a granted action behaves identically in
 * organization, M/H, site, and long-event windows without per-actionId
 * branches.
 *
 * Supported costs:
 *  - `cost.discard === 'self'` — detach the source card (item, ally,
 *    or hazard) from the bearer and move it to the correct discard.
 *  - `cost.tap === 'bearer'` — tap the bearer (no detach).
 *
 * Supported applies (each extends the primitive as cards demand it):
 *  - `set-character-status` with `target: 'bearer'` — set bearer status.
 *  - `move` (`select: 'self', to: 'discard'`) — detach the source from the
 *    bearer and discard it.
 *  - `roll-then-apply` with `threshold`, `onSuccess`, `onFailure` —
 *    roll 2d6; run the matching branch (recursive apply).
 */
export function handleGrantActionApply(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId];
  if (!char) {
    // Bearer-less source: a card sitting in the player's `cardsInPlay` (not
    // attached to any character) that carries an activated discard ability —
    // e.g. an in-play faction discarded to add a constraint (A Panoply of
    // Wings wh-37: "Discard this faction to make information playable at such
    // a site"). The legal-action emitter sets `characterId = sourceCardId` as
    // a self-reference since there is no activating character.
    if (player.cardsInPlay.some(c => c.instanceId === action.sourceCardId)) {
      return handleInPlayCardGrantAction(state, action, playerIndex);
    }
    return { state, error: 'Character not found' };
  }

  const charDef = resolveDef(state, action.characterId);
  const charName = charDef?.name ?? '?';
  const sourceDef = defById(state, action.sourceCardDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  // Grant-actions can originate from either:
  //  - a `grant-action` effect declared on the source card (static),
  //  - a `granted-action` active constraint whose source is the source
  //    card (dynamic, added via on-event / sequence apply).
  // Check the static path first; if that doesn't yield a matching
  // action, fall through to an active constraint lookup.
  const staticEffect = getCardEffects(sourceDef).find(
    (e): e is import('../types/effects.js').GrantActionEffect =>
      e.type === 'grant-action' && e.action === action.actionId,
  );
  const constraintGrant = staticEffect ? null : state.activeConstraints.find(c =>
    c.source === action.sourceCardId
    && c.kind.type === 'granted-action'
    && c.kind.action === action.actionId,
  );
  const constraintKind = constraintGrant?.kind.type === 'granted-action' ? constraintGrant.kind : null;

  interface ResolvedGrant {
    readonly cost: import('../types/effects.js').ActionCost;
    readonly apply: import('../types/effects.js').TriggeredAction;
  }
  const resolved: ResolvedGrant | null = staticEffect?.apply
    ? { cost: staticEffect.cost, apply: staticEffect.apply }
    : constraintKind
      ? { cost: constraintKind.cost, apply: constraintKind.apply }
      : null;

  if (!resolved) {
    return { state, error: `grant-action ${action.actionId} has no apply on ${sourceName}` };
  }

  // --- Pay cost ---
  // METD §7 / rule 10.08: the no-tap variant of corruption removal
  // skips paying the bearer-tap cost (and instead suffers -3 to the
  // roll plus a per-turn lock — both handled in the apply branch).
  const noTap = (action as { noTap?: true }).noTap === true;

  const costResult = applyCost(state, resolved.cost, action.characterId, {
    playerIndex,
    sourceCardId: action.sourceCardId,
    sourceCardDefId: action.sourceCardDefinitionId,
    noTap,
    label: `${action.actionId}/${sourceName}`,
  });
  if ('error' in costResult) return { state, error: `${sourceName}: ${costResult.error}` };

  const newPlayers = clonePlayers(costResult.state);
  let updatedChar: CharacterInPlay = newPlayers[playerIndex].characters[action.characterId] ?? char;

  // For sage-and-scout-in-company cost: `applyCost` taps the sage (characterId).
  // Also tap the scout (secondCharacterId) here.
  if (resolved.cost.tap === 'sage-and-scout-in-company' && action.secondCharacterId) {
    const scout = newPlayers[playerIndex].characters[action.secondCharacterId];
    if (!scout) return { state, error: `sage-and-scout-in-company: scout ${action.secondCharacterId as string} not found` };
    logDetail(`Grant-action ${action.actionId}: tapping scout ${action.secondCharacterId as string}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: {
        ...newPlayers[playerIndex].characters,
        [action.secondCharacterId as string]: { ...scout, status: CardStatus.Tapped },
      },
    };
  }

  // --- Apply effect ---
  const ctx: GrantApplyContext = {
    action,
    playerIndex,
    charName,
    sourceName,
    sourceCardDefinitionId: action.sourceCardDefinitionId,
  };
  const rngRef = { rng: state.rng, cheatRollTotal: state.cheatRollTotal };
  const result = runGrantApply(state, resolved.apply, updatedChar, newPlayers, ctx, rngRef);
  if ('error' in result) {
    return { state, error: result.error };
  }
  updatedChar = result.updatedChar;

  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: {
      ...newPlayers[playerIndex].characters,
      [action.characterId as string]: updatedChar,
    },
  };

  let finalState: GameState = recomputeDerived({
    ...state,
    players: newPlayers,
    rng: rngRef.rng,
    cheatRollTotal: rngRef.cheatRollTotal,
  });
  for (const op of result.stateOps) {
    finalState = op(finalState);
  }

  // Once-per-turn abilities record a turn-scoped lock so the scanner
  // suppresses further activations of this source+action for the rest of
  // the turn (Strangling Coils ba-76's company untap).
  if (staticEffect?.oncePerTurn) {
    finalState = addConstraint(finalState, {
      source: action.sourceCardId,
      sourceDefinitionId: action.sourceCardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: action.player },
      kind: {
        type: 'granted-action-used',
        sourceInstanceId: action.sourceCardId,
        actionId: action.actionId,
      },
    });
  }

  return {
    state: finalState,
    effects: result.effects.length > 0 ? result.effects : undefined,
  };
}
