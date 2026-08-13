import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface WindowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Text in the title bar. */
    title: React.ReactNode;
    /** Icon shown at the left of the title bar. */
    icon?: IconName;
    /** When set, an active title bar (violet) vs an inactive one (silver). @default true */
    active?: boolean;
    /** Show the minimize/maximize/close caption buttons. @default true */
    controls?: boolean;
    /** Called when the close (×) caption button is clicked. */
    onClose?: () => void;
    /** Optional status-bar text pinned to the bottom. */
    status?: React.ReactNode;
}
/** A draggable-looking desktop window with a title bar and caption buttons. */
export declare function Window({ title, icon, active, controls, onClose, status, className, children, ...rest }: WindowProps): React.JSX.Element;
