import * as React from 'react';
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Completion 0–100. */
    value: number;
    /** Fill color. @default 'violet' */
    tone?: 'violet' | 'magenta' | 'teal' | 'lime' | 'sunshine';
    /** Show a "42%" caption inside the bar. */
    showValue?: boolean;
    /** Render as chunky discrete segments instead of a smooth fill. @default true */
    segmented?: boolean;
}
/** A blocky "Loading…" bar, segmented like a defrag meter by default. */
export declare function Progress({ value, tone, showValue, segmented, className, ...rest }: ProgressProps): React.JSX.Element;
