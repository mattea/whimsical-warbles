import * as React from 'react';
import { type IconName } from '../../icons/glyphs';
export type { IconName };
export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name'> {
    /** Which glyph to draw. See `iconNames` for the full set. */
    name: IconName;
    /** Square size in pixels. @default 24 */
    size?: number;
    /**
     * Accessible label. When provided the icon is announced to screen readers;
     * when omitted the icon is treated as decorative (`aria-hidden`).
     */
    title?: string;
}
/**
 * A chunky, multi-color icon from the Retropolis set — outlined and candy-filled,
 * never flat. Pixel glyphs render with crisp edges; detailed glyphs use smooth paths.
 */
export declare function Icon({ name, size, title, className, ...rest }: IconProps): React.JSX.Element;
