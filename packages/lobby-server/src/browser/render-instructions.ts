/**
 * @module render-instructions
 *
 * Renders contextual instruction text and the pass/action button
 * in the visual game view. Instructions guide the player through
 * each phase and step of the game.
 */

import type { PlayerView, CardDefinition, GameAction } from '@meccg/shared';
import { getAlignmentRules, isCharacterCard, Phase } from '@meccg/shared';
import { REGION_ICON_CODES } from './render-text-format.js';
import { getTargetingInstruction } from './render-selection-state.js';

/**
 * Build an HTML snippet describing the movement path for the active company.
 * Returns something like "Starter: Arthedain [W] Rhudaur [S]" or null if not moving.
 */
function buildMovementPathHtml(
  mh: { movementType?: string | null; resolvedSitePathNames?: readonly string[]; resolvedSitePath?: readonly string[] },
): string | null {
  if (!mh.movementType) return 'Not moving.';
  const names = mh.resolvedSitePathNames ?? [];
  const types = mh.resolvedSitePath ?? [];
  if (names.length === 0) return null;
  const isRegion = mh.movementType !== 'starter';
  const label = isRegion ? 'Region Movement:' : 'Starter:';
  const parts: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const code = REGION_ICON_CODES[types[i] ?? ''];
    const icon = code
      ? `<img src="/images/regions/${code}.png" alt="${types[i]}" width="32" height="32" style="vertical-align:middle;position:relative;top:-5px">`
      : '';
    parts.push(`${names[i]} ${icon}`);
  }
  return `${label} ${parts.join(' ')}`;
}

/**
 * Build an HTML detail line for an influence-attempt chain entry,
 * showing the faction name and influencing character name.
 */
function buildInfluenceChainDetail(
  entry: { card: { definitionId: unknown } | null; payload: { type: string; influencingCharacterId?: unknown } },
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const factionDef = entry.card ? cardPool[entry.card.definitionId as string] : undefined;
  const factionName = factionDef?.name ?? 'faction';

  const charId = entry.payload.influencingCharacterId as string | undefined;
  let charName = 'character';
  if (charId) {
    // Look up character in self or opponent
    const selfChar = view.self.characters?.[charId];
    const oppChar = view.opponent.characters?.[charId];
    const charDefId = (selfChar ?? oppChar)?.definitionId;
    if (charDefId) {
      const charDef = cardPool[charDefId as string];
      if (charDef && isCharacterCard(charDef)) charName = charDef.name;
    }
  }

  return `<br><span class="situation-banner-detail">${charName} attempting to influence ${factionName}</span>`;
}

/**
 * Returns instruction text for the current game phase, or null if none is needed.
 * Displayed in the center of the visual board to guide the player.
 * May contain HTML (e.g. inline region type icons).
 */
