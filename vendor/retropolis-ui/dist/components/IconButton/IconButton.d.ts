import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
import type { ButtonVariant, ButtonSize } from '../Button/Button';
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Glyph to show. */
    icon: IconName;
    /** Required accessible name — icon buttons have no visible text. */
    label: string;
    /** @default 'secondary' */
    variant?: ButtonVariant;
    /** @default 'md' */
    size?: ButtonSize;
}
/** A square, beveled button holding a single icon. */
export declare const IconButton: React.ForwardRefExoticComponent<IconButtonProps & React.RefAttributes<HTMLButtonElement>>;
