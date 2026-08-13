// src/icons/glyphs.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var INK = "#1c1030";
var px = (x, y, fill, w = 1, h = 1) => /* @__PURE__ */ jsx("rect", { x: x * 2, y: y * 2, width: w * 2, height: h * 2, fill }, `${x}-${y}`);
var glyphs = {
  /* ---- Detailed ---------------------------------------------------------- */
  home: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M4 15 16 5l12 10v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z", fill: "#8bd450", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M2 16 16 4l14 12", fill: "none", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("rect", { x: "13", y: "18", width: "6", height: "9", fill: "#663399", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("rect", { x: "7", y: "6", width: "4", height: "6", fill: "#ff2e97", stroke: INK, strokeWidth: "1.5" })
    ] })
  },
  mail: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("rect", { x: "3", y: "7", width: "26", height: "18", rx: "1.5", fill: "#22d3ee", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M4 8 16 18 28 8", fill: "none", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M3 24 12 16M29 24 20 16", fill: "none", stroke: INK, strokeWidth: "1.5" })
    ] })
  },
  search: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "14", cy: "14", r: "8", fill: "#ffcf33", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("circle", { cx: "14", cy: "14", r: "4", fill: "#faf5ff", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M20 20 28 28", stroke: INK, strokeWidth: "4", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M20 20 28 28", stroke: "#ff2e97", strokeWidth: "1.5", strokeLinecap: "round" })
    ] })
  },
  folder: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M3 8a2 2 0 0 1 2-2h7l3 3h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", fill: "#ffcf33", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M3 12h26v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", fill: "#ff8c42", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" })
    ] })
  },
  floppy: {
    pixel: true,
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      px(3, 3, "#663399", 10, 10),
      px(4, 3, INK, 8, 1),
      px(3, 3, INK, 1, 10),
      px(12, 4, INK, 1, 9),
      px(4, 12, INK, 8, 1),
      px(6, 4, "#22d3ee", 4, 3),
      px(9, 4, INK, 1, 3),
      px(5, 8, "#faf5ff", 6, 4),
      px(6, 9, INK, 4, 1),
      px(6, 10, INK, 4, 1)
    ] })
  },
  trash: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M7 10h18l-1.5 16a2 2 0 0 1-2 1.8H10.5a2 2 0 0 1-2-1.8Z", fill: "#00b3b3", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("rect", { x: "5", y: "6", width: "22", height: "4.5", rx: "1.5", fill: "#5b5470", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M12 5h8v2h-8Z", fill: "#5b5470", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M13 14v9M16 14v9M19 14v9", stroke: INK, strokeWidth: "1.5", strokeLinecap: "round" })
    ] })
  },
  gear: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 3l2 3.5 4-1 .5 4 3.8 1.4-2 3.6 2 3.6-3.8 1.4-.5 4-4-1-2 3.5-2-3.5-4 1-.5-4L3.7 22.6l2-3.6-2-3.6 3.8-1.4.5-4 4 1Z", fill: "#9a5cff", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "5", fill: "#ffcf33", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "1.8", fill: INK })
    ] })
  },
  user: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "12", r: "6", fill: "#ff8c42", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M5 28c0-6.2 5-10 11-10s11 3.8 11 10Z", fill: "#22d3ee", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "12", r: "6", fill: "none", stroke: INK, strokeWidth: "2" })
    ] })
  },
  heart: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 27C6 20 4 14 4 10.5A6.5 6.5 0 0 1 16 7 6.5 6.5 0 0 1 28 10.5C28 14 26 20 16 27Z", fill: "#ff2e97", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M9 11a3.5 3.5 0 0 1 4-2.5", fill: "none", stroke: "#fff", strokeWidth: "2", strokeLinecap: "round" })
    ] })
  },
  star: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 3l3.6 8.2 8.9.8-6.7 5.9 2 8.7L16 22.8 8.2 26.6l2-8.7L3.5 12l8.9-.8Z", fill: "#ffcf33", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M16 8l1.8 4.2", stroke: "#fff", strokeWidth: "1.8", strokeLinecap: "round" })
    ] })
  },
  sparkle: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 2c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10Z", fill: "#22d3ee", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M26 3c.4 2.4 1 3 3.4 3.4-2.4.4-3 1-3.4 3.4-.4-2.4-1-3-3.4-3.4C25 6 25.6 5.4 26 3Z", fill: "#ff2e97", stroke: INK, strokeWidth: "1.4", strokeLinejoin: "round" })
    ] })
  },
  bell: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 4a8 8 0 0 1 8 8c0 6 2 8 3 9H5c1-1 3-3 3-9a8 8 0 0 1 8-8Z", fill: "#ffcf33", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M13 25a3 3 0 0 0 6 0Z", fill: "#ff8c42", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "4", r: "2", fill: "#ff2e97", stroke: INK, strokeWidth: "1.5" })
    ] })
  },
  bookmark: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M8 4h16v24l-8-6-8 6Z", fill: "#7b2ff7", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M12 4h4v14l-4-3Z", fill: "#bd93ff", stroke: INK, strokeWidth: "1.4", strokeLinejoin: "round" })
    ] })
  },
  download: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 4v14", stroke: INK, strokeWidth: "3", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M9 13l7 7 7-7", fill: "#8bd450", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("rect", { x: "5", y: "24", width: "22", height: "4", rx: "1.5", fill: "#663399", stroke: INK, strokeWidth: "2" })
    ] })
  },
  upload: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 20V6", stroke: INK, strokeWidth: "3", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M9 13l7-7 7 7", fill: "#22d3ee", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("rect", { x: "5", y: "24", width: "22", height: "4", rx: "1.5", fill: "#663399", stroke: INK, strokeWidth: "2" })
    ] })
  },
  link: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M12 20l8-8", stroke: INK, strokeWidth: "3", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M18 8l2-2a5 5 0 0 1 7 7l-3 3a5 5 0 0 1-7 0", fill: "none", stroke: "#ff2e97", strokeWidth: "3", strokeLinecap: "round", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M14 24l-2 2a5 5 0 0 1-7-7l3-3a5 5 0 0 1 7 0", fill: "none", stroke: "#7b2ff7", strokeWidth: "3", strokeLinecap: "round", strokeLinejoin: "round" })
    ] })
  },
  lock: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("rect", { x: "6", y: "14", width: "20", height: "14", rx: "2", fill: "#ffcf33", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M10 14v-3a6 6 0 0 1 12 0v3", fill: "none", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "20", r: "2.4", fill: "#663399", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M16 22v3", stroke: INK, strokeWidth: "2", strokeLinecap: "round" })
    ] })
  },
  key: {
    pixel: true,
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      px(3, 6, "#ffcf33", 6, 6),
      px(3, 6, INK, 6, 1),
      px(3, 11, INK, 6, 1),
      px(3, 7, INK, 1, 4),
      px(8, 7, INK, 1, 4),
      px(5, 8, "#663399", 2, 2),
      px(9, 8, "#ffcf33", 12, 2),
      px(9, 7, INK, 12, 1),
      px(9, 10, INK, 12, 1),
      px(16, 10, "#ffcf33", 2, 3),
      px(19, 10, "#ffcf33", 2, 3)
    ] })
  },
  calendar: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("rect", { x: "4", y: "6", width: "24", height: "22", rx: "2", fill: "#faf5ff", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("rect", { x: "4", y: "6", width: "24", height: "7", rx: "2", fill: "#ff2e97", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M10 3v6M22 3v6", stroke: INK, strokeWidth: "2.5", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("rect", { x: "9", y: "16", width: "4", height: "4", fill: "#22d3ee" }),
      /* @__PURE__ */ jsx("rect", { x: "15", y: "16", width: "4", height: "4", fill: "#8bd450" }),
      /* @__PURE__ */ jsx("rect", { x: "21", y: "16", width: "4", height: "4", fill: "#ffcf33" }),
      /* @__PURE__ */ jsx("rect", { x: "9", y: "22", width: "4", height: "4", fill: "#7b2ff7" })
    ] })
  },
  clock: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "12", fill: "#22d3ee", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "12", fill: "none", stroke: "#fff", strokeWidth: "1", strokeDasharray: "1 3" }),
      /* @__PURE__ */ jsx("path", { d: "M16 16V8M16 16l6 3", stroke: INK, strokeWidth: "2.5", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "1.8", fill: "#ff2e97" })
    ] })
  },
  camera: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("rect", { x: "3", y: "9", width: "26", height: "18", rx: "2", fill: "#5b5470", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M11 9l2-3h6l2 3", fill: "#5b5470", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "18", r: "6", fill: "#22d3ee", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "18", r: "2.5", fill: "#faf5ff", stroke: INK, strokeWidth: "1.2" }),
      /* @__PURE__ */ jsx("rect", { x: "23", y: "12", width: "3", height: "2.5", fill: "#ff2e97" })
    ] })
  },
  music: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M12 22V7l14-3v15", fill: "none", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("ellipse", { cx: "9", cy: "23", rx: "4", ry: "3", fill: "#ff2e97", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("ellipse", { cx: "23", cy: "19", rx: "4", ry: "3", fill: "#7b2ff7", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M12 10l14-3", stroke: INK, strokeWidth: "2" })
    ] })
  },
  globe: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "12", fill: "#22d3ee", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("path", { d: "M16 4v24M4 16h24", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M16 4c5 4 5 20 0 24M16 4c-5 4-5 20 0 24", fill: "none", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M6 11c6 3 14 3 20 0M6 21c6-3 14-3 20 0", fill: "none", stroke: INK, strokeWidth: "1.5" }),
      /* @__PURE__ */ jsx("path", { d: "M9 9l3 2-1 3 3 1M22 20l-3-1 1-3", fill: "#8bd450", stroke: INK, strokeWidth: "1.2", strokeLinejoin: "round" })
    ] })
  },
  rocket: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 3c5 3 8 9 8 15l-4 4h-8l-4-4c0-6 3-12 8-15Z", fill: "#faf5ff", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "13", r: "3.2", fill: "#22d3ee", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M8 20l-4 3 2-7M24 20l4 3-2-7", fill: "#ff2e97", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M12 24c1 3 2 4 4 5 2-1 3-2 4-5Z", fill: "#ff8c42", stroke: INK, strokeWidth: "1.8", strokeLinejoin: "round" })
    ] })
  },
  fire: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 3c1 5 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 2 4 4 1-3 0-6 0-9Z", fill: "#ff8c42", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M16 28a5 5 0 0 0 5-5c0-3-2-4-3-6-1 4-4 3-4 6 0 2-1 2-1 3a3 3 0 0 0 3 2Z", fill: "#ffcf33", stroke: INK, strokeWidth: "1.6", strokeLinejoin: "round" })
    ] })
  },
  gift: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("rect", { x: "4", y: "13", width: "24", height: "15", rx: "1.5", fill: "#ff2e97", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("rect", { x: "3", y: "9", width: "26", height: "5", fill: "#7b2ff7", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("rect", { x: "13", y: "9", width: "6", height: "19", fill: "#ffcf33", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M16 9c-4-6-9-1-4 1 M16 9c4-6 9-1 4 1", fill: "none", stroke: INK, strokeWidth: "2", strokeLinecap: "round" })
    ] })
  },
  flag: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M8 4v25", stroke: INK, strokeWidth: "3", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M8 5h16l-3 5 3 5H8Z", fill: "#ff2e97", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "10", r: "1.8", fill: "#ffcf33" })
    ] })
  },
  cloud: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M9 24a6 6 0 0 1-1-11.9A8 8 0 0 1 23 11a5.5 5.5 0 0 1 0 13Z", fill: "#22d3ee", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M11 13a4 4 0 0 1 5-2", fill: "none", stroke: "#fff", strokeWidth: "1.8", strokeLinecap: "round" })
    ] })
  },
  sun: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "7", fill: "#ffcf33", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("path", { d: "M16 2v4M16 26v4M2 16h4M26 16h4M6 6l3 3M23 23l3 3M26 6l-3 3M9 23l-3 3", stroke: INK, strokeWidth: "2.5", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "3", fill: "#ff8c42" })
    ] })
  },
  moon: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M23 21A11 11 0 0 1 11 5a11 11 0 1 0 12 16Z", fill: "#7b2ff7", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "22", cy: "8", r: "1.6", fill: "#ffcf33" }),
      /* @__PURE__ */ jsx("circle", { cx: "26", cy: "13", r: "1.1", fill: "#ffcf33" }),
      /* @__PURE__ */ jsx("circle", { cx: "14", cy: "4", r: "1.1", fill: "#ffcf33" })
    ] })
  },
  phone: {
    el: /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("path", { d: "M8 4l5 1 2 6-3 3a14 14 0 0 0 6 6l3-3 6 2 1 5c0 2-1 3-3 3C15 27 5 17 5 7c0-2 1-3 3-3Z", fill: "#8bd450", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }) })
  },
  chat: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M4 7a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H12l-6 5v-5H6a2 2 0 0 1-2-2Z", fill: "#bd93ff", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "11", cy: "13", r: "1.8", fill: INK }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "13", r: "1.8", fill: INK }),
      /* @__PURE__ */ jsx("circle", { cx: "21", cy: "13", r: "1.8", fill: INK })
    ] })
  },
  cart: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M3 5h4l3 15h14l3-10H9", fill: "none", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M10 10h16l-2.5 8h-12Z", fill: "#ff2e97", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "12", cy: "26", r: "2.5", fill: "#663399", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("circle", { cx: "22", cy: "26", r: "2.5", fill: "#663399", stroke: INK, strokeWidth: "2" })
    ] })
  },
  pencil: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M22 4l6 6-16 16-8 2 2-8Z", fill: "#ffcf33", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M20 6l6 6", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M6 20l6 6", stroke: INK, strokeWidth: "2" }),
      /* @__PURE__ */ jsx("path", { d: "M22 4l6 6-3 3-6-6Z", fill: "#ff2e97", stroke: INK, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M4 28l2-6 4 4Z", fill: INK })
    ] })
  },
  construction: {
    pixel: true,
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      px(3, 11, "#ffcf33", 10, 6),
      px(3, 11, INK, 10, 1),
      px(3, 16, INK, 10, 1),
      px(3, 12, INK, 1, 4),
      px(12, 12, INK, 1, 4),
      px(4, 12, "#1c1030", 2, 4),
      px(7, 12, "#1c1030", 2, 4),
      px(10, 12, "#1c1030", 2, 4),
      px(2, 17, INK, 1, 6),
      px(13, 17, INK, 1, 6)
    ] })
  },
  check: {
    el: /* @__PURE__ */ jsx("path", { d: "M5 17l7 7L27 8", fill: "none", stroke: "#5a9e2a", strokeWidth: "5", strokeLinecap: "round", strokeLinejoin: "round" })
  },
  close: {
    el: /* @__PURE__ */ jsx("path", { d: "M7 7l18 18M25 7 7 25", stroke: "#c9186e", strokeWidth: "5", strokeLinecap: "round" })
  },
  plus: {
    el: /* @__PURE__ */ jsx("path", { d: "M16 5v22M5 16h22", stroke: "#7b2ff7", strokeWidth: "5", strokeLinecap: "round" })
  },
  warning: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("path", { d: "M16 3 30 27H2Z", fill: "#ffcf33", stroke: INK, strokeWidth: "2.5", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsx("path", { d: "M16 11v8", stroke: INK, strokeWidth: "3", strokeLinecap: "round" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "23", r: "1.8", fill: INK })
    ] })
  },
  info: {
    el: /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "16", r: "13", fill: "#3b82f6", stroke: INK, strokeWidth: "2.5" }),
      /* @__PURE__ */ jsx("circle", { cx: "16", cy: "10", r: "2", fill: "#fff" }),
      /* @__PURE__ */ jsx("path", { d: "M16 15v9", stroke: "#fff", strokeWidth: "3.5", strokeLinecap: "round" })
    ] })
  }
};
var iconNames = Object.keys(glyphs);

