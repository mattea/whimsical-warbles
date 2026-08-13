import * as React from 'react';
export interface TooltipProps {
    /** The bubble text. */
    content: React.ReactNode;
    /** Which side of the trigger to show on. @default 'top' */
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** The element that shows the tooltip on hover/focus. */
    children: React.ReactElement;
}
/** A speech-bubble tooltip shown on hover or keyboard focus. */
export declare function Tooltip({ content, side, children }: TooltipProps): React.JSX.Element;
