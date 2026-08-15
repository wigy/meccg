/**
 * @module replay
 *
 * Plays a finished game back on the real game board.
 *
 * The server records every engine transition of every game as a full state
 * snapshot (see `games/replay.ts`), so playback needs no simulation: each
 * frame is fetched already projected into a {@link PlayerView} and handed to
 * {@link renderStateMessage} — the same function the live WebSocket handler
 * calls. The board, companies, dice, hand arc, phase meter and toasts are
 * therefore identical to watching the game live; only the transport differs.
 *
 * The viewer is read-only. It borrows spectator mode (`appState.spectating`)
 * to suppress the play affordances, and the frames arrive with an empty
 * legal-action list so no action buttons are offered in the first place.
 */

import type { GameAction, PlayerView } from '@meccg/shared';
import { describeAction } from '@meccg/shared';
import { apiGet } from './api.js';
import { appState, cardPool } from './app-state.js';
import { renderStateMessage, setLoadingCover, setReplayExit } from './game-connection.js';
import { renderLog, showNotification, clearGameMessageLog } from './render.js';
import { escapeHtml } from './html-utils.js';
import {
  disabledActions, frameLabel, playFrom, targetFrame, type TransportAction,
} from './replay-transport.js';

/** One recorded transition, as served by `GET /api/replay/:gameId`. */
interface ReplayFrameMeta {
  readonly index: number;
  readonly seq: number;
  readonly ts: string | null;
  readonly turn: number | null;
  readonly phase: string | null;
  readonly step: string | null;
  readonly activePlayer: string | null;
  readonly reason: string | null;
  readonly action: GameAction | null;
}

/** A seat in the recorded game. */
interface ReplaySeat {
  readonly id: string;
  readonly name: string;
}

/** The replay timeline for one game. */
interface ReplayIndex {
  readonly gameId: string;
  readonly seats: readonly ReplaySeat[];
  readonly frames: readonly ReplayFrameMeta[];
}

/** Playback speeds offered in the transport bar, in ms per frame. */
const SPEEDS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: 'Slow', ms: 2500 },
  { label: 'Normal', ms: 1200 },
  { label: 'Fast', ms: 500 },
  { label: 'Fastest', ms: 150 },
];

/** Frames to pull ahead of the cursor so playback does not stall on the network. */
const PREFETCH_AHEAD = 3;

/** Everything about the replay currently on screen. Null when not replaying. */
interface ReplaySession {
  readonly index: ReplayIndex;
  /** Seat the board is drawn from. */
  seat: string;
  /** Frame currently rendered, or -1 before the first render. */
  cursor: number;
  /** Fetched views, keyed `<seat>:<frameIndex>`. */
  readonly cache: Map<string, PlayerView>;
  /** Pending playback timer, or null when paused. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Milliseconds between frames while playing. */
  speedMs: number;
  /** Guard against a seek landing while an earlier one is still fetching. */
  renderToken: number;
}

let session: ReplaySession | null = null;

/** True while the replay viewer owns the board. */
export function isReplaying(): boolean {
  return session !== null;
}

// ---- Frame loading ----

/** Fetch one frame's projected view, memoised per seat. */
async function loadFrame(index: number, seat: string): Promise<PlayerView | null> {
  if (!session) return null;
  const key = `${seat}:${index}`;
  const cached = session.cache.get(key);
  if (cached) return cached;

  const r = await apiGet<{ view: PlayerView }>(
    `/api/replay/${encodeURIComponent(session.index.gameId)}/frames/${index}`
    + `?seat=${encodeURIComponent(seat)}`);
  if (!r.ok) return null;
  // The session may have been torn down while the request was in flight.
  session?.cache.set(key, r.data.view);
  return r.data.view;
}

/**
 * Warm the cache a few frames ahead so pressing play does not pause on every
 * step. Deliberately fire-and-forget: a failed prefetch simply means the real
 * fetch happens when the cursor arrives.
 */
function prefetchAhead(from: number, seat: string): void {
  if (!session) return;
  const last = Math.min(from + PREFETCH_AHEAD, session.index.frames.length - 1);
  for (let i = from + 1; i <= last; i++) {
    void loadFrame(i, seat);
  }
}

// ---- Move descriptions ----

/**
 * How a frame's move reads in the transport bar and the log. Falls back to the
 * frame's `reason` for the opening frame and for logs recorded before the game
 * server started storing the action alongside the state.
 */
function describeFrame(frame: ReplayFrameMeta): string {
  if (!frame.action) return frame.reason === 'new-game' ? 'Game start' : (frame.reason ?? '—');
  const who = appState.lastPlayerNames[frame.action.player as string];
  const what = describeAction(
    frame.action, cardPool, appState.lastInstanceLookup,
    appState.lastCompanyNames, appState.lastPlayerNames,
  );
  return who ? `${who}: ${what}` : what;
}

// ---- Transport bar ----

