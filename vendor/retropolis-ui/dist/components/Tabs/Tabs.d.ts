import * as React from 'react';
import type { IconName } from '../../icons/glyphs';
export interface TabItem {
    id: string;
    label: React.ReactNode;
    icon?: IconName;
    content: React.ReactNode;
    disabled?: boolean;
}
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
    /** The tabs, each with its own panel content. */
    tabs: TabItem[];
    /** Active tab id (controlled). */
    value?: string;
    /** Initial active tab id (uncontrolled). Defaults to the first tab. */
    defaultValue?: string;
    /** Fires with the newly-active tab id. */
    onChange?: (id: string) => void;
}
/** Manila folder-style tabs — the active tab lifts up and joins the panel. */
export declare function Tabs({ tabs, value, defaultValue, onChange, className, ...rest }: TabsProps): React.JSX.Element;
