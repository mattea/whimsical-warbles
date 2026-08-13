import * as React from 'react';
export interface SelectOption {
    label: string;
    value: string;
    disabled?: boolean;
}
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    /** Field label rendered above the control. */
    label?: string;
    /** Helper text shown beneath the field. */
    hint?: string;
    /** The choices. */
    options: SelectOption[];
    /** Placeholder shown as a disabled first option. */
    placeholder?: string;
}
/** A beveled native dropdown with a chunky candy arrow. */
export declare const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>;