/** Build the transport bar and wire its controls. */
function buildBar(index: ReplayIndex): HTMLElement {
  const bar = document.createElement('div');
  bar.id = 'replay-bar';
  const seats = index.seats
    .map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  const speeds = SPEEDS
    .map(s => `<option value="${s.ms}">${s.label}</option>`).join('');
  bar.innerHTML = `
    <div class="replay-transport">
      <button type="button" class="replay-btn" data-act="first" title="First frame">&#x23EE;</button>
      <button type="button" class="replay-btn" data-act="prev" title="Previous frame (&larr;)">&#x25C0;</button>
      <button type="button" class="replay-btn replay-btn-play" data-act="play" title="Play / pause (space)">&#x25B6;</button>
      <button type="button" class="replay-btn" data-act="next" title="Next frame (&rarr;)">&#x25B6;</button>
      <button type="button" class="replay-btn" data-act="last" title="Last frame">&#x23ED;</button>
    </div>
    <input type="range" class="replay-scrubber" min="0" max="${index.frames.length - 1}" value="0"
      title="Scrub through the game">
    <div class="replay-meta">
      <span class="replay-position"></span>
      <span class="replay-where"></span>
      <span class="replay-move"></span>
    </div>
    <label class="replay-select">View as
      <select class="replay-seat">${seats}</select>
    </label>
    <label class="replay-select">Speed
      <select class="replay-speed">${speeds}</select>
    </label>
    <button type="button" class="replay-exit">Exit replay</button>
  `;

  bar.querySelector('.replay-transport')?.addEventListener('click', (event) => {
    const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || !session) return;
    if (act === 'play') { togglePlay(); return; }
    const target = targetFrame(act as TransportAction, session.cursor, session.index.frames.length);
    if (target === null) return;
    pause();
    void seek(target);
  });

  bar.querySelector<HTMLInputElement>('.replay-scrubber')?.addEventListener('input', (event) => {
    pause();
    void seek(parseInt((event.target as HTMLInputElement).value, 10));
  });

  bar.querySelector<HTMLSelectElement>('.replay-seat')?.addEventListener('change', (event) => {
    if (!session) return;
    session.seat = (event.target as HTMLSelectElement).value;
    // Redraw the same moment from the other side of the table.
    void seek(session.cursor, { force: true });
  });

  bar.querySelector<HTMLSelectElement>('.replay-speed')?.addEventListener('change', (event) => {
    if (!session) return;
    session.speedMs = parseInt((event.target as HTMLSelectElement).value, 10);
  });

  bar.querySelector('.replay-exit')?.addEventListener('click', () => { exitReplay(); });

  const speedSelect = bar.querySelector<HTMLSelectElement>('.replay-speed');
  if (speedSelect) speedSelect.value = String(SPEEDS[1].ms);

  return bar;
}

/** Refresh the bar's readouts for the frame now on screen. */
function updateBar(): void {
  if (!session) return;
  const bar = document.getElementById('replay-bar');
  if (!bar) return;
  const frame = session.index.frames[session.cursor];
  const total = session.index.frames.length;

  const scrubber = bar.querySelector<HTMLInputElement>('.replay-scrubber');
  if (scrubber) scrubber.value = String(session.cursor);

  const position = bar.querySelector('.replay-position');
  if (position) position.textContent = `${session.cursor + 1} / ${total}`;

  const where = bar.querySelector('.replay-where');
  if (where) where.textContent = frameLabel(frame);

  const move = bar.querySelector('.replay-move');
  if (move) move.textContent = describeFrame(frame);

  const playBtn = bar.querySelector('.replay-btn-play');
  if (playBtn) {
    playBtn.innerHTML = session.timer ? '&#x23F8;' : '&#x25B6;';
    playBtn.setAttribute('title', session.timer ? 'Pause (space)' : 'Play (space)');
  }

  for (const [act, disabled] of Object.entries(disabledActions(session.cursor, total))) {
    bar.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)?.toggleAttribute('disabled', disabled);
  }
}

// ---- Transport ----

/** Render the frame at `index`, moving the cursor there. */
async function seek(index: number, opts?: { force?: boolean }): Promise<void> {
  if (!session) return;
  const total = session.index.frames.length;
  if (index < 0 || index >= total) return;
  if (index === session.cursor && !opts?.force) return;

  const seat = session.seat;
  const token = ++session.renderToken;
  // Any move other than the next frame breaks the log's narrative — it is an
  // append-only trail of what just happened, so a jump starts a fresh one.
  const sequential = index === session.cursor + 1;
  const view = await loadFrame(index, seat);
  // A newer seek (or an exit) landed while this frame was loading.
  if (!session || session.renderToken !== token) return;
  if (!view) {
    showNotification('Could not load that moment of the replay');
    pause();
    return;
  }

  const frame = session.index.frames[index];
  if (!sequential) {
    document.getElementById('log')!.innerHTML = '';
    renderLog(`-- jumped to move ${index + 1} of ${total} --`);
  }

  await renderStateMessage({
    type: 'state',
    view,
    ...(frame.action ? { lastAction: frame.action } : {}),
  });
  if (!session || session.renderToken !== token) return;

  session.cursor = index;
  // renderStateMessage logs the opponent's moves only (a live player logs
  // their own when they send them), so the seat's own moves are added here to
  // keep the replay log a complete move list.
  if (frame.action && frame.action.player === view.self.id) {
    renderLog(`>> ${describeFrame(frame)}`, cardPool);
  }
  updateBar();
  prefetchAhead(index, seat);
}

