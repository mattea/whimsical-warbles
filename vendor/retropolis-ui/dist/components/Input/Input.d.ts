import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    /** Field label rendered above the control. */
    label?: string;
    /** Helper text shown beneath the field. */
    hint?: string;
    /** Error message; also flips the field into its error style. */
    error?: string;
    /** Optional icon tucked inside the left of the field. */
    icon?: IconName;
}
/** A sunken, beveled text field — the classic inset "type here" well. */
export declare const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>;
