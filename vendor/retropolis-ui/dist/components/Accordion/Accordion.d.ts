import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface AccordionItem {
    id: string;
    title: React.ReactNode;
    content: React.ReactNode;
    icon?: IconName;
}
export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
    /** The collapsible sections. */
    items: AccordionItem[];
    /** Allow more than one panel open at once. @default false */
    allowMultiple?: boolean;
    /** Ids open on first render. */
    defaultOpen?: string[];
}
/** Stacked collapsible panels with a chunky expand/collapse toggle. */
export declare function Accordion({ items, allowMultiple, defaultOpen, className, ...rest }: AccordionProps): React.JSX.Element;
