# Internal Mailing System

## Context

Replace direct notifications with a persistent mail system. Messages are stored as individual JSON files per player, with a single entry point that writes the file and pushes a real-time "You have mail" WebSocket notification.

## Message Format

```json
{
  "id": "hex-id (same for all recipients of one send)",
  "title": "Summary to display",
  "status": "new | read | deleted",
  "from": "Human readable sender title",
  "sender": "ai | server",
  "topic": "card-request | card-reply | certification-request | certification-reply | feature-request | bug-fix-request",
  "body": "Markdown body",
  "timestamp": "ISO 8601",
  "subject": "Human readable subject",
  "keywords": { "deckId": "hero-1", "cardName": "Gandalf", "userName": "wigy" }
}
```

## Storage Layout

```text
~/.meccg/players/<player>/mail/inbox/<msg-id>.json
~/.meccg/players/<player>/mail/deleted/<msg-id>.json
```

## API Endpoints

### Player endpoints (session auth)

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/mail/inbox` | List inbox messages + unread count |
| `GET` | `/api/mail/inbox/:id` | Read a message (marks as read) |
| `DELETE` | `/api/mail/inbox/:id` | Delete a message (moves to deleted folder) |

### System endpoint (master key auth)

| Method | Path | Action |
|---|---|---|
| `POST` | `/api/system/mail` | Send mail to recipients. Body: `{ recipients, title, from, sender, topic, body, subject, keywords? }` |

## WebSocket Notification

When mail is delivered, online recipients receive a `mail-notification` message:

```json
{
  "type": "mail-notification",
  "unreadCount": 3
}
```

Players who are offline will see their unread count when they next call the inbox list API.

## Architecture

- **Single entry point**: `sendMail()` in `packages/lobby-server/src/mail/store.ts` handles both file writes and WebSocket notifications.
- **One file per message**: Individual JSON files avoid concurrent write conflicts (unlike the array-based card requests).
- **Status lifecycle**: `new` → `read` (on first read) → `deleted` (moved to deleted folder).
- **Sender types**: `ai` (from AI assistants) and `server` (from system processes).
- **Topic types**: `card-request`, `card-reply`, `certification-request`, `certification-reply`, `feature-request`, `bug-fix-request`.
