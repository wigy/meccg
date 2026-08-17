/**
 * @module ask-ai
 *
 * The Ask AI control (`specs/2026-08-17-ask-ai-observer.md`): a toolbar icon
 * that appears while an observer is attached, and a panel showing what the
 * observer's agent would do in the position on screen, and why.
 *
 * The server pushes an `observer` message whenever one attaches or detaches
 * (and to each client as it is seated), because an observer arriving changes no
 * game state and so never reaches the state broadcast — the same reason the
 * watcher badge has its own message.
 *
 * Asking is a read: it changes nothing, costs nothing, and does not mark the
 * game cheated, so unlike the dev tools it needs no confirmation — and for the
 * same reason the button does not ask *which* question either. It asks about the
 * position on screen with the first agent the observer offers, and the panel
 * carries the rest (another agent, or the seat's own last move) as follow-ups
 * beside the answer. It used to open a menu whose first row was "This position",
 * which put a prompt in front of the one question that never needed one.
 */

import type { AiExplanationMessage } from '@meccg/shared';

/** Observer presence, as last reported by the server. */
export interface ObserverState {
  readonly attached: boolean;
  /** Agent specs on offer, in the order the observer was launched with them. */
  readonly agents: readonly string[];
}

/** What a question is about: the decision now, or the seat's own last move. */
export type AskAiMode = 'now' | 'last-move';

let observer: ObserverState = { attached: false, agents: [] };

/** Request id of the question in flight, or null when the panel is idle. */
let inFlight: string | null = null;

/** Counter behind the request ids; a monotone number is enough to match answers. */
let requestCounter = 0;

/** Sender for `ask-ai`, injected by the game connection so this module holds no socket. */
let sendAsk: ((requestId: string, agent: string, mode: AskAiMode) => void) | null = null;

/** How the toolbar button should render, or null when it must not be shown. */
export interface AskAiButtonState {
  readonly visible: boolean;
  /** Tooltip text; names the agent, since the answer differs per agent. */
  readonly title: string;
}

/**
 * Whether the Ask AI button shows, and what its tooltip says.
 *
 * Availability is decided by one thing: whether an observer is attached.
 * Spectators get it too — watching an AI game and asking what a different agent
 * would have played is a main use of the feature, not an edge case — and there
 * is no dev-mode gate, because nothing here can alter the game.
 */
export function askAiButtonState(state: ObserverState): AskAiButtonState {
  if (!state.attached) return { visible: false, title: '' };
  if (state.agents.length === 0) return { visible: true, title: 'Ask AI' };
  return {
    visible: true,
    title: `Ask AI (${state.agents.join(', ')})`,
  };
}

/** One row of the Ask AI menu. */
export interface AskAiMenuEntry {
  readonly label: string;
  readonly agent: string;
  readonly mode: AskAiMode;
}

/**
 * Every question that can be asked: each offered agent, about the position or
 * about the seat's own last move.
 *
 * Both questions exist for each agent rather than a single "ask" plus a mode
 * toggle, because they are different questions and the second one — "would it
 * have played what I just played?" — is the one nobody thinks to look for.
 *
 * This is no longer what the *button* offers. The button used to open this as a
 * menu, so the common question — this position, the only agent attached — cost
 * two clicks and a read of a two-row list whose rows differed by three words.
 * The button now asks it outright and this list becomes the panel's follow-ups
 * (see {@link askAiFollowUps}), which is where a second question belongs: after
 * the first answer, not in front of it.
 */
export function askAiMenuEntries(state: ObserverState): AskAiMenuEntry[] {
  return state.agents.flatMap(agent => [
    { label: `This position — ${agent}`, agent, mode: 'now' as AskAiMode },
    { label: `My last move — ${agent}`, agent, mode: 'last-move' as AskAiMode },
  ]);
}

