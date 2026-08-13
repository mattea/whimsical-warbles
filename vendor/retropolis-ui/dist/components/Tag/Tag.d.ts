import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export type TagTone = 'violet' | 'magenta' | 'teal' | 'lime' | 'sunshine' | 'tangerine';
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Color tone. @default 'violet' */
    tone?: TagTone;
    /** Optional leading glyph. */
    icon?: IconName;
    /** When provided, renders a removable "x" that calls this handler. */
    onRemove?: () => void;
}
/** A rounded, pill-shaped label chip — softer and roomier than {@link Badge}. */
export declare function Tag({ tone, icon, onRemove, className, children, ...rest }: TagProps): React.JSX.Element;
