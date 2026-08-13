import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface MenuItem {
    /** Item text. Omit and set `divider` for a separator row. */
    label?: React.ReactNode;
    icon?: IconName;
    onSelect?: () => void;
    danger?: boolean;
    disabled?: boolean;
    divider?: boolean;
}
export interface MenuProps {
    /** Trigger button label. */
    label: React.ReactNode;
    /** Trigger icon. */
    icon?: IconName;
    /** The menu rows. */
    items: MenuItem[];
    /** Start open (handy for showcasing the open state). @default false */
    defaultOpen?: boolean;
    className?: string;
}
/** A drop-down command menu with a chunky raised panel. */
export declare function Menu({ label, icon, items, defaultOpen, className }: MenuProps): React.JSX.Element;
