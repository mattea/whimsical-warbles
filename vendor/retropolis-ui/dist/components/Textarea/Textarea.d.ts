import * as React from 'react';
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** Field label rendered above the control. */
    label?: string;
    /** Helper text shown beneath the field. */
    hint?: string;
    /** Error message; also flips the field into its error style. */
    error?: string;
}
/** A multi-line sunken text well, matching {@link Input}. */
export declare const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>;