/** Schedule the next frame while playing. */
function tick(): void {
  if (!session) return;
  session.timer = setTimeout(() => {
    if (!session) return;
    session.timer = null;
    const total = session.index.frames.length;
    if (session.cursor >= total - 1) { updateBar(); return; }
    void seek(session.cursor + 1).then(() => {
      // Stop at the end rather than wrapping: playback that looped forever
      // would be impossible to leave running.
      if (session && session.cursor < session.index.frames.length - 1) tick();
      else updateBar();
    });
  }, session.speedMs);
  updateBar();
}

/** Stop playback, leaving the cursor where it is. */
function pause(): void {
  if (!session?.timer) return;
  clearTimeout(session.timer);
  session.timer = null;
  updateBar();
}

/** Start or stop playback. At the last frame, play restarts from the top. */
function togglePlay(): void {
  if (!session) return;
  if (session.timer) { pause(); return; }
  const from = playFrom(session.cursor, session.index.frames.length);
  if (from === null) return;
  if (from === 0 && session.cursor !== 0) {
    void seek(0).then(() => tick());
    return;
  }
  tick();
}

/** Keyboard transport: arrows step, space plays/pauses, Escape leaves. */
function onKeyDown(event: KeyboardEvent): void {
  if (!session) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
  const step = (act: TransportAction): void => {
    const target = targetFrame(act, session!.cursor, session!.index.frames.length);
    if (target === null) return;
    pause();
    void seek(target);
  };
  if (event.key === 'ArrowLeft') step('prev');
  else if (event.key === 'ArrowRight') step('next');
  else if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'Escape') { exitReplay(); }
  else return;
  event.stopPropagation();
}

// ---- Lifecycle ----

/**
 * Open the replay viewer for a finished game. `seatName` picks the starting
 * perspective when it matches one of the two seats — the scoreboard passes the
 * player whose game list the replay was opened from.
 */
export async function startReplay(gameId: string, seatName: string | null): Promise<void> {
  const ns = window.__meccg;
  // Show the game shell behind the loading cover while the index downloads.
  ns?.showScreen?.('auth-screen');
  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('game')!.classList.remove('hidden');
  setLoadingCover(true, 'Loading replay...');

  const r = await apiGet<ReplayIndex>(`/api/replay/${encodeURIComponent(gameId)}`);
  if (!r.ok || r.data.frames.length === 0 || r.data.seats.length === 0) {
    document.getElementById('game')!.classList.add('hidden');
    ns?.showScreen?.('scoreboard-screen');
    showNotification(r.ok ? 'This game has no replayable recording' : (r.error ?? 'Failed to load the replay'));
    return;
  }

  const index = r.data;
  const match = index.seats.find(s => s.name.toLowerCase() === (seatName ?? '').toLowerCase());
  session = {
    index,
    seat: (match ?? index.seats[0]).id,
    cursor: -1,
    cache: new Map(),
    timer: null,
    speedMs: SPEEDS[1].ms,
    renderToken: 0,
  };

  // Read-only board: spectator mode suppresses the hand's play affordances
  // and the pass button, and `replaying` stands down anything socket-bound.
  appState.replaying = true;
  appState.spectating = true;
  appState.autoReconnect = false;
  appState.currentGameId = gameId;
  document.body.classList.add('spectating', 'replaying');
  ns?.refreshDevMode?.();
  ns?.clearGameBoard?.();
  document.getElementById('log')!.innerHTML = '';

  const bar = buildBar(index);
  document.getElementById('game')!.appendChild(bar);
  const seatSelect = bar.querySelector<HTMLSelectElement>('.replay-seat');
  if (seatSelect) seatSelect.value = session.seat;
  document.addEventListener('keydown', onKeyDown, true);

  await seek(0, { force: true });
  setLoadingCover(false);
}

/** Tear the replay down and return to the scoreboard. */
export function exitReplay(): void {
  if (!session) return;
  pause();
  session = null;
  document.removeEventListener('keydown', onKeyDown, true);
  document.getElementById('replay-bar')?.remove();

  appState.replaying = false;
  appState.spectating = false;
  appState.currentGameId = null;
  document.body.classList.remove('spectating', 'replaying');

  window.__meccg?.clearGameBoard?.();
  document.getElementById('log')!.innerHTML = '';
  document.getElementById('state')!.textContent = '';
  document.getElementById('draft')!.textContent = '';
  // The text-log panel (#game-log-panel) is a fixed overlay outside #game, so
  // hiding #game below does not hide it — its toasts from the replay's
  // playback would otherwise keep floating on screen after leaving.
  clearGameMessageLog();
  // Re-arm the cover so the next game (or replay) never flashes this board.
  setLoadingCover(true);
  document.getElementById('game')!.classList.add('hidden');
  window.__meccg?.showScreen?.('scoreboard-screen');
}

setReplayExit(exitReplay);
