import * as React from 'react';
export type AvatarSize = 'sm' | 'md' | 'lg';
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Image source. When absent, initials or a user glyph are shown. */
    src?: string;
    /** Alt text / name used for initials fallback. */
    name?: string;
    /** @default 'md' */
    size?: AvatarSize;
    /** Show a little green "online" dot. */
    online?: boolean;
}
/** A framed, beveled portrait — image, initials, or a fallback user glyph. */
export declare function Avatar({ src, name, size, online, className, ...rest }: AvatarProps): React.JSX.Element;
