import * as React from 'react';
export type BadgeTone = 'violet' | 'magenta' | 'teal' | 'lime' | 'sunshine' | 'slate';
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Color tone. @default 'violet' */
    tone?: BadgeTone;
    /** Pixel-font all-caps style with a twinkle (great for "NEW!"). */
    blink?: boolean;
}
/** A tiny pixel-font label — the "NEW!" sticker of the old web. */
export declare function Badge({ tone, blink, className, children, ...rest }: BadgeProps): React.JSX.Element;
