/**
 * @module scoreboard-page
 *
 * Renders the "Scoreboard" page — per-player completed-game tallies from
 * `GET /api/scoreboard`, ranked by Elo rating. The rows are aggregated
 * server-side from the completed-game records the game-server writes.
 *
 * Humans and AI seats share one rating pool, so the AI accounts act as fixed
 * anchors; AI rows are badged and can be hidden with the filter toggle.
 *
 * Clicking a row drills into that player's game list
 * (`GET /api/scoreboard/players/:name`), which shows every completed game
 * with its full scoring breakdown for both seats and the rating swing it
 * caused.
 */

import { type ScreenId } from './app-state.js';
import { apiGet } from './api.js';
import { escapeHtml, formatDateTime, formatDuration, orDash } from './html-utils.js';
import { loadGameBundle } from './lazy-load.js';
import { gameIdCell } from './scoreboard-game-id-cell.js';
import { MP_SOURCES } from '@meccg/shared';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setScoreboardPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** One scoreboard row as returned by the API. */
interface ScoreboardRow {
  readonly name: string;
  readonly human: boolean;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly rating: number | null;
  readonly peak: number | null;
  readonly provisional: boolean;
  readonly lastPlayed: string | null;
}

/** Marshalling points by category, as recorded for a finished game. */
interface Mp {
  readonly character: number;
  readonly item: number;
  readonly faction: number;
  readonly ally: number;
  readonly kill: number;
  readonly misc: number;
}

/** One seat in a completed game. */
interface PlayerGameSide {
  readonly name: string;
  readonly human: boolean;
  readonly alignment: string | null;
  readonly avatar: string | null;
  readonly deckName: string | null;
  readonly gameLength: string | null;
  readonly startingPlayer: boolean;
  readonly finalScore: number | null;
  readonly mp: Mp | null;
  readonly tournamentMp: Mp | null;
  readonly stagePoints: number | null;
}

/** One completed game from the selected player's point of view. */
interface PlayerGame {
  readonly gameId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly turns: number | null;
  readonly result: 'win' | 'loss' | 'draw';
  readonly winner: string | null;
  readonly winReason: string | null;
  readonly winCard: string | null;
  readonly self: PlayerGameSide;
  readonly opponent: PlayerGameSide | null;
  readonly ratingBefore: number | null;
  readonly ratingAfter: number | null;
  readonly ratingDelta: number | null;
}


/** Format an ISO datetime as a locale-friendly date. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

/**
 * A rating for the scoreboard column. Provisional ratings carry a `?` — they
 * rest on too few games to mean much yet. Null means the player's games
 * predate the ratings and have not been replayed (`bin/ratings rebuild`).
 */
function formatRating(row: ScoreboardRow): string {
  if (row.rating == null) return '<span class="scoreboard-rating-none">—</span>';
  const provisional = row.provisional
    ? '<span class="scoreboard-rating-provisional" title="Provisional: fewer than 15 rated games">?</span>'
    : '';
  return `${row.rating}${provisional}`;
}

/** The rating swing one game caused, as `+12` / `−9`, or an em dash. */
function formatRatingDelta(game: PlayerGame): string {
  if (game.ratingDelta == null || game.ratingAfter == null) return '—';
  const sign = game.ratingDelta > 0 ? '+' : game.ratingDelta < 0 ? '−' : '±';
  const direction = game.ratingDelta > 0 ? 'up' : game.ratingDelta < 0 ? 'down' : 'flat';
  return `${game.ratingAfter} <span class="scoreboard-rating-delta scoreboard-rating-delta--${direction}">`
    + `${sign}${Math.abs(game.ratingDelta)}</span>`;
}

/** How the game was decided, in words. */
function formatWinReason(game: PlayerGame): string {
  if (game.winner == null) return 'Draw';
  if (game.winReason === 'one-ring') {
    return game.winCard ? `The One Ring (${game.winCard})` : 'The One Ring';
  }
  if (game.winReason === 'marshalling-points') return 'Marshalling points';
  if (game.winReason === 'concession') return 'Conceded';
  return orDash(game.winReason);
}

/** Sum a marshalling-point breakdown. */
function mpTotal(mp: Mp | null): number | null {
  return mp ? MP_SOURCES.reduce((sum, key) => sum + mp[key], 0) : null;
}

/**
 * One category cell: the raw points, plus the tournament-adjusted value
 * when CoE §10.3 doubling/capping changed it.
 */
function mpCell(raw: number | null, adjusted: number | null): string {
  if (raw == null) return '—';
  if (adjusted == null || adjusted === raw) return String(raw);
  return `${raw} <span class="scoreboard-mp-adjusted">→ ${adjusted}</span>`;
}

