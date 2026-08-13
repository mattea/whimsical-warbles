import * as React from 'react';
export interface RadioOption {
    label: React.ReactNode;
    value: string;
    disabled?: boolean;
}
export interface RadioGroupProps {
    /** Group heading / legend. */
    label?: string;
    /** The options to render as radios. */
    options: RadioOption[];
    /** Currently selected value (controlled). */
    value?: string;
    /** Uncontrolled initial value. */
    defaultValue?: string;
    /** Fires with the newly-selected value. */
    onChange?: (value: string) => void;
    /** Shared input `name`. Auto-generated when omitted. */
    name?: string;
    className?: string;
}
/** A set of chunky radio buttons rendered from an `options` array. */
export declare function RadioGroup({ label, options, value, defaultValue, onChange, name, className }: RadioGroupProps): React.JSX.Element;
