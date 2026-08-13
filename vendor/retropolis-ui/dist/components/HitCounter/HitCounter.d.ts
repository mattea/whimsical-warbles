import * as React from 'react';
export interface HitCounterProps extends React.HTMLAttributes<HTMLDivElement> {
    /** The number to display. */
    count: number;
    /** Zero-pad to at least this many digits. @default 6 */
    digits?: number;
    /** Caption under the odometer. @default "visitors" */
    label?: React.ReactNode;
}
/** The beloved "You are visitor #000042" odometer of every 90s homepage. */
export declare function HitCounter({ count, digits, label, className, ...rest }: HitCounterProps): React.JSX.Element;
