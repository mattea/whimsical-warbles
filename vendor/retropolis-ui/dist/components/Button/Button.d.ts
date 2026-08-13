import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'sunshine' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. @default 'primary' */
    variant?: ButtonVariant;
    /** @default 'md' */
    size?: ButtonSize;
    /** Optional leading icon glyph. */
    icon?: IconName;
    /** Stretch to fill the container width. */
    block?: boolean;
}
/**
 * A chunky, beveled push-button with a hard drop shadow that "presses in" when
 * clicked. The primary control of the Retropolis kit.
 */
export declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
