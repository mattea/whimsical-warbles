import * as React from 'react';
export interface TableColumn<Row> {
    /** Key into each row object. */
    key: keyof Row & string;
    /** Column heading. */
    header: React.ReactNode;
    /** Text alignment. @default 'left' */
    align?: 'left' | 'center' | 'right';
    /** Custom cell renderer. */
    render?: (row: Row) => React.ReactNode;
}
export interface TableProps<Row> extends React.HTMLAttributes<HTMLTableElement> {
    /** Column definitions. */
    columns: TableColumn<Row>[];
    /** Row objects. */
    data: Row[];
    /** Optional caption above the grid. */
    caption?: React.ReactNode;
    /** Zebra-stripe alternate rows. @default true */
    zebra?: boolean;
}
/** A ruled data grid with a colored header and zebra striping. */
export declare function Table<Row extends Record<string, unknown>>({ columns, data, caption, zebra, className, ...rest }: TableProps<Row>): React.JSX.Element;
