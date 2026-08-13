import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Semantic tone; picks color + default icon. @default 'info' */
    tone?: AlertTone;
    /** Bold heading line. */
    title?: React.ReactNode;
    /** Override the default tone icon. */
    icon?: IconName;
    /** When provided, shows a dismiss button. */
    onClose?: () => void;
}
/** A colored callout box with an icon — the "you've got mail" announcement strip. */
export declare function Alert({ tone, title, icon, onClose, className, children, ...rest }: AlertProps): React.JSX.Element;