function getInstructionText(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string | null {
  if (view.phaseState.phase === 'setup') {
    switch (view.phaseState.setupStep.step) {
      case 'character-draft':
        return 'Character Draft — Pick a character from your pool. Both players reveal simultaneously. Collisions set the character aside.';
      case 'item-draft':
        return 'Starting Items — Assign your minor items to characters in your starting company.';
      case 'character-deck-draft':
        return 'Add remaining pool characters to your play deck, or pass to finish.';
      case 'starting-site-selection': {
        const plural = getAlignmentRules(view.self.alignment).maxStartingSites > 1;
        return `Site Selection — Choose your starting site${plural ? 's' : ''} from your site deck.`;
      }
      case 'character-placement':
        return 'Character Placement — Assign characters to your starting companies.';
      case 'deck-shuffle':
        return 'Shuffle — Shuffling play decks.';
      case 'initial-draw':
        return 'Draw — Drawing initial hand.';
      case 'initiative-roll':
        return 'Initiative — Roll dice to determine who goes first.';
    }
  }

  // Combat sub-state instructions
  if (view.combat) {
    const iAmDefender = view.self.id === view.combat.defendingPlayerId;
    if (view.combat.phase === 'assign-strikes') {
      const isMyTurn = (view.combat.assignmentPhase === 'defender' && iAmDefender)
        || (view.combat.assignmentPhase === 'attacker' && !iAmDefender);
      return isMyTurn
        ? 'Combat — Click a character to assign a strike, or pass.'
        : 'Combat — Opponent is assigning strikes.';
    }
    if (view.combat.phase === 'choose-strike-order') {
      return iAmDefender
        ? 'Combat — Click a character to choose which strike resolves next.'
        : 'Combat — Opponent is choosing strike order.';
    }
    if (view.combat.phase === 'resolve-strike') {
      return iAmDefender
        ? 'Combat — Choose Tapped (fight normally) or Untapped (-3 prowess to stay untapped).'
        : 'Combat — Opponent is resolving a strike.';
    }
    if (view.combat.phase === 'body-check') {
      return !iAmDefender
        ? 'Combat — Roll the body check.'
        : 'Combat — Opponent rolls the body check.';
    }
  }

  // Chain of effects: show priority/mode context
  if (view.chain) {
    const isSelf = view.chain.priority === view.self.id;

    // Check if the chain is for an influence attempt and show context
    const infEntry = view.chain.entries.find(e => e.payload.type === 'influence-attempt' && e.card);
    if (infEntry) {
      // While a faction-influence-roll is pending, the situation banner
      // (rendered in company-view) carries the full breakdown. Show only a
      // short prompt in the instruction line so the two don't duplicate.
      // Note: chain `priority` is stale during resolving — the actual roller
      // is the influence-attempt's declaring player.
      const rollPending = view.legalActions.some(
        ea => ea.viable && ea.action.type === 'faction-influence-roll',
      );
      if (rollPending) {
        const isRoller = infEntry.declaredBy === view.self.id;
        return isRoller
          ? 'Faction Influence — Roll the dice.'
          : 'Faction Influence — Opponent is rolling.';
      }

      const infDetail = buildInfluenceChainDetail(infEntry, view, cardPool);
      if (view.chain.mode === 'declaring') {
        return isSelf
          ? `Faction Influence — Respond or pass priority.${infDetail}`
          : `Faction Influence — Waiting for opponent to respond.${infDetail}`;
      }
      return `Faction Influence — Resolving...${infDetail}`;
    }

    if (view.chain.mode === 'declaring') {
      return isSelf
        ? 'Chain of Effects — You have priority. Play a response or pass.'
        : 'Chain of Effects — Waiting for opponent to respond or pass.';
    }
    return 'Chain of Effects — Resolving...';
  }

  // M/H phase steps
  if (view.phaseState.phase === Phase.MovementHazard) {
    const isSelf = view.activePlayer === view.self.id;
    switch (view.phaseState.step) {
      case 'select-company':
        return 'Movement/Hazard — Select a company to resolve its movement.';
      case 'reveal-new-site':
        return 'Movement/Hazard — Revealing destination site.';
      case 'set-hazard-limit':
        return 'Movement/Hazard — Computing hazard limit for this company.';
      case 'order-effects':
        return isSelf
          ? 'Movement/Hazard — Order ongoing effects for this company.'
          : 'Movement/Hazard — Opponent is ordering ongoing effects.';
      case 'draw-cards':
        return 'Movement/Hazard — Drawing cards for movement.';
      case 'play-hazards': {
        const mh = view.phaseState;
        const pathDesc = buildMovementPathHtml(mh);
        if (isSelf) {
          return pathDesc
            ? `Movement/Hazard — Play hazards or pass.<br>${pathDesc}`
            : 'Movement/Hazard — Play hazards or pass.';
        }
        return pathDesc
          ? `Movement/Hazard — You may play hazards.<br>${pathDesc}`
          : 'Movement/Hazard — You may play hazards.';
      }
      case 'reset-hand':
        return 'Movement/Hazard — Resetting hand size.';
    }
  }

  // Site phase steps
  if (view.phaseState.phase === Phase.Site) {
    const isSelf = view.activePlayer === view.self.id;
    switch (view.phaseState.step) {
      case 'select-company':
        return 'Site — Select a company to resolve its site phase.';
      case 'enter-or-skip':
        return isSelf
          ? 'Site — Enter the site or skip.'
          : 'Site — Opponent deciding whether to enter site.';
      case 'reveal-on-guard-attacks':
        return isSelf
          ? 'Site — Opponent may reveal on-guard cards.'
          : 'Site — Reveal on-guard cards or pass.';
      case 'automatic-attacks':
        return 'Site — Facing automatic attacks.';
      case 'declare-agent-attack':
        return isSelf
          ? 'Site — Opponent may declare an agent attack.'
          : 'Site — Declare an agent attack or pass.';
      case 'resolve-attacks':
        return 'Site — Resolving on-guard/agent attacks.';
      case 'play-resources': {
        // On-guard reveal window is now driven by an `on-guard-window`
        // pending resolution; detect it via legalActions instead of the
        // legacy phase-state field.
        const onGuardActive = view.legalActions.some(
          ea => ea.viable && ea.action.type === 'reveal-on-guard',
        );
        if (onGuardActive) {
          return isSelf
            ? 'Site — Opponent may reveal on-guard cards.'
            : 'Site — Reveal on-guard card or pass to allow resource play.';
        }
        return isSelf
          ? 'Site — Play a resource or pass.'
          : 'Site — Opponent may play a resource.';
      }
      case 'play-minor-item':
        return isSelf
          ? 'Site — Play an additional minor item or pass.'
          : 'Site — Opponent may play a minor item.';
    }
  }

  // Long-event phase
  if (view.phaseState.phase === Phase.LongEvent) {
    const isSelf = view.activePlayer === view.self.id;
    if (isSelf) {
      return 'Long-event — Play a long-event card or continue to Movement/Hazard phase.';
    }
    return 'Long-event — Waiting for opponent.';
  }

  // End-of-turn phase steps
  if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard':
        return 'End of Turn — Discard a card from hand or pass.';
      case 'reset-hand':
        return 'End of Turn — Resetting hand to base size.';
      case 'signal-end':
        return 'End of Turn — Confirm end of turn.';
    }
  }

  // Organization phase: pending corruption checks (transfer / wound / Lure)
  // are rendered as a situation banner in the visual board (company-view.ts),
  // not in the instruction line.
  if (view.phaseState.phase === Phase.Organization) {
    const isSelf = view.activePlayer === view.self.id;
    if (isSelf) {
      return 'Organization — Plan movement, reorganize companies, and play characters.';
    }
    return 'Organization — Waiting for opponent to organize.';
  }

  // Free Council phase
  if (view.phaseState.phase === Phase.FreeCouncil) {
    const hasChecks = view.legalActions.some(ea => ea.viable && ea.action.type === 'corruption-check');
    if (hasChecks) {
      return 'Free Council — Choose a character for corruption check.';
    }
    return 'Free Council — Waiting for opponent to finish corruption checks.';
  }

  // Game Over
  if (view.phaseState.phase === Phase.GameOver) {
    const winner = view.phaseState.winner;
    if (winner === null) return 'Game Over — The game ended in a tie!';
    const winnerName = winner === view.self.id ? view.self.name : view.opponent.name;
    return `Game Over — ${winnerName} wins!`;
  }

  return null;
}

