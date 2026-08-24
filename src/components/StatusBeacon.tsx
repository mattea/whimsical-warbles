import { useEffect, useState } from 'react';
import { Tooltip } from '@retropolis/ui';
import { apiEnabled, getStatus, type StatusInfo } from '../lib/api';
import '../styles/beacon.css';

/**
 * A tiny status pill for the site header — a colored dot + a two-word label.
 * It renders immediately with a neutral placeholder (so there's no layout
 * shift), then, only when a backend is configured, fetches the real status and
 * swaps in an "In orbit" / "Away" state. Any error quietly falls back to the
 * neutral pill — the header must never surface a failure.
 */

type State = 'neutral' | 'online' | 'offline';

interface Beacon {
  state: State;
  label: string;
  note: string;
}

// Static, network-free state shown before/without a backend.
const IDLE: Beacon = {
  state: 'neutral',
  label: 'Somewhere in low orbit',
  note: '',
};

function fromStatus(info: StatusInfo): Beacon {
  return {
    state: info.online ? 'online' : 'offline',
    label: info.online ? 'In orbit' : 'Away',
    note: info.note ?? '',
  };
}

export default function StatusBeacon() {
  const [beacon, setBeacon] = useState<Beacon>(IDLE);

  useEffect(() => {
    // No backend → keep the gentle static state, make no network call.
    if (!apiEnabled) return;
    let alive = true;
    getStatus()
      .then((info) => {
        if (alive) setBeacon(fromStatus(info));
      })
      .catch(() => {
        // Never show an error in the header — stay on the neutral pill.
        if (alive) setBeacon(IDLE);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pill = (
    <span className={`pg-sb pg-sb-${beacon.state}`} aria-label={`Status: ${beacon.label}`}>
      <span className="pg-sb-dot" aria-hidden="true" />
      <span className="pg-sb-label">{beacon.label}</span>
    </span>
  );

  // Only wrap in a Tooltip when there's an actual note to show.
  return beacon.note ? (
    <Tooltip content={beacon.note} side="bottom">
      {pill}
    </Tooltip>
  ) : (
    pill
  );
}
