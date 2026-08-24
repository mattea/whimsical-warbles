import { useEffect, useRef, useState } from 'react';
import {
  Window,
  Card,
  Input,
  Textarea,
  Button,
  Alert,
  Badge,
  Avatar,
} from '@retropolis/ui';
import {
  apiEnabled,
  getGuestbook,
  postGuestbook,
  type GuestbookEntry,
} from '../lib/api';
import '../styles/guestbook.css';

/**
 * The classic sign-the-wall guestbook — a hydrated island (client:visible).
 *
 * When the backend is wired up (`apiEnabled`), it loads the real entries and
 * lets visitors sign the wall. Before then it degrades to a read-only preview:
 * a few charming sample signatures plus a disabled form, so the page still
 * looks complete on the static site.
 */

const NAME_MAX = 40;
const MESSAGE_MAX = 500;

// Shown when the backend isn't connected yet — clearly labeled as samples.
const SAMPLE_ENTRIES: GuestbookEntry[] = [
  {
    id: 'sample-ada',
    name: 'Ada',
    message: 'First! Lovely little ship you have here. Keep orbiting. 🛰️',
    createdAt: '1994-08-16T09:24:00.000Z',
  },
  {
    id: 'sample-comet',
    name: 'a passing comet',
    message: 'Streaked by, left a sparkle, cannot stay. See you in 76 years.',
    createdAt: '1997-11-02T21:07:00.000Z',
  },
  {
    id: 'sample-moon-mouse',
    name: 'moon mouse',
    message: 'squeak! the cheese up here is excellent. tell the puggle i said hi.',
    createdAt: '2001-03-14T15:09:00.000Z',
  },
  {
    id: 'sample-pugglenaut',
    name: 'pugglenaut',
    message: 'Testing the pen… works! Sign below and say hello. 🖊️',
    createdAt: '2026-08-24T12:00:00.000Z',
  },
];

/** Format an ISO date as a friendly, retro-flavored stamp. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface EntryRowProps {
  entry: GuestbookEntry;
}

function EntryRow({ entry }: EntryRowProps) {
  return (
    <Card className="pg-gb-entry">
      <div className="pg-gb-entry-head">
        <div className="pg-gb-entry-who">
          <Avatar name={entry.name} size="sm" />
          <span className="pg-gb-entry-name">{entry.name}</span>
        </div>
        <Badge tone="teal" className="pg-gb-entry-date">
          {formatDate(entry.createdAt)}
        </Badge>
      </div>
      <p className="pg-gb-entry-message">{entry.message}</p>
    </Card>
  );
}

export default function Guestbook() {
  const [entries, setEntries] = useState<GuestbookEntry[]>(
    apiEnabled ? [] : SAMPLE_ENTRIES,
  );
  const [loading, setLoading] = useState(apiEnabled);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — must stay empty
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ms epoch captured when the form is first shown, to reject instant bots.
  const startedAt = useRef<number>(Date.now());

  // Load the real entries once, on mount, when the backend is available.
  useEffect(() => {
    if (!apiEnabled) return;
    let live = true;
    setLoading(true);
    getGuestbook()
      .then((rows) => {
        if (!live) return;
        // Newest first.
        const sorted = [...rows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setEntries(sorted);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(
          err instanceof Error ? err.message : 'Could not load the guestbook.',
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const trimmedName = name.trim();
  const trimmedMessage = message.trim();
  const canSubmit =
    apiEnabled &&
    !submitting &&
    trimmedName.length > 0 &&
    trimmedName.length <= NAME_MAX &&
    trimmedMessage.length > 0 &&
    trimmedMessage.length <= MESSAGE_MAX;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await postGuestbook({
        name: trimmedName,
        message: trimmedMessage,
        website, // honeypot, expected empty
        startedAt: startedAt.current,
      });
      // Optimistically prepend the returned entry and clear the form.
      setEntries((prev) => [created, ...prev]);
      setName('');
      setMessage('');
      setWebsite('');
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not sign the guestbook.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const nameError =
    trimmedName.length > NAME_MAX ? `Keep it under ${NAME_MAX} characters.` : undefined;
  const messageError =
    trimmedMessage.length > MESSAGE_MAX
      ? `Keep it under ${MESSAGE_MAX} characters.`
      : undefined;

  return (
    <div className="pg-gb stack">
      {/* --- Sign form ------------------------------------------------------ */}
      <Window title="sign-here.exe" icon="pencil">
        <form className="pg-gb-form stack" onSubmit={onSubmit}>
          {!apiEnabled ? (
            <Alert tone="info" title="Signing goes live soon" icon="info">
              The guestbook is in preview. Once the backend is connected, this
              form will let you sign the wall for real. The entries below are
              friendly samples.
            </Alert>
          ) : null}

          <Input
            label="Your name"
            icon="user"
            placeholder="pilot name…"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            hint={`${name.length}/${NAME_MAX}`}
            error={nameError}
            disabled={!apiEnabled || submitting}
            autoComplete="name"
          />

          <Textarea
            label="Your message"
            placeholder="leave a note for the pugglenaut…"
            value={message}
            maxLength={MESSAGE_MAX}
            rows={4}
            onChange={(e) => setMessage(e.target.value)}
            hint={`${message.length}/${MESSAGE_MAX}`}
            error={messageError}
            disabled={!apiEnabled || submitting}
          />

          {/* Honeypot — visually hidden; real users never fill this in. */}
          <div className="pg-gb-hp" aria-hidden="true">
            <label htmlFor="pg-gb-website">Leave this field empty</label>
            <input
              id="pg-gb-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {submitError ? (
            <Alert tone="danger" title="Couldn't sign" icon="warning">
              {submitError}
            </Alert>
          ) : null}

          <div className="pg-gb-form-actions">
            <Button
              type="submit"
              variant="primary"
              icon="pencil"
              disabled={!canSubmit}
            >
              {submitting ? 'Signing…' : 'Sign the guestbook'}
            </Button>
          </div>
        </form>
      </Window>

      {/* --- Entry list ----------------------------------------------------- */}
      <Window
        title="guestbook.log"
        icon="chat"
        status={
          loading
            ? 'Loading…'
            : `${entries.length} ${entries.length === 1 ? 'signature' : 'signatures'}`
        }
      >
        <div className="pg-gb-list stack">
          {loadError ? (
            <Alert tone="danger" title="Couldn't load the guestbook" icon="warning">
              {loadError}
            </Alert>
          ) : null}

          {loading ? (
            <p className="pg-gb-status">Fetching signatures from the wall…</p>
          ) : entries.length === 0 && !loadError ? (
            <p className="pg-gb-status">
              No signatures yet — be the first to sign above!
            </p>
          ) : (
            entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
          )}
        </div>
      </Window>
    </div>
  );
}
