/**
 * @module transcript
 *
 * Human-readable text presentation of a game: the agents' decision-making
 * (weighted candidates, chosen action, notes) interleaved with the actual
 * game events (phase and turn transitions, dice rolls, notifications,
 * score changes). Used live by the runner CLIs and offline by the replay
 * playback CLI — both render the same record stream through this module,
 * so a saved replay reads exactly like the live game did.
 */

import type {
  DecisionRecord,
  GameResultRecord,
  ReplayHeader,
  TransitionRecord,
} from './types.js';

/** Rendering options for the transcript. */
export interface TranscriptOptions {
  /** Show the weighted candidate list at every decision (default true). */
  readonly showCandidates?: boolean;
  /** Maximum candidates to list per decision (default 6). */
  readonly maxCandidates?: number;
  /** Show sub-step (setup step) transitions, not just phase/turn (default false). */
  readonly showSteps?: boolean;
}

/** Render the replay header as an intro block. */
export function renderHeader(header: ReplayHeader): string[] {
  const lines: string[] = [];
  lines.push(`═══ MECCG game — seed ${header.seed} — ${header.createdAt} ═══`);
  for (const p of header.players) {
    lines.push(`  ${p.id as string}  ${p.name} [${p.agent}] — ${p.deckName} (${p.deckId}, ${p.alignment})`);
  }
  return lines;
}

/** Render a phase/turn transition as a section heading. */
export function renderTransition(record: TransitionRecord, previous: TransitionRecord | null, options: TranscriptOptions = {}): string[] {
  const stepChangeOnly = previous !== null
    && previous.turn === record.turn
    && previous.phase === record.phase;
  if (stepChangeOnly && !(options.showSteps ?? false)) return [];
  const step = record.step ? ` · ${record.step}` : '';
  const active = record.activePlayer === null ? '' : ` — active: ${record.activePlayer as string}`;
  const scores = ` [score ${record.scores[0]}:${record.scores[1]}]`;
  return [``, `── Turn ${record.turn} · ${record.phase}${step}${active}${scores} ──`];
}

/** Format a weight for the candidate list. */
function formatWeight(weight: number): string {
  const rendered = Number.isInteger(weight) ? String(weight) : weight.toFixed(2);
  return rendered.padStart(6);
}

/** Render one decision: chosen action, candidate weights, notes, effects. */
export function renderDecision(record: DecisionRecord, options: TranscriptOptions = {}): string[] {
  const showCandidates = options.showCandidates ?? true;
  const maxCandidates = options.maxCandidates ?? 6;
  const lines: string[] = [];

  const choice = record.viableCount === 1 ? ' (forced)' : ` (${record.viableCount} options)`;
  lines.push(`#${record.seq} ${record.playerName} [${record.agent}]${choice}: ${record.description}`);

  if (showCandidates && record.viableCount > 1 && record.candidates && record.candidates.length > 1) {
    const isChosen = (candidate: { readonly actionId?: string }): boolean =>
      candidate.actionId !== undefined && candidate.actionId === record.actionId;
    const shown = [...record.candidates.slice(0, maxCandidates)];
    // If the chosen action ranked below the display cutoff, surface it anyway
    // so the transcript always shows what won and with what weight.
    if (!shown.some(isChosen)) {
      const chosenCandidate = record.candidates.find(isChosen);
      if (chosenCandidate) shown.push(chosenCandidate);
    }
    for (const candidate of shown) {
      const marker = isChosen(candidate) ? '→' : ' ';
      const label = candidate.description ?? candidate.type;
      lines.push(`   ${marker} w=${formatWeight(candidate.weight)}  ${label}`);
    }
    if (record.candidates.length > shown.length) {
      lines.push(`     … and ${record.candidates.length - shown.length} more candidates`);
    }
  }

  if (record.note) {
    lines.push(`   ⓘ ${record.note}`);
  }
  for (const effect of record.effects ?? []) {
    if (effect.effect === 'dice-roll') {
      const total = effect.total !== undefined ? ` → total ${effect.total}` : '';
      lines.push(`   🎲 ${effect.playerName} rolls ${effect.die1}+${effect.die2} = ${effect.die1 + effect.die2} (${effect.label})${total}`);
    } else if (effect.effect === 'text-notification') {
      lines.push(`   ✦ ${effect.message}`);
    }
  }
  return lines;
}

/** Render the final result banner. */
export function renderResult(record: GameResultRecord, header: ReplayHeader): string[] {
  const lines: string[] = [``];
  if (record.outcome === 'completed') {
    const winnerInfo = record.winner === null
      ? 'Draw'
      : `${header.players.find(p => p.id === record.winner)?.name ?? (record.winner as string)} wins`;
    const scores = record.finalScores
      ? ` (${header.players.map(p => `${p.name} ${record.finalScores?.[p.id as string] ?? '?'}`).join(' — ')})`
      : '';
    lines.push(`═══ ${winnerInfo} by ${record.winReason ?? 'unknown'}${scores} ═══`);
  } else {
    lines.push(`═══ Game did not complete: ${record.outcome}${record.error ? ` — ${record.error}` : ''} ═══`);
  }
  lines.push(`    ${record.turns} turns, ${record.decisions} decisions, ${(record.durationMs / 1000).toFixed(1)}s`);
  return lines;
}

/**
 * Observer that prints the transcript live while a game runs.
 * Tracks the previous transition so step-only changes can be suppressed.
 */
export class TranscriptPrinter {
  private previousTransition: TransitionRecord | null = null;
  private header: ReplayHeader | null = null;

  constructor(
    private readonly options: TranscriptOptions = {},
    private readonly out: (line: string) => void = line => console.log(line),
  ) {}

  onHeader(header: ReplayHeader): void {
    this.header = header;
    for (const line of renderHeader(header)) this.out(line);
  }

  onTransition(record: TransitionRecord): void {
    for (const line of renderTransition(record, this.previousTransition, this.options)) this.out(line);
    this.previousTransition = record;
  }

  onDecision(record: DecisionRecord): void {
    for (const line of renderDecision(record, this.options)) this.out(line);
  }

  onResult(record: GameResultRecord): void {
    if (this.header === null) return;
    for (const line of renderResult(record, this.header)) this.out(line);
  }
}
