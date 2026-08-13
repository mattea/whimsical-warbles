import * as React from 'react';
export type IconGlyph = {
    /** true = render with crisp pixel edges (no antialiasing) */
    pixel?: boolean;
    el: React.ReactNode;
};
export declare const glyphs: {
    home: {
        el: React.JSX.Element;
    };
    mail: {
        el: React.JSX.Element;
    };
    search: {
        el: React.JSX.Element;
    };
    folder: {
        el: React.JSX.Element;
    };
    floppy: {
        pixel: true;
        el: React.JSX.Element;
    };
    trash: {
        el: React.JSX.Element;
    };
    gear: {
        el: React.JSX.Element;
    };
    user: {
        el: React.JSX.Element;
    };
    heart: {
        el: React.JSX.Element;
    };
    star: {
        el: React.JSX.Element;
    };
    sparkle: {
        el: React.JSX.Element;
    };
    bell: {
        el: React.JSX.Element;
    };
    bookmark: {
        el: React.JSX.Element;
    };
    download: {
        el: React.JSX.Element;
    };
    upload: {
        el: React.JSX.Element;
    };
    link: {
        el: React.JSX.Element;
    };
    lock: {
        el: React.JSX.Element;
    };
    key: {
        pixel: true;
        el: React.JSX.Element;
    };
    calendar: {
        el: React.JSX.Element;
    };
    clock: {
        el: React.JSX.Element;
    };
    camera: {
        el: React.JSX.Element;
    };
    music: {
        el: React.JSX.Element;
    };
    globe: {
        el: React.JSX.Element;
    };
    rocket: {
        el: React.JSX.Element;
    };
    fire: {
        el: React.JSX.Element;
    };
    gift: {
        el: React.JSX.Element;
    };
    flag: {
        el: React.JSX.Element;
    };
    cloud: {
        el: React.JSX.Element;
    };
    sun: {
        el: React.JSX.Element;
    };
    moon: {
        el: React.JSX.Element;
    };
    phone: {
        el: React.JSX.Element;
    };
    chat: {
        el: React.JSX.Element;
    };
    cart: {
        el: React.JSX.Element;
    };
    pencil: {
        el: React.JSX.Element;
    };
    construction: {
        pixel: true;
        el: React.JSX.Element;
    };
    check: {
        el: React.JSX.Element;
    };
    close: {
        el: React.JSX.Element;
    };
    plus: {
        el: React.JSX.Element;
    };
    warning: {
        el: React.JSX.Element;
    };
    info: {
        el: React.JSX.Element;
    };
};
export type IconName = keyof typeof glyphs;
export declare const iconNames: IconName[];
