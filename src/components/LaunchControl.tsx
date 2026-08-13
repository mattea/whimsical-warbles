import { useState } from 'react';
import { Button, HitCounter, Badge } from '@retropolis/ui';

/**
 * A tiny interactive island: proves the React + design-system hydration path
 * works. Presentational DS components elsewhere on the page ship zero JS;
 * this one opts in with a `client:*` directive.
 */
export default function LaunchControl() {
  const [count, setCount] = useState(41);

  return (
    <div className="cluster" style={{ justifyContent: 'space-between' }}>
      <HitCounter count={count} label="pugglenauts launched" />
      <div className="cluster">
        <Badge tone="lime" blink>
          live
        </Badge>
        <Button variant="sunshine" icon="rocket" onClick={() => setCount((c) => c + 1)}>
          Launch another
        </Button>
      </div>
    </div>
  );
}