// src/components/Icon/Icon.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function Icon({ name, size = 24, title, className, ...rest }) {
  const glyph = glyphs[name];
  const decorative = !title;
  return /* @__PURE__ */ jsxs2(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 32 32",
      width: size,
      height: size,
      className: ["rp-icon", glyph.pixel ? "rp-icon--pixel" : "", className].filter(Boolean).join(" "),
      role: decorative ? void 0 : "img",
      "aria-hidden": decorative || void 0,
      "aria-label": title,
      shapeRendering: glyph.pixel ? "crispEdges" : void 0,
      ...rest,
      children: [
        title ? /* @__PURE__ */ jsx2("title", { children: title }) : null,
        glyph.el
      ]
    }
  );
}

// src/components/Button/Button.tsx
import * as React from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var Button = React.forwardRef(function Button2({ variant = "primary", size = "md", icon, block, className, children, type = "button", ...rest }, ref) {
  return /* @__PURE__ */ jsxs3(
    "button",
    {
      ref,
      type,
      className: [
        "rp-btn",
        `rp-btn--${variant}`,
        `rp-btn--${size}`,
        block ? "rp-btn--block" : "",
        className
      ].filter(Boolean).join(" "),
      ...rest,
      children: [
        icon ? /* @__PURE__ */ jsx3(Icon, { name: icon, size: size === "lg" ? 22 : size === "sm" ? 16 : 18 }) : null,
        children != null ? /* @__PURE__ */ jsx3("span", { className: "rp-btn__label", children }) : null
      ]
    }
  );
});