/**
 * The questions the panel offers alongside an answer: every one except the one
 * just answered.
 *
 * Asking is a read, so re-asking costs nothing and needs no confirmation — and
 * the answer on screen is the context that makes "would it have played my last
 * move?" worth asking at all. Labels drop the agent suffix when only one agent
 * is attached, exactly as the menu did, because naming it in every row of a
 * one-agent list says nothing.
 */
export function askAiFollowUps(
  state: ObserverState,
  asked: string,
  mode: AskAiMode,
): AskAiMenuEntry[] {
  const single = state.agents.length <= 1;
  return askAiMenuEntries(state)
    .filter(entry => !(entry.agent === asked && entry.mode === mode))
    .map(entry => (single
      ? { ...entry, label: entry.label.replace(` — ${entry.agent}`, '') }
      : entry));
}

/** Heading and body for the panel, given whatever the server said. */
export interface AskAiPanelText {
  readonly heading: string;
  readonly body: string;
}

/** Seconds, rendered for a human: "1.4s" reads better than "1400ms". */
function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Turn an answer — or a refusal — into the panel's text.
 *
 * Every non-`ok` status says what to do about it: a panel that reports only
 * that something went wrong sends the reader to the terminal to find out why.
 */
export function formatAskAiPanel(msg: AiExplanationMessage): AskAiPanelText {
  const agent = msg.agent ?? 'the AI';
  switch (msg.status) {
    case 'ok':
      return {
        heading: `${agent} — ${msg.forPlayer ?? 'this seat'}`
          + (msg.elapsedMs === undefined ? '' : ` (${seconds(msg.elapsedMs)})`),
        body: (msg.lines ?? []).join('\n'),
      };
    case 'unavailable':
      return {
        heading: 'No observer attached',
        body: `${msg.message ?? 'Nothing is listening.'}\n\n`
          + 'Start one on the server host:\n\n  bin/observe --agent h2',
      };
    case 'timeout':
      return {
        heading: `${agent} ran out of time`,
        body: `${msg.message ?? 'No answer arrived.'}\n\n`
          + 'A search agent with a long budget can outlast the wait — try a smaller\n'
          + 'one (for example `--agent h2`, or `mc` with a lower `ms=`).',
      };
    default:
      return {
        heading: `${agent} could not answer`,
        body: msg.message ?? 'No reason given.',
      };
  }
}

/** The text shown while the agent is thinking. */
export function askAiPendingText(agent: string, mode: AskAiMode = 'now'): AskAiPanelText {
  return {
    heading: `Asking ${agent}…`,
    body: mode === 'last-move'
      ? 'Rewinding to the position before your last move, and ranking it.\n\n'
        + 'A search agent takes a few seconds.'
      : 'Reading the position and ranking the moves.\n\n'
        + 'A search agent takes a few seconds.',
  };
}

// ---- DOM ----

function button(): HTMLButtonElement | null {
  return document.getElementById('ask-ai-btn') as HTMLButtonElement | null;
}

/** Apply the current presence to the toolbar button. */
function render(): void {
  const btn = button();
  if (!btn) return;
  const state = askAiButtonState(observer);
  btn.style.display = state.visible ? '' : 'none';
  btn.title = state.title;
  btn.setAttribute('aria-label', state.title);
  btn.disabled = inFlight !== null;
}

/** Write a heading and body into the panel and show it. */
function showPanel(text: AskAiPanelText): void {
  const modal = document.getElementById('ask-ai-modal');
  const heading = document.getElementById('ask-ai-heading');
  const body = document.getElementById('ask-ai-body');
  if (!modal || !heading || !body) return;
  heading.textContent = text.heading;
  body.textContent = text.body;
  // A fresh answer starts at the top: the header says which seat and position
  // is being explained, and that is the first thing to read.
  body.scrollTop = 0;
  modal.classList.remove('hidden');
}

/** Hide the panel. Safe to call when it is already hidden. */
export function closeAskAiPanel(): void {
  document.getElementById('ask-ai-modal')?.classList.add('hidden');
}

