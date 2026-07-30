/**
 * @module changelog-page
 *
 * Renders the "Changelog" page — the project release notes from the
 * repository's `CHANGELOG.md`, fetched via `GET /api/changelog` and
 * rendered by {@link renderChangelogHtml}. Opened by clicking the
 * version number in the nav bar.
 */

import { type ScreenId } from './app-state.js';
import { apiGet } from './api.js';
import { renderChangelogReleases } from './changelog-render.js';

// Forward-declared showScreen, set by the lobby module at startup to
// avoid a circular dependency with lobby-screens.ts.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. Called once during app init. */
export function setChangelogPageCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

/** Number of releases shown initially and added per "Show more" click. */
const PAGE_SIZE = 5;

/** Show the changelog page and load the release notes from the server. */
export async function openChangelogPage(): Promise<void> {
  showScreenFn?.('changelog-screen');

  const listEl = document.getElementById('changelog-page-list');
  if (!listEl) return;

  listEl.innerHTML = '<p class="lobby-empty">Loading...</p>';

  const r = await apiGet<{ markdown: string }>('/api/changelog');
  if (!r.ok) {
    listEl.innerHTML = `<p class="lobby-empty">${r.error ?? 'Failed to load changelog'}</p>`;
    return;
  }

  const releases = renderChangelogReleases(r.data.markdown);
  listEl.innerHTML = '';
  const container = document.createElement('div');
  const moreBtn = document.createElement('button');
  moreBtn.className = 'changelog-more-btn';
  listEl.appendChild(container);
  listEl.appendChild(moreBtn);

  let shown = 0;
  const showNext = (): void => {
    container.insertAdjacentHTML('beforeend', releases.slice(shown, shown + PAGE_SIZE).join('\n'));
    shown = Math.min(shown + PAGE_SIZE, releases.length);
    const remaining = releases.length - shown;
    if (remaining === 0) {
      moreBtn.remove();
    } else {
      moreBtn.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more (${remaining} older release${remaining === 1 ? '' : 's'})`;
    }
  };
  moreBtn.addEventListener('click', showNext);
  showNext();
}