// src/components/IconButton/IconButton.tsx
import * as React2 from "react";
import { jsx as jsx4 } from "react/jsx-runtime";
var IconButton = React2.forwardRef(function IconButton2({ icon, label, variant = "secondary", size = "md", className, type = "button", ...rest }, ref) {
  return /* @__PURE__ */ jsx4(
    "button",
    {
      ref,
      type,
      "aria-label": label,
      title: label,
      className: ["rp-btn", "rp-iconbtn", `rp-btn--${variant}`, `rp-iconbtn--${size}`, className].filter(Boolean).join(" "),
      ...rest,
      children: /* @__PURE__ */ jsx4(Icon, { name: icon, size: size === "lg" ? 26 : size === "sm" ? 16 : 20 })
    }
  );
});

// src/components/Input/Input.tsx
import * as React3 from "react";
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
var uid = 0;
var useId = (given) => {
  const [id] = React3.useState(() => given ?? `rp-input-${++uid}`);
  return given ?? id;
};
var Input = React3.forwardRef(function Input2({ label, hint, error, icon, id, className, ...rest }, ref) {
  const inputId = useId(id);
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : void 0;
  return /* @__PURE__ */ jsxs4("div", { className: ["rp-field", error ? "rp-field--error" : "", className].filter(Boolean).join(" "), children: [
    label ? /* @__PURE__ */ jsx5("label", { className: "rp-field__label", htmlFor: inputId, children: label }) : null,
    /* @__PURE__ */ jsxs4("div", { className: "rp-field__well rp-bevel-sunken", children: [
      icon ? /* @__PURE__ */ jsx5(Icon, { name: icon, size: 18, className: "rp-field__icon" }) : null,
      /* @__PURE__ */ jsx5(
        "input",
        {
          ref,
          id: inputId,
          className: "rp-field__input",
          "aria-invalid": error ? true : void 0,
          "aria-describedby": describedBy,
          ...rest
        }
      )
    ] }),
    error ? /* @__PURE__ */ jsxs4("p", { className: "rp-field__msg rp-field__msg--error", id: `${inputId}-err`, children: [
      /* @__PURE__ */ jsx5(Icon, { name: "warning", size: 14 }),
      " ",
      error
    ] }) : hint ? /* @__PURE__ */ jsx5("p", { className: "rp-field__msg", id: `${inputId}-hint`, children: hint }) : null
  ] });
});