/** A `<td>` per seat for one comparison row. */
function sideCells(
  game: PlayerGame,
  value: (side: PlayerGameSide) => string,
): string {
  const opponent = game.opponent ? value(game.opponent) : '—';
  return `<td>${value(game.self)}</td><td>${opponent}</td>`;
}

/** A marshalling-point row comparing both seats for one category. */
function mpRow(game: PlayerGame, label: string, key: keyof Mp): string {
  const cell = (side: PlayerGameSide): string =>
    mpCell(side.mp ? side.mp[key] : null, side.tournamentMp ? side.tournamentMp[key] : null);
  return `<tr><th scope="row">${label}</th>${sideCells(game, cell)}</tr>`;
}

/** Render the side-by-side scoring table for one game. */
function renderGameTable(game: PlayerGame): string {
  const head = (side: PlayerGameSide | null): string => {
    if (!side) return '<th>Opponent</th>';
    const badge = side.human ? '' : ' <span class="scoreboard-ai-badge">AI</span>';
    return `<th>${escapeHtml(side.name)}${badge}</th>`;
  };
  return `
    <table class="scoreboard-detail-table">
      <thead>
        <tr><th scope="col"></th>${head(game.self)}${head(game.opponent)}</tr>
      </thead>
      <tbody>
        <tr><th scope="row">Alignment</th>${sideCells(game, s => escapeHtml(orDash(s.alignment)))}</tr>
        <tr><th scope="row">Avatar</th>${sideCells(game, s => escapeHtml(orDash(s.avatar)))}</tr>
        <tr><th scope="row">Deck</th>${sideCells(game, s => escapeHtml(orDash(s.deckName)))}</tr>
        <tr><th scope="row">Game length</th>${sideCells(game, s => escapeHtml(orDash(s.gameLength)))}</tr>
        <tr><th scope="row">Started</th>${sideCells(game, s => (s.startingPlayer ? 'Yes' : 'No'))}</tr>
        ${mpRow(game, 'Characters', 'character')}
        ${mpRow(game, 'Items', 'item')}
        ${mpRow(game, 'Factions', 'faction')}
        ${mpRow(game, 'Allies', 'ally')}
        ${mpRow(game, 'Kills', 'kill')}
        ${mpRow(game, 'Misc', 'misc')}
        <tr class="scoreboard-detail-sum">
          <th scope="row">Total MP</th>
          ${sideCells(game, s => mpCell(mpTotal(s.mp), mpTotal(s.tournamentMp)))}
        </tr>
        <tr><th scope="row">Stage points</th>${sideCells(game, s => orDash(s.stagePoints))}</tr>
        <tr class="scoreboard-detail-sum">
          <th scope="row">Final score</th>
          ${sideCells(game, s => orDash(s.finalScore))}
        </tr>
      </tbody>
    </table>
  `;
}

/** Render one completed game as a card: outcome, metadata, scoring table. */
function renderGame(game: PlayerGame): string {
  const label = game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : 'Draw';
  const opponentName = game.opponent ? game.opponent.name : 'unknown opponent';
  return `
    <article class="scoreboard-game">
      <header class="scoreboard-game-head">
        <span class="scoreboard-result scoreboard-result--${game.result}">${label}</span>
        <span class="scoreboard-game-vs">vs ${escapeHtml(opponentName)}</span>
        <span class="scoreboard-game-when">${escapeHtml(formatDateTime(game.endedAt))}</span>
      </header>
      <dl class="scoreboard-game-meta">
        <dt>Decided by</dt><dd>${escapeHtml(formatWinReason(game))}</dd>
        <dt>Turns</dt><dd>${escapeHtml(orDash(game.turns))}</dd>
        <dt>Duration</dt><dd>${escapeHtml(formatDuration(game.durationSeconds))}</dd>
        <dt>Started</dt><dd>${escapeHtml(formatDateTime(game.startedAt))}</dd>
        <dt>Rating</dt><dd>${formatRatingDelta(game)}</dd>
        <dt>Game ID</dt>${gameIdCell(game.gameId)}
      </dl>
      ${renderGameTable(game)}
    </article>
  `;
}

