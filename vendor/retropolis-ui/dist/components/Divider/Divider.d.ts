import * as React from 'react';
export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Line style. @default 'rainbow' */
    variant?: 'rainbow' | 'dashed' | 'dotted' | 'solid';
    /** Optional centered label sitting on the line. */
    label?: React.ReactNode;
}
/** The classic horizontal rule — including the animated rainbow `<hr>` of yore. */
export declare function Divider({ variant, label, className, ...rest }: DividerProps): React.JSX.Element;