// src/components/Textarea/Textarea.tsx
import * as React4 from "react";
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var uid2 = 0;
var Textarea = React4.forwardRef(function Textarea2({ label, hint, error, id, className, rows = 4, ...rest }, ref) {
  const [auto] = React4.useState(() => id ?? `rp-textarea-${++uid2}`);
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : void 0;
  return /* @__PURE__ */ jsxs5("div", { className: ["rp-field", error ? "rp-field--error" : "", className].filter(Boolean).join(" "), children: [
    label ? /* @__PURE__ */ jsx6("label", { className: "rp-field__label", htmlFor: inputId, children: label }) : null,
    /* @__PURE__ */ jsx6("div", { className: "rp-field__well rp-bevel-sunken rp-field__well--area", children: /* @__PURE__ */ jsx6(
      "textarea",
      {
        ref,
        id: inputId,
        rows,
        className: "rp-field__input rp-field__input--area",
        "aria-invalid": error ? true : void 0,
        "aria-describedby": describedBy,
        ...rest
      }
    ) }),
    error ? /* @__PURE__ */ jsx6("p", { className: "rp-field__msg rp-field__msg--error", id: `${inputId}-err`, children: error }) : hint ? /* @__PURE__ */ jsx6("p", { className: "rp-field__msg", id: `${inputId}-hint`, children: hint }) : null
  ] });
});

