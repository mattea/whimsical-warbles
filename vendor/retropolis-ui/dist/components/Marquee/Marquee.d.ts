import * as React from 'react';
export interface MarqueeProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Seconds for one full pass. Lower = faster. @default 12 */
    speed?: number;
    /** Scroll direction. @default 'left' */
    direction?: 'left' | 'right';
    /** Pause the scroll when hovered. @default true */
    pauseOnHover?: boolean;
}
/**
 * A scrolling marquee banner — the "welcome to my homepage!!!" ticker. Honors
 * `prefers-reduced-motion` (freezes and stays legible) so whimsy never costs
 * readability.
 */
export declare function Marquee({ speed, direction, pauseOnHover, className, children, ...rest }: MarqueeProps): React.JSX.Element;