/** Show every completed game for one player, newest first. */
export async function openPlayerGamesPage(playerName: string): Promise<void> {
  showScreenFn?.('scoreboard-screen');

  const listEl = document.getElementById('scoreboard-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ name: string; games: PlayerGame[] }>(
    `/api/scoreboard/players/${encodeURIComponent(playerName)}`);
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${escapeHtml(r.error ?? 'Failed to load player games')}</p>`;
    return;
  }

  const games = r.data.games;
  const body = games.length === 0
    ? '<p class="lobby-empty">No completed games for this player.</p>'
    : games.map(renderGame).join('');

  listEl.innerHTML = `
    <div class="scoreboard-detail-head">
      <button type="button" class="scoreboard-back">&larr; Back to scoreboard</button>
      <h3 class="scoreboard-detail-name">${escapeHtml(r.data.name)}</h3>
      <span class="scoreboard-detail-count">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${body}
  `;
  listEl.querySelector('.scoreboard-back')?.addEventListener('click', () => {
    void openScoreboardPage();
  });

  // Delegated so one listener covers every game card. The replay opens seated
  // with the player whose list this is, and Exit returns to this same page —
  // its markup is left intact behind the game screen. Loading the game bundle
  // takes a moment with no visual feedback of its own, so the button is
  // disabled for the duration (re-enabled only if starting the replay fails —
  // on success the scoreboard page is hidden behind the game screen anyway).
  //
  // The list container is a persistent element that survives every
  // `innerHTML` replacement, so the listener must be installed only once and
  // must read the CURRENT page's player name from the data attribute stamped
  // above — a listener added per visit closes over that visit's name, and
  // since the oldest handler fires first (and disables the button before the
  // newer ones run), revisiting another player's page kept opening replays
  // seated as the first player ever viewed.
  listEl.dataset.replayPlayer = r.data.name;
  if (!listEl.dataset.replayListenerInstalled) {
    listEl.dataset.replayListenerInstalled = 'true';
    listEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-replay-game]');
      const gameId = btn?.dataset.replayGame;
      const replayPlayer = listEl.dataset.replayPlayer;
      if (!btn || !gameId || !replayPlayer || btn.disabled) return;
      btn.disabled = true;
      void loadGameBundle()
        .then(() => window.__meccg?.startReplay?.(gameId, replayPlayer))
        .finally(() => { btn.disabled = false; });
    });
  }
}

/** Show the scoreboard page and load the rows from the server. */
export async function openScoreboardPage(): Promise<void> {
  showScreenFn?.('scoreboard-screen');

  const listEl = document.getElementById('scoreboard-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ rows: ScoreboardRow[] }>('/api/scoreboard');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load scoreboard'}</p>`;
    return;
  }

  if (r.data.rows.length === 0) {
    listEl.innerHTML = '<p class="lobby-empty">No completed games yet. The scoreboard fills in as games finish.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'scoreboard-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="scoreboard-col-rank">#</th>
        <th>Player</th>
        <th class="scoreboard-col-num">Rating</th>
        <th class="scoreboard-col-num">Peak</th>
        <th class="scoreboard-col-num">Games</th>
        <th class="scoreboard-col-num">Wins</th>
        <th class="scoreboard-col-num">Losses</th>
        <th class="scoreboard-col-num">Draws</th>
        <th>Last played</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;

  // Rank numbers count only the rows on show, so hiding the AI anchors
  // renumbers the human ladder from 1 rather than leaving gaps.
  const renderRows = (showAi: boolean): void => {
    const rows = showAi ? r.data.rows : r.data.rows.filter(row => row.human);
    tbody.innerHTML = '';
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      const aiBadge = row.human ? '' : ' <span class="scoreboard-ai-badge">AI</span>';
      tr.className = 'scoreboard-row';
      tr.innerHTML = `
        <td class="scoreboard-col-rank">${index + 1}</td>
        <td><button type="button" class="scoreboard-player-link" data-player="${escapeHtml(row.name)}"
          title="Show all games for ${escapeHtml(row.name)}">${escapeHtml(row.name)}</button>${aiBadge}</td>
        <td class="scoreboard-col-num scoreboard-col-rating">${formatRating(row)}</td>
        <td class="scoreboard-col-num">${escapeHtml(orDash(row.peak))}</td>
        <td class="scoreboard-col-num">${row.games}</td>
        <td class="scoreboard-col-num">${row.wins}</td>
        <td class="scoreboard-col-num">${row.losses}</td>
        <td class="scoreboard-col-num">${row.draws}</td>
        <td>${escapeHtml(formatDate(row.lastPlayed))}</td>
      `;
      tbody.appendChild(tr);
    });
  };
  renderRows(true);

  // Delegated: one listener on the table survives any row re-render, and
  // clicking anywhere in a row (not just the name button) drills in.
  table.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const name = target?.closest<HTMLElement>('[data-player]')?.dataset.player
      ?? target?.closest('tr')?.querySelector<HTMLElement>('[data-player]')?.dataset.player;
    if (name) void openPlayerGamesPage(name);
  });

  const filter = document.createElement('label');
  filter.className = 'scoreboard-filter';
  filter.innerHTML = '<input type="checkbox" class="scoreboard-filter-ai" checked> Show AI players';
  filter.querySelector<HTMLInputElement>('.scoreboard-filter-ai')
    ?.addEventListener('change', (event) => {
      renderRows((event.target as HTMLInputElement).checked);
    });

  listEl.innerHTML = '';
  listEl.appendChild(filter);
  listEl.appendChild(table);
}
