import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Semantic tone; picks the accent color and default icon. @default 'info' */
    tone?: ToastTone;
    /** Bold heading. */
    title: React.ReactNode;
    /** Override the tone's default icon. */
    icon?: IconName;
    /** Shows a dismiss button when provided. */
    onClose?: () => void;
}
/** A pop-up notification chip — the desktop "toast" that slides in from a corner. */
export declare function Toast({ tone, title, icon, onClose, className, children, ...rest }: ToastProps): React.JSX.Element;