/** Render instruction text in the visual board. Targeting instructions take priority. */
export function renderInstructions(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const el = document.getElementById('instruction-text');
  if (!el) return;
  const text = getTargetingInstruction() ?? getInstructionText(view, cardPool) ?? '';
  // Use innerHTML to support inline region icons; all content comes from
  // card pool data (no user input), so this is safe.
  el.innerHTML = text;
}

/** Render the pass/stop button in the visual view if a pass-like action is available. */
export function renderPassButton(view: PlayerView, onAction: (action: GameAction) => void): void {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Remove all dynamic buttons from previous renders before rebuilding from
  // the current legal actions. This prevents stale buttons when the early
  // return (no pass action) skips the conditional re-creation below.
  document.getElementById('enter-site-btn')?.remove();
  document.getElementById('secondary-pass-btn')?.remove();
  document.getElementById('call-council-btn')?.remove();
  document.querySelectorAll('.hazard-sb-btn').forEach(b => b.remove());

  // Find a viable pass-like or single-step action (including chain priority pass)
  const passEval = view.legalActions.find(ea =>
    ea.viable && (ea.action.type === 'pass' || ea.action.type === 'draft-stop'
    || ea.action.type === 'shuffle-play-deck' || ea.action.type === 'draw-cards'
    || ea.action.type === 'roll-initiative' || ea.action.type === 'corruption-check'
    || ea.action.type === 'faction-influence-roll'
    || ea.action.type === 'pass-chain-priority' || ea.action.type === 'deck-exhaust'
    || ea.action.type === 'finished' || ea.action.type === 'untap'
    || ea.action.type === 'opponent-influence-defend'));
  const passAction = passEval?.action;
  if (!passAction) {
    btn.classList.add('hidden');
    return;
  }

  // Choose label based on action type and phase
  let label = 'Done';
  if (passAction.type === 'pass-chain-priority') {
    label = 'Pass Priority';
  } else if (passAction.type === 'draft-stop') {
    label = 'Done';
  } else if (passAction.type === 'shuffle-play-deck') {
    label = 'Shuffle';
  } else if (passAction.type === 'draw-cards') {
    label = 'Draw';
  } else if (passAction.type === 'roll-initiative') {
    label = 'Roll';
  } else if (passAction.type === 'corruption-check') {
    label = 'Roll';
  } else if (passAction.type === 'faction-influence-roll') {
    label = 'Roll';
  } else if (passAction.type === 'deck-exhaust') {
    label = 'Exhaust';
  } else if (passAction.type === 'finished') {
    label = 'Finished';
  } else if (passAction.type === 'untap') {
    label = 'Untap';
  } else if (passAction.type === 'opponent-influence-defend') {
    label = 'Roll Defense';
  } else if (view.phaseState.phase === Phase.Untap) {
    label = 'Pass';
  } else if (view.phaseState.phase === Phase.Organization) {
    label = 'Long-event';
  } else if (view.phaseState.phase === Phase.LongEvent) {
    label = 'Movement/Hazard';
  } else if (view.phaseState.phase === Phase.MovementHazard) {
    switch (view.phaseState.step) {
      case 'set-hazard-limit': label = 'Continue'; break;
      case 'draw-cards': label = 'Continue'; break;
      case 'play-hazards': label = 'Pass'; break;
      case 'reset-hand': label = 'Continue'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.Site) {
    switch (view.phaseState.step) {
      case 'enter-or-skip': label = 'Skip'; break;
      case 'play-resources': label = 'Pass'; break;
      case 'play-minor-item': label = 'Pass'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard': label = 'Done'; break;
      case 'signal-end': label = 'Finished'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.FreeCouncil) {
    label = 'Done';
  } else if (view.phaseState.phase === 'setup') {
    const step = view.phaseState.setupStep.step;
    if (step === 'item-draft') label = 'Continue';
    else if (step === 'character-deck-draft') label = 'Done';
    else if (step === 'starting-site-selection') label = 'Continue';
    else if (step === 'character-placement') label = 'Done';
    else label = 'Pass';
  }

  btn.textContent = label;
  btn.classList.remove('hidden');
  btn.onclick = () => onAction(passAction);

  // When the primary button is a non-pass action (e.g. Draw) and a pass action
  // also exists, show a secondary Pass button so both options are available.
  if (passAction.type !== 'pass' && passAction.type !== 'pass-chain-priority') {
    const secondaryPass = view.legalActions.find(ea => ea.viable && ea.action.type === 'pass');
    if (secondaryPass) {
      const passBtn2 = document.createElement('button');
      passBtn2.id = 'secondary-pass-btn';
      passBtn2.className = 'enter-site-btn'; // reuse same styling
      passBtn2.textContent = 'Pass';
      passBtn2.onclick = () => onAction(secondaryPass.action);
      btn.parentElement?.insertBefore(passBtn2, btn.nextSibling);
    }
  }

  // During untap phase, add hazard sideboard buttons for the hazard player
  if (view.phaseState.phase === Phase.Untap && view.activePlayer !== view.self.id) {
    let hazBtnOffset = 0;
    const toDiscardEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-discard');
    if (toDiscardEval) {
      const toDiscardBtn = document.createElement('button');
      toDiscardBtn.className = 'enter-site-btn hazard-sb-btn';
      toDiscardBtn.textContent = 'Hazards to Discard';
      toDiscardBtn.style.bottom = `${5.4 + hazBtnOffset * 3.4}rem`;
      toDiscardBtn.onclick = () => onAction(toDiscardEval.action);
      btn.parentElement?.insertBefore(toDiscardBtn, btn.nextSibling);
      hazBtnOffset++;
    }
    const toDeckEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-deck');
    if (toDeckEval) {
      const toDeckBtn = document.createElement('button');
      toDeckBtn.className = 'enter-site-btn hazard-sb-btn';
      toDeckBtn.textContent = 'Hazard to Deck';
      toDeckBtn.style.bottom = `${5.4 + hazBtnOffset * 3.4}rem`;
      toDeckBtn.onclick = () => onAction(toDeckEval.action);
      btn.parentElement?.insertBefore(toDeckBtn, btn.nextSibling);
    }
  }

  // During signal-end, add a "Call Council" button if available
  if (view.phaseState.phase === Phase.EndOfTurn && view.phaseState.step === 'signal-end') {
    const councilEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'call-free-council');
    if (councilEval) {
      const councilBtn = document.createElement('button');
      councilBtn.id = 'call-council-btn';
      councilBtn.className = 'enter-site-btn';
      councilBtn.textContent = 'Call Council';
      councilBtn.onclick = () => onAction(councilEval.action);
      btn.parentElement?.insertBefore(councilBtn, btn);
    }
  }

  // During enter-or-skip, add an "Enter" button for the enter-site action
  if (view.phaseState.phase === Phase.Site && view.phaseState.step === 'enter-or-skip') {
    const enterEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'enter-site');
    if (enterEval) {
      const enterBtn = document.createElement('button');
      enterBtn.id = 'enter-site-btn';
      enterBtn.className = 'enter-site-btn';
      enterBtn.textContent = 'Enter';
      enterBtn.onclick = () => onAction(enterEval.action);
      btn.parentElement?.insertBefore(enterBtn, btn);
    }
  }
}
