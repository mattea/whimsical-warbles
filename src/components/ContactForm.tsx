import { useEffect, useMemo, useState } from 'react';
import { Window, Input, Textarea, Button, Alert } from '@retropolis/ui';
import { apiEnabled, postContact } from '../lib/api';
import '../styles/contact.css';

/**
 * The Contact ("Signal") form. Two paths, always both reachable:
 *
 *  - When a backend is configured (`apiEnabled`), the primary action POSTs to
 *    /api/contact and shows a success/error Alert inline.
 *  - The "Compose email instead" button is always available and is the primary
 *    action before the backend exists — it opens a mailto: with the current
 *    field values pre-filled, so the form is useful from day one.
 *
 * Anti-spam: a hidden honeypot input (`website`, must stay empty) and a
 * `startedAt` timestamp captured on mount, both handed to postContact.
 */

const MAILTO = 'hello@pugglenaut.com';

type Status = 'idle' | 'sending' | 'ok' | 'error';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — stays empty
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Captured once on mount; used to reject instant bot submissions.
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    setStartedAt(Date.now());
  }, []);

  // A mailto: link built from the live field values, URL-encoded.
  const mailtoHref = useMemo(() => {
    const subject = name ? `Signal from ${name}` : 'Signal from your site';
    const bodyLines = [
      message,
      '',
      '—',
      name ? `From: ${name}` : '',
      email ? `Reply-to: ${email}` : '',
    ].filter(Boolean);
    const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      bodyLines.join('\n'),
    )}`;
    return `mailto:${MAILTO}?${params}`;
  }, [name, email, message]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiEnabled || status === 'sending') return;
    setStatus('sending');
    setErrorMsg('');
    try {
      await postContact({ name, email, message, website, startedAt });
      setStatus('ok');
      // Reset the composed fields; keep the honeypot empty.
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  // Retropolis Button always renders a <button>, so the mailto fallback opens
  // the composed link via navigation rather than an <a> href.
  function composeEmail() {
    window.location.href = mailtoHref;
  }

  const sending = status === 'sending';

  return (
    <Window title="signal.txt" icon="mail" className="pg-cf">
      <form className="pg-cf-form stack" onSubmit={onSubmit} noValidate>
        {!apiEnabled ? (
          <Alert tone="info" title="Live form coming soon" icon="info">
            The send button goes live once the backend is connected. In the
            meantime, use “Compose email instead” below — it'll open your mail
            app with everything filled in.
          </Alert>
        ) : null}

        {status === 'ok' ? (
          <Alert tone="success" title="Sent" icon="check">
            Transmission received — thanks!
          </Alert>
        ) : null}

        {status === 'error' ? (
          <Alert tone="danger" title="Transmission failed" icon="warning">
            {errorMsg || 'Please try again, or compose an email instead.'}
          </Alert>
        ) : null}

        <Input
          label="Name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="name"
          icon="user"
          placeholder="Puggle McPlatypus"
        />

        <Input
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          icon="mail"
          placeholder="you@example.com"
        />

        <Textarea
          label="Message"
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          rows={6}
          placeholder="Beam down a note…"
          hint={`${message.length}/1000`}
        />

        {/* Honeypot — invisible to humans, tempting to bots. Must stay empty. */}
        <input
          className="pg-cf-hp"
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          placeholder="Leave this blank"
        />

        <div className="pg-cf-actions cluster">
          {apiEnabled ? (
            <Button type="submit" icon="rocket" disabled={sending}>
              {sending ? 'Sending…' : 'Send transmission'}
            </Button>
          ) : null}

          {/* Mailto fallback — always present; primary action when offline. */}
          <Button
            type="button"
            onClick={composeEmail}
            variant={apiEnabled ? 'secondary' : 'primary'}
            icon="mail"
          >
            Compose email instead
          </Button>
        </div>
      </form>
    </Window>
  );
}
