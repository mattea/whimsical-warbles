import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface DialogProps {
    /** Whether the dialog is shown. */
    open: boolean;
    /** Title-bar text. */
    title: React.ReactNode;
    /** Title-bar icon. */
    icon?: IconName;
    /** Called by the overlay, the × button, and Escape. */
    onClose?: () => void;
    /** Footer content — usually action buttons. */
    footer?: React.ReactNode;
    children?: React.ReactNode;
}
/** A modal window floating over a dimmed starfield backdrop. */
export declare function Dialog({ open, title, icon, onClose, footer, children }: DialogProps): React.JSX.Element | null;
