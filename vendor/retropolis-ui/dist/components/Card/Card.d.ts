import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Optional title shown in a colored header strip. */
    title?: React.ReactNode;
    /** Icon shown beside the title. */
    icon?: IconName;
    /** Header accent color. @default 'violet' */
    tone?: 'violet' | 'magenta' | 'teal' | 'sunshine';
    /** Node rendered in a footer strip below the body. */
    footer?: React.ReactNode;
}
/** A bordered panel with a hard sticker shadow and an optional colored header. */
export declare function Card({ title, icon, tone, footer, className, children, ...rest }: CardProps): React.JSX.Element;
