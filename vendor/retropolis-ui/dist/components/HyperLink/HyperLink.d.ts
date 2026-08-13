import * as React from 'react';
export interface HyperLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    /** Render in the "already visited" purple. */
    visited?: boolean;
    /** Append a little "external" globe when the link leaves the site. */
    external?: boolean;
}
/** The underlined blue (or visited-purple) hyperlink of the classic web. */
export declare const HyperLink: React.ForwardRefExoticComponent<HyperLinkProps & React.RefAttributes<HTMLAnchorElement>>;
