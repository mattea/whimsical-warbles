import * as React from 'react';
export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    /** Text shown next to the toggle. */
    label?: React.ReactNode;
}
/** A retro sliding power-switch toggle. */
export declare const Switch: React.ForwardRefExoticComponent<SwitchProps & React.RefAttributes<HTMLInputElement>>;
