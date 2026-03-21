/**
 * @module client-log
 *
 * Browser-side JSONL logger that posts entries to the web server's
 * `/log` endpoint, which writes them to `~/.meccg/logs/client-web/`.
 */

/** Post a log entry to the server. Fire-and-forget. */
export function clientLog(event: string, data?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), event, ...data };
  // Use sendBeacon for reliability (works even during page unload)
  const body = JSON.stringify(entry);
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/log', body);
  } else {
    fetch('/log', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}
