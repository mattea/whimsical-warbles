import * as React from 'react';
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    /** Text shown next to the box. */
    label?: React.ReactNode;
}
/** A chunky, sunken 3D checkbox with a lime check. */
export declare const Checkbox: React.ForwardRefExoticComponent<CheckboxProps & React.RefAttributes<HTMLInputElement>>;