// src/components/Checkbox/Checkbox.tsx
import * as React5 from "react";
import { jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
var Checkbox = React5.forwardRef(function Checkbox2({ label, className, disabled, ...rest }, ref) {
  return /* @__PURE__ */ jsxs6("label", { className: ["rp-check", disabled ? "rp-check--disabled" : "", className].filter(Boolean).join(" "), children: [
    /* @__PURE__ */ jsx7("input", { ref, type: "checkbox", className: "rp-check__input", disabled, ...rest }),
    /* @__PURE__ */ jsx7("span", { className: "rp-check__box rp-bevel-sunken", children: /* @__PURE__ */ jsx7(Icon, { name: "check", size: 16, className: "rp-check__tick" }) }),
    label != null ? /* @__PURE__ */ jsx7("span", { className: "rp-check__label", children: label }) : null
  ] });
});

// src/components/Switch/Switch.tsx
import * as React6 from "react";
import { jsx as jsx8, jsxs as jsxs7 } from "react/jsx-runtime";
var Switch = React6.forwardRef(function Switch2({ label, className, disabled, ...rest }, ref) {
  return /* @__PURE__ */ jsxs7("label", { className: ["rp-switch", disabled ? "rp-switch--disabled" : "", className].filter(Boolean).join(" "), children: [
    /* @__PURE__ */ jsx8("input", { ref, type: "checkbox", role: "switch", className: "rp-switch__input", disabled, ...rest }),
    /* @__PURE__ */ jsxs7("span", { className: "rp-switch__track", children: [
      /* @__PURE__ */ jsx8("span", { className: "rp-switch__thumb rp-bevel-raised" }),
      /* @__PURE__ */ jsx8("span", { className: "rp-switch__on", children: "ON" }),
      /* @__PURE__ */ jsx8("span", { className: "rp-switch__off", children: "OFF" })
    ] }),
    label != null ? /* @__PURE__ */ jsx8("span", { className: "rp-switch__label", children: label }) : null
  ] });
});

// src/components/RadioGroup/RadioGroup.tsx
import * as React7 from "react";
import { jsx as jsx9, jsxs as jsxs8 } from "react/jsx-runtime";
var gid = 0;
function RadioGroup({ label, options, value, defaultValue, onChange, name, className }) {
  const [nm] = React7.useState(() => name ?? `rp-radio-${++gid}`);
  const [internal, setInternal] = React7.useState(defaultValue);
  const selected = value !== void 0 ? value : internal;
  return /* @__PURE__ */ jsxs8("fieldset", { className: ["rp-radios", className].filter(Boolean).join(" "), children: [
    label ? /* @__PURE__ */ jsx9("legend", { className: "rp-radios__legend", children: label }) : null,
    options.map((opt) => /* @__PURE__ */ jsxs8(
      "label",
      {
        className: ["rp-radio", opt.disabled ? "rp-radio--disabled" : ""].filter(Boolean).join(" "),
        children: [
          /* @__PURE__ */ jsx9(
            "input",
            {
              type: "radio",
              name: name ?? nm,
              value: opt.value,
              checked: selected === opt.value,
              disabled: opt.disabled,
              onChange: () => {
                if (value === void 0) setInternal(opt.value);
                onChange?.(opt.value);
              },
              className: "rp-radio__input"
            }
          ),
          /* @__PURE__ */ jsx9("span", { className: "rp-radio__dot rp-bevel-sunken" }),
          /* @__PURE__ */ jsx9("span", { className: "rp-radio__label", children: opt.label })
        ]
      },
      opt.value
    ))
  ] });
}

// src/components/Select/Select.tsx
import * as React8 from "react";
import { jsx as jsx10, jsxs as jsxs9 } from "react/jsx-runtime";
var uid3 = 0;
var Select = React8.forwardRef(function Select2({ label, hint, options, placeholder, id, className, value, defaultValue, ...rest }, ref) {
  const [auto] = React8.useState(() => id ?? `rp-select-${++uid3}`);
  const selectId = id ?? auto;
  return /* @__PURE__ */ jsxs9("div", { className: ["rp-field", "rp-select", className].filter(Boolean).join(" "), children: [
    label ? /* @__PURE__ */ jsx10("label", { className: "rp-field__label", htmlFor: selectId, children: label }) : null,
    /* @__PURE__ */ jsxs9("div", { className: "rp-select__well rp-bevel-raised", children: [
      /* @__PURE__ */ jsxs9(
        "select",
        {
          ref,
          id: selectId,
          className: "rp-select__native",
          value,
          defaultValue: defaultValue ?? (placeholder && value === void 0 ? "" : void 0),
          ...rest,
          children: [
            placeholder ? /* @__PURE__ */ jsx10("option", { value: "", disabled: true, children: placeholder }) : null,
            options.map((o) => /* @__PURE__ */ jsx10("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value))
          ]
        }
      ),
      /* @__PURE__ */ jsx10("span", { className: "rp-select__arrow rp-chrome rp-bevel-raised", children: /* @__PURE__ */ jsx10(Icon, { name: "download", size: 16 }) })
    ] }),
    hint ? /* @__PURE__ */ jsx10("p", { className: "rp-field__msg", children: hint }) : null
  ] });
});

// src/components/Badge/Badge.tsx
import { jsx as jsx11 } from "react/jsx-runtime";
function Badge({ tone = "violet", blink, className, children, ...rest }) {
  return /* @__PURE__ */ jsx11(
    "span",
    {
      className: ["rp-badge", `rp-badge--${tone}`, blink ? "rp-badge--new" : "", className].filter(Boolean).join(" "),
      ...rest,
      children
    }
  );
}

// src/components/Tag/Tag.tsx
import { jsx as jsx12, jsxs as jsxs10 } from "react/jsx-runtime";
function Tag({ tone = "violet", icon, onRemove, className, children, ...rest }) {
  return /* @__PURE__ */ jsxs10("span", { className: ["rp-tag", `rp-tag--${tone}`, className].filter(Boolean).join(" "), ...rest, children: [
    icon ? /* @__PURE__ */ jsx12(Icon, { name: icon, size: 14 }) : null,
    /* @__PURE__ */ jsx12("span", { className: "rp-tag__label", children }),
    onRemove ? /* @__PURE__ */ jsx12("button", { type: "button", className: "rp-tag__x", "aria-label": "Remove", onClick: onRemove, children: /* @__PURE__ */ jsx12(Icon, { name: "close", size: 12 }) }) : null
  ] });
}

// src/components/Avatar/Avatar.tsx
import { jsx as jsx13, jsxs as jsxs11 } from "react/jsx-runtime";
var initialsOf = (name) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
function Avatar({ src, name, size = "md", online, className, ...rest }) {
  const initials = initialsOf(name);
  return /* @__PURE__ */ jsxs11(
    "span",
    {
      className: ["rp-avatar", `rp-avatar--${size}`, "rp-bevel-raised", className].filter(Boolean).join(" "),
      role: "img",
      "aria-label": name || "avatar",
      ...rest,
      children: [
        src ? /* @__PURE__ */ jsx13("img", { className: "rp-avatar__img", src, alt: name || "" }) : initials ? /* @__PURE__ */ jsx13("span", { className: "rp-avatar__initials", children: initials }) : /* @__PURE__ */ jsx13(Icon, { name: "user", size: size === "lg" ? 34 : size === "sm" ? 18 : 24 }),
        online ? /* @__PURE__ */ jsx13("span", { className: "rp-avatar__dot", "aria-hidden": true }) : null
      ]
    }
  );
}

// src/components/Table/Table.tsx
import { jsx as jsx14, jsxs as jsxs12 } from "react/jsx-runtime";
function Table({
  columns,
  data,
  caption,
  zebra = true,
  className,
  ...rest
}) {
  return /* @__PURE__ */ jsx14("div", { className: "rp-table__frame rp-bevel-raised", children: /* @__PURE__ */ jsxs12("table", { className: ["rp-table", zebra ? "rp-table--zebra" : "", className].filter(Boolean).join(" "), ...rest, children: [
    caption != null ? /* @__PURE__ */ jsx14("caption", { className: "rp-table__caption", children: caption }) : null,
    /* @__PURE__ */ jsx14("thead", { children: /* @__PURE__ */ jsx14("tr", { children: columns.map((c) => /* @__PURE__ */ jsx14("th", { style: { textAlign: c.align ?? "left" }, scope: "col", children: c.header }, c.key)) }) }),
    /* @__PURE__ */ jsx14("tbody", { children: data.map((row, i) => /* @__PURE__ */ jsx14("tr", { children: columns.map((c) => /* @__PURE__ */ jsx14("td", { style: { textAlign: c.align ?? "left" }, children: c.render ? c.render(row) : row[c.key] }, c.key)) }, i)) })
  ] }) });
}

// src/components/HitCounter/HitCounter.tsx
import { jsx as jsx15, jsxs as jsxs13 } from "react/jsx-runtime";
function HitCounter({ count, digits = 6, label = "visitors", className, ...rest }) {
  const str = Math.max(0, Math.floor(count)).toString().padStart(digits, "0");
  return /* @__PURE__ */ jsxs13("div", { className: ["rp-counter", className].filter(Boolean).join(" "), ...rest, children: [
    /* @__PURE__ */ jsx15("div", { className: "rp-counter__digits rp-bevel-sunken", "aria-label": `${count} ${typeof label === "string" ? label : ""}`, children: str.split("").map((d, i) => /* @__PURE__ */ jsx15("span", { className: "rp-counter__digit", children: d }, i)) }),
    label != null ? /* @__PURE__ */ jsx15("span", { className: "rp-counter__label", children: label }) : null
  ] });
}

// src/components/Card/Card.tsx
import { jsx as jsx16, jsxs as jsxs14 } from "react/jsx-runtime";
function Card({ title, icon, tone = "violet", footer, className, children, ...rest }) {
  return /* @__PURE__ */ jsxs14("div", { className: ["rp-card", className].filter(Boolean).join(" "), ...rest, children: [
    title != null ? /* @__PURE__ */ jsxs14("div", { className: `rp-card__header rp-card__header--${tone}`, children: [
      icon ? /* @__PURE__ */ jsx16(Icon, { name: icon, size: 20 }) : null,
      /* @__PURE__ */ jsx16("span", { className: "rp-card__title", children: title })
    ] }) : null,
    /* @__PURE__ */ jsx16("div", { className: "rp-card__body", children }),
    footer != null ? /* @__PURE__ */ jsx16("div", { className: "rp-card__footer", children: footer }) : null
  ] });
}

// src/components/Window/Window.tsx
import { jsx as jsx17, jsxs as jsxs15 } from "react/jsx-runtime";
function Window({
  title,
  icon,
  active = true,
  controls = true,
  onClose,
  status,
  className,
  children,
  ...rest
}) {
  return /* @__PURE__ */ jsxs15(
    "div",
    {
      className: ["rp-window", "rp-chrome", "rp-bevel-raised", className].filter(Boolean).join(" "),
      ...rest,
      children: [
        /* @__PURE__ */ jsxs15("div", { className: ["rp-window__bar", active ? "rp-window__bar--active" : ""].filter(Boolean).join(" "), children: [
          icon ? /* @__PURE__ */ jsx17(Icon, { name: icon, size: 18 }) : null,
          /* @__PURE__ */ jsx17("span", { className: "rp-window__title", children: title }),
          controls ? /* @__PURE__ */ jsxs15("span", { className: "rp-window__controls", children: [
            /* @__PURE__ */ jsx17("button", { type: "button", className: "rp-window__cap rp-bevel-raised", "aria-label": "Minimize", children: "_" }),
            /* @__PURE__ */ jsx17("button", { type: "button", className: "rp-window__cap rp-bevel-raised", "aria-label": "Maximize", children: "\u25A1" }),
            /* @__PURE__ */ jsx17(
              "button",
              {
                type: "button",
                className: "rp-window__cap rp-window__cap--close rp-bevel-raised",
                "aria-label": "Close",
                onClick: onClose,
                children: "\xD7"
              }
            )
          ] }) : null
        ] }),
        /* @__PURE__ */ jsx17("div", { className: "rp-window__body", children }),
        status != null ? /* @__PURE__ */ jsx17("div", { className: "rp-window__status rp-bevel-sunken", children: status }) : null
      ]
    }
  );
}

// src/components/Alert/Alert.tsx
import { jsx as jsx18, jsxs as jsxs16 } from "react/jsx-runtime";
var toneIcon = {
  info: "info",
  success: "check",
  warning: "warning",
  danger: "fire"
};
function Alert({ tone = "info", title, icon, onClose, className, children, ...rest }) {
  return /* @__PURE__ */ jsxs16("div", { role: "alert", className: ["rp-alert", `rp-alert--${tone}`, className].filter(Boolean).join(" "), ...rest, children: [
    /* @__PURE__ */ jsx18("span", { className: "rp-alert__icon", children: /* @__PURE__ */ jsx18(Icon, { name: icon ?? toneIcon[tone], size: 26 }) }),
    /* @__PURE__ */ jsxs16("div", { className: "rp-alert__content", children: [
      title != null ? /* @__PURE__ */ jsx18("p", { className: "rp-alert__title", children: title }) : null,
      children != null ? /* @__PURE__ */ jsx18("div", { className: "rp-alert__body", children }) : null
    ] }),
    onClose ? /* @__PURE__ */ jsx18("button", { type: "button", className: "rp-alert__close", "aria-label": "Dismiss", onClick: onClose, children: /* @__PURE__ */ jsx18(Icon, { name: "close", size: 16 }) }) : null
  ] });
}

// src/components/Toast/Toast.tsx
import { jsx as jsx19, jsxs as jsxs17 } from "react/jsx-runtime";
var toneIcon2 = {
  info: "bell",
  success: "check",
  warning: "warning",
  danger: "fire"
};
function Toast({ tone = "info", title, icon, onClose, className, children, ...rest }) {
  return /* @__PURE__ */ jsxs17("div", { className: ["rp-toast", `rp-toast--${tone}`, className].filter(Boolean).join(" "), role: "status", ...rest, children: [
    /* @__PURE__ */ jsx19("span", { className: "rp-toast__icon", children: /* @__PURE__ */ jsx19(Icon, { name: icon ?? toneIcon2[tone], size: 24 }) }),
    /* @__PURE__ */ jsxs17("div", { className: "rp-toast__content", children: [
      /* @__PURE__ */ jsx19("p", { className: "rp-toast__title", children: title }),
      children != null ? /* @__PURE__ */ jsx19("div", { className: "rp-toast__body", children }) : null
    ] }),
    onClose ? /* @__PURE__ */ jsx19("button", { type: "button", className: "rp-toast__close", "aria-label": "Dismiss", onClick: onClose, children: /* @__PURE__ */ jsx19(Icon, { name: "close", size: 14 }) }) : null
  ] });
}

// src/components/Progress/Progress.tsx
import { jsx as jsx20, jsxs as jsxs18 } from "react/jsx-runtime";
function Progress({
  value,
  tone = "violet",
  showValue,
  segmented = true,
  className,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value));
  return /* @__PURE__ */ jsxs18(
    "div",
    {
      className: ["rp-progress", "rp-bevel-sunken", className].filter(Boolean).join(" "),
      role: "progressbar",
      "aria-valuenow": pct,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      ...rest,
      children: [
        /* @__PURE__ */ jsx20(
          "div",
          {
            className: [
              "rp-progress__fill",
              `rp-progress__fill--${tone}`,
              segmented ? "rp-progress__fill--segmented" : ""
            ].filter(Boolean).join(" "),
            style: { width: `${pct}%` }
          }
        ),
        showValue ? /* @__PURE__ */ jsxs18("span", { className: "rp-progress__value", children: [
          Math.round(pct),
          "%"
        ] }) : null
      ]
    }
  );
}

// src/components/Tooltip/Tooltip.tsx
import { jsx as jsx21, jsxs as jsxs19 } from "react/jsx-runtime";
function Tooltip({ content, side = "top", children }) {
  return /* @__PURE__ */ jsxs19("span", { className: `rp-tooltip rp-tooltip--${side}`, children: [
    children,
    /* @__PURE__ */ jsx21("span", { className: "rp-tooltip__bubble", role: "tooltip", children: content })
  ] });
}

// src/components/Dialog/Dialog.tsx
import * as React9 from "react";
import { jsx as jsx22, jsxs as jsxs20 } from "react/jsx-runtime";
function Dialog({ open, title, icon, onClose, footer, children }) {
  React9.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return /* @__PURE__ */ jsx22("div", { className: "rp-dialog__overlay", onClick: onClose, children: /* @__PURE__ */ jsxs20(
    "div",
    {
      className: "rp-dialog rp-chrome rp-bevel-raised",
      role: "dialog",
      "aria-modal": "true",
      onClick: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs20("div", { className: "rp-dialog__bar", children: [
          icon ? /* @__PURE__ */ jsx22(Icon, { name: icon, size: 18 }) : null,
          /* @__PURE__ */ jsx22("span", { className: "rp-dialog__title", children: title }),
          /* @__PURE__ */ jsx22("button", { type: "button", className: "rp-dialog__close rp-bevel-raised", "aria-label": "Close", onClick: onClose, children: "\xD7" })
        ] }),
        /* @__PURE__ */ jsx22("div", { className: "rp-dialog__body", children }),
        footer != null ? /* @__PURE__ */ jsx22("div", { className: "rp-dialog__footer", children: footer }) : null
      ]
    }
  ) });
}

// src/components/Tabs/Tabs.tsx
import * as React10 from "react";
import { jsx as jsx23, jsxs as jsxs21 } from "react/jsx-runtime";
function Tabs({ tabs, value, defaultValue, onChange, className, ...rest }) {
  const [internal, setInternal] = React10.useState(defaultValue ?? tabs[0]?.id);
  const active = value !== void 0 ? value : internal;
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  const select = (id) => {
    if (value === void 0) setInternal(id);
    onChange?.(id);
  };
  return /* @__PURE__ */ jsxs21("div", { className: ["rp-tabs", className].filter(Boolean).join(" "), ...rest, children: [
    /* @__PURE__ */ jsx23("div", { className: "rp-tabs__list", role: "tablist", children: tabs.map((t) => /* @__PURE__ */ jsxs21(
      "button",
      {
        role: "tab",
        type: "button",
        "aria-selected": t.id === active,
        disabled: t.disabled,
        className: ["rp-tabs__tab", t.id === active ? "rp-tabs__tab--active" : ""].filter(Boolean).join(" "),
        onClick: () => select(t.id),
        children: [
          t.icon ? /* @__PURE__ */ jsx23(Icon, { name: t.icon, size: 16 }) : null,
          t.label
        ]
      },
      t.id
    )) }),
    /* @__PURE__ */ jsx23("div", { className: "rp-tabs__panel", role: "tabpanel", children: activeTab?.content })
  ] });
}

// src/components/Menu/Menu.tsx
import * as React11 from "react";
import { jsx as jsx24, jsxs as jsxs22 } from "react/jsx-runtime";
function Menu({ label, icon, items, defaultOpen = false, className }) {
  const [open, setOpen] = React11.useState(defaultOpen);
  const ref = React11.useRef(null);
  React11.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return /* @__PURE__ */ jsxs22("div", { className: ["rp-menu", className].filter(Boolean).join(" "), ref, children: [
    /* @__PURE__ */ jsxs22(
      "button",
      {
        type: "button",
        className: "rp-btn rp-btn--secondary rp-btn--md rp-menu__trigger",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((o) => !o),
        children: [
          icon ? /* @__PURE__ */ jsx24(Icon, { name: icon, size: 18 }) : null,
          label,
          /* @__PURE__ */ jsx24("span", { className: "rp-menu__caret", children: "\u25BE" })
        ]
      }
    ),
    open ? /* @__PURE__ */ jsx24("div", { className: "rp-menu__panel rp-chrome rp-bevel-raised", role: "menu", children: items.map(
      (it, i) => it.divider ? /* @__PURE__ */ jsx24("div", { className: "rp-menu__divider", role: "separator" }, i) : /* @__PURE__ */ jsxs22(
        "button",
        {
          type: "button",
          role: "menuitem",
          disabled: it.disabled,
          className: ["rp-menu__item", it.danger ? "rp-menu__item--danger" : ""].filter(Boolean).join(" "),
          onClick: () => {
            it.onSelect?.();
            setOpen(false);
          },
          children: [
            it.icon ? /* @__PURE__ */ jsx24(Icon, { name: it.icon, size: 16 }) : /* @__PURE__ */ jsx24("span", { className: "rp-menu__spacer" }),
            it.label
          ]
        },
        i
      )
    ) }) : null
  ] });
}

// src/components/Accordion/Accordion.tsx
import * as React12 from "react";
import { jsx as jsx25, jsxs as jsxs23 } from "react/jsx-runtime";
function Accordion({ items, allowMultiple = false, defaultOpen = [], className, ...rest }) {
  const [open, setOpen] = React12.useState(defaultOpen);
  const toggle = (id) => setOpen(
    (cur) => cur.includes(id) ? cur.filter((x) => x !== id) : allowMultiple ? [...cur, id] : [id]
  );
  return /* @__PURE__ */ jsx25("div", { className: ["rp-accordion", className].filter(Boolean).join(" "), ...rest, children: items.map((it) => {
    const isOpen = open.includes(it.id);
    return /* @__PURE__ */ jsxs23("div", { className: ["rp-accordion__item", isOpen ? "is-open" : ""].filter(Boolean).join(" "), children: [
      /* @__PURE__ */ jsxs23(
        "button",
        {
          type: "button",
          className: "rp-accordion__head",
          "aria-expanded": isOpen,
          onClick: () => toggle(it.id),
          children: [
            it.icon ? /* @__PURE__ */ jsx25(Icon, { name: it.icon, size: 18 }) : null,
            /* @__PURE__ */ jsx25("span", { className: "rp-accordion__title", children: it.title }),
            /* @__PURE__ */ jsx25("span", { className: "rp-accordion__chevron", children: isOpen ? "\u25BC" : "\u25B6" })
          ]
        }
      ),
      isOpen ? /* @__PURE__ */ jsx25("div", { className: "rp-accordion__panel", children: it.content }) : null
    ] }, it.id);
  }) });
}

// src/components/Divider/Divider.tsx
import { jsx as jsx26, jsxs as jsxs24 } from "react/jsx-runtime";
function Divider({ variant = "rainbow", label, className, ...rest }) {
  if (label != null) {
    return /* @__PURE__ */ jsxs24("div", { className: ["rp-divider-wrap", className].filter(Boolean).join(" "), ...rest, children: [
      /* @__PURE__ */ jsx26("span", { className: `rp-divider rp-divider--${variant}` }),
      /* @__PURE__ */ jsx26("span", { className: "rp-divider__label", children: label }),
      /* @__PURE__ */ jsx26("span", { className: `rp-divider rp-divider--${variant}` })
    ] });
  }
  return /* @__PURE__ */ jsx26(
    "hr",
    {
      className: ["rp-divider", `rp-divider--${variant}`, className].filter(Boolean).join(" "),
      ...rest
    }
  );
}

// src/components/HyperLink/HyperLink.tsx
import * as React13 from "react";
import { jsx as jsx27, jsxs as jsxs25 } from "react/jsx-runtime";
var HyperLink = React13.forwardRef(function HyperLink2({ visited, external, className, children, target, rel, ...rest }, ref) {
  return /* @__PURE__ */ jsxs25(
    "a",
    {
      ref,
      className: ["rp-link", visited ? "rp-link--visited" : "", className].filter(Boolean).join(" "),
      target: external ? target ?? "_blank" : target,
      rel: external ? rel ?? "noopener noreferrer" : rel,
      ...rest,
      children: [
        children,
        external ? /* @__PURE__ */ jsx27(Icon, { name: "globe", size: 13, className: "rp-link__ext" }) : null
      ]
    }
  );
});

// src/components/Marquee/Marquee.tsx
import { jsx as jsx28, jsxs as jsxs26 } from "react/jsx-runtime";
function Marquee({
  speed = 12,
  direction = "left",
  pauseOnHover = true,
  className,
  children,
  ...rest
}) {
  return /* @__PURE__ */ jsx28(
    "div",
    {
      className: [
        "rp-marquee",
        pauseOnHover ? "rp-marquee--pause" : "",
        direction === "right" ? "rp-marquee--rtl" : "",
        className
      ].filter(Boolean).join(" "),
      ...rest,
      children: /* @__PURE__ */ jsxs26("div", { className: "rp-marquee__track", style: { animationDuration: `${speed}s` }, children: [
        /* @__PURE__ */ jsx28("span", { className: "rp-marquee__item", children }),
        /* @__PURE__ */ jsx28("span", { className: "rp-marquee__item", "aria-hidden": true, children })
      ] })
    }
  );
}
export {
  Accordion,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Divider,
  HitCounter,
  HyperLink,
  Icon,
  IconButton,
  Input,
  Marquee,
  Menu,
  Progress,
  RadioGroup,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Textarea,
  Toast,
  Tooltip,
  Window,
  iconNames
};