/** Render the panel's follow-up questions for the question just asked. */
function renderFollowUps(asked: string, mode: AskAiMode): void {
  const host = document.getElementById('ask-ai-followups');
  if (!host) return;
  host.innerHTML = '';
  for (const entry of askAiFollowUps(observer, asked, mode)) {
    const btn = document.createElement('button');
    btn.textContent = entry.label;
    btn.disabled = inFlight !== null;
    btn.addEventListener('click', () => askAi(entry.agent, entry.mode));
    host.appendChild(btn);
  }
}

/** Record the observer presence the server pushed, and refresh the button. */
export function setObserver(state: ObserverState): void {
  observer = state;
  if (!state.attached) {
    // Any question in flight is already being failed by the server; drop the
    // local lock so the button is not left disabled forever. The panel's
    // follow-ups go with it: there is nothing left to ask.
    inFlight = null;
    const host = document.getElementById('ask-ai-followups');
    if (host) host.innerHTML = '';
  }
  render();
}

/** Clear observer state. Call when leaving the game screen. */
export function resetObserver(): void {
  inFlight = null;
  closeAskAiPanel();
  setObserver({ attached: false, agents: [] });
}

/** Register the sender for `ask-ai` messages (the game connection owns the socket). */
export function setAskAiSender(send: (requestId: string, agent: string, mode: AskAiMode) => void): void {
  sendAsk = send;
}

/** The question the panel is showing, so its follow-ups can exclude it. */
let showing: { readonly agent: string; readonly mode: AskAiMode } | null = null;

/**
 * Ask one agent about the position, or about the seat's own last move.
 *
 * Defaults to the observer's first agent and to the position on screen, which
 * is what both the toolbar button and the keyboard shortcut use: the question
 * everybody asks takes one click and answers no prompt.
 */
export function askAi(agent?: string, mode: AskAiMode = 'now'): void {
  if (!observer.attached || inFlight || !sendAsk) return;
  const asked = agent ?? observer.agents[0];
  if (!asked) return;
  inFlight = `ask-${++requestCounter}`;
  showing = { agent: asked, mode };
  render();
  showPanel(askAiPendingText(asked, mode));
  renderFollowUps(asked, mode);
  sendAsk(inFlight, asked, mode);
}

/** Handle an `ai-explanation` from the server. */
export function handleAiExplanation(msg: AiExplanationMessage): void {
  // A late answer to a question the panel has moved on from is ignored, so a
  // stale explanation cannot replace the one on screen.
  if (inFlight !== null && msg.requestId !== inFlight) return;
  inFlight = null;
  render();
  showPanel(formatAskAiPanel(msg));
  // Re-rendered rather than merely re-enabled: the answer is the point at which
  // the other questions become worth offering, and they are only clickable once
  // nothing is in flight.
  if (showing) renderFollowUps(showing.agent, showing.mode);
}

/** Whether the panel is currently on screen. */
function panelOpen(): boolean {
  return document.getElementById('ask-ai-modal')?.classList.contains('hidden') === false;
}

/** Wire the button, the close affordances, and the copy action. */
export function installAskAi(): void {
  // One click, one answer: the button asks about the position on screen with
  // the first agent the observer offers. It used to open a two-row menu whose
  // first row was this, which made the question everybody asks the one that
  // cost the most clicks. The other questions live in the panel now.
  button()?.addEventListener('click', (e) => {
    e.stopPropagation();
    askAi();
  });
  document.getElementById('ask-ai-close')?.addEventListener('click', () => closeAskAiPanel());
  document.getElementById('ask-ai-backdrop')?.addEventListener('click', () => closeAskAiPanel());
  // Escape closes, like every other dialog. Handled here rather than in the
  // shared shortcut table because it must only fire while the panel is open —
  // the game's own Escape behaviour has to keep working underneath it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeAskAiPanel();
  }, true);
  document.getElementById('ask-ai-copy')?.addEventListener('click', () => {
    const body = document.getElementById('ask-ai-body');
    if (body?.textContent) void navigator.clipboard?.writeText(body.textContent);
  });
  render();
}
