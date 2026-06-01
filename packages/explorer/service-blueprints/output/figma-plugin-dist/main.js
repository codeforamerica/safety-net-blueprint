"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // service-blueprints/src/figma-plugin/src/_current_card_types.json
  var current_card_types_default = { types: { "staff-action": { headerBg: "#2B1A78", bodyBg: "#EEEBFF", headerFg: "#FFFFFF", bodyFg: "#1A1040", label: "STAFF ACTION", icon: "person-single" }, "person-action": { headerBg: "#2B1A78", bodyBg: "#EEEBFF", headerFg: "#FFFFFF", bodyFg: "#1A1040", label: "PERSON", icon: "person-single" }, system: { headerBg: "#137C69", bodyBg: "#F1FFFD", headerFg: "#FFFFFF", bodyFg: "#0A3A2E", label: "SYSTEM", icon: "gear" }, "data-entity": { headerBg: "#154C21", bodyBg: "#E3F5E1", headerFg: "#FFFFFF", bodyFg: "#0A2E1E", label: "DATA", icon: "document" }, communications: { headerBg: "#2672DE", bodyBg: "#EDF5FF", headerFg: "#FFFFFF", bodyFg: "#0A1E40", label: "COMMUNICATIONS", icon: "mail" }, "domain-event": { headerBg: "#2E6276", bodyBg: "#E7F2F5", headerFg: "#FFFFFF", bodyFg: "#0A2E34", label: "EVENT", icon: "lightning" }, "pain-point": { headerBg: "#EB646B", bodyBg: "#F9E9EA", headerFg: "#1A0000", bodyFg: "#2A0A0A", label: "PAIN POINT", icon: "diamond-alert" }, opportunity: { headerBg: "#FDAF49", bodyBg: "#FEF1DD", headerFg: "#3D2800", bodyFg: "#3D2800", label: "OPPORTUNITY", icon: "lightbulb" }, note: { headerBg: "#FDDA40", bodyBg: "#FFFBE7", headerFg: "#333333", bodyFg: "#555555", label: "" }, policy: { rendersAs: "question", headerBg: "#EDD7CD", bodyBg: "#F8F6F5", headerFg: "#3D2B0E", bodyFg: "#3D2B0E", label: "POLICY", icon: "building" }, metrics: { headerBg: "#B9E5DF", bodyBg: "#F1FFFD", headerFg: "#1A3A36", bodyFg: "#1A3A36", label: "METRICS", icon: "bar-chart" }, question: { headerBg: "#686868", bodyBg: "#E3E3E3", headerFg: "#FFFFFF", bodyFg: "#1A1A1A", label: "QUESTION", icon: "help" }, touchpoint: { headerBg: "#434343", bodyBg: "#F1F1F1", headerFg: "#FFFFFF", bodyFg: "#1A1A1A", label: "TOUCHPOINT", icon: "diamond" } }, actors: { applicant: { headerBg: "#D97C20", bodyBg: "#FDECD4", headerFg: "#3D1800", bodyFg: "#3D1800", label: "APPLICANT", icon: "person-single" }, caseworker: { headerBg: "#2B1A78", bodyBg: "#EEEBFF", headerFg: "#FFFFFF", bodyFg: "#1A1040", label: "CASEWORKER", icon: "person-single" }, supervisor: { headerBg: "#4F41B2", bodyBg: "#EEEBFF", headerFg: "#FFFFFF", bodyFg: "#1A1040", label: "SUPERVISOR", icon: "person-group" }, system: { headerBg: "#137C69", bodyBg: "#F1FFFD", headerFg: "#FFFFFF", bodyFg: "#0A3A2E", label: "SYSTEM", icon: "gear" } } };

  // service-blueprints/src/figma-plugin/src/renderer.ts
  var PHASE_WIDTH = 280;
  var LANE_LABEL_WIDTH = 120;
  var HEADER_HEIGHT = 72;
  var PHASE_HEADER_H = 30;
  var CELL_PADDING = 12;
  var CARD_WIDTH = PHASE_WIDTH - CELL_PADDING * 2;
  var CARD_PADDING = 14;
  var CARD_CORNER = 8;
  var CARD_GAP = 12;
  var KEY_CARD_WIDTH = 220;
  var KEY_PANEL_WIDTH = KEY_CARD_WIDTH + 40;
  var KEY_GAP = 56;
  var KEY_TOTAL = KEY_PANEL_WIDTH + KEY_GAP;
  var ROW_MIN_HEIGHT = 80;
  var PALETTE = current_card_types_default.types;
  var ACTOR_PALETTE = current_card_types_default.actors;
  function paletteFor(type, actor) {
    var _a, _b;
    if (type === "person-action" && actor) return (_a = ACTOR_PALETTE[actor]) != null ? _a : PALETTE["person-action"];
    const p = PALETTE[type];
    return (_b = (p == null ? void 0 : p.rendersAs) ? PALETTE[p.rendersAs] : p) != null ? _b : p;
  }
  function rgb(h) {
    return {
      r: parseInt(h.slice(1, 3), 16) / 255,
      g: parseInt(h.slice(3, 5), 16) / 255,
      b: parseInt(h.slice(5, 7), 16) / 255
    };
  }
  function fill(color) {
    return [{ type: "SOLID", color: rgb(color) }];
  }
  var ICON_SIZE = 14;
  var ICON_GAP = 4;
  var ICON_DEFS = {
    "person-single": {
      minX: 180.737,
      minY: 335.559,
      w: 10.667,
      h: 10.667,
      d: "M186.071 336.826C186.844 336.826 187.471 337.453 187.471 338.226C187.471 338.999 186.844 339.626 186.071 339.626C185.297 339.626 184.671 338.999 184.671 338.226C184.671 337.453 185.297 336.826 186.071 336.826ZM186.071 342.826C188.054 342.826 190.137 343.796 190.137 344.226V344.959H182.004V344.226C182.004 343.796 184.087 342.826 186.071 342.826ZM186.071 335.559C184.597 335.559 183.404 336.753 183.404 338.226C183.404 339.696 184.597 340.893 186.071 340.893C187.544 340.893 188.737 339.696 188.737 338.226C188.737 336.753 187.544 335.559 186.071 335.559ZM186.071 341.559C184.294 341.559 180.737 342.449 180.737 344.226V346.226H191.404V344.226C191.404 342.449 187.847 341.559 186.071 341.559Z"
    },
    "person-group": {
      minX: 178.737,
      minY: 659.226,
      w: 14.667,
      h: 9.333,
      d: "M189.071 664.559C188.267 664.559 187.021 664.783 186.071 665.229C185.121 664.783 183.874 664.559 183.071 664.559C181.627 664.559 178.737 665.283 178.737 666.726V668.559H193.404V666.726C193.404 665.283 190.514 664.559 189.071 664.559ZM186.404 667.559H179.737V666.726C179.737 666.369 181.444 665.559 183.071 665.559C184.697 665.559 186.404 666.369 186.404 666.726V667.559ZM192.404 667.559H187.404V666.726C187.404 666.423 187.271 666.153 187.057 665.913C187.647 665.713 188.367 665.559 189.071 665.559C190.697 665.559 192.404 666.369 192.404 666.726V667.559ZM183.071 663.893C184.361 663.893 185.404 662.846 185.404 661.559C185.404 660.273 184.361 659.226 183.071 659.226C181.784 659.226 180.737 660.273 180.737 661.559C180.737 662.846 181.784 663.893 183.071 663.893ZM183.071 660.226C183.807 660.226 184.404 660.823 184.404 661.559C184.404 662.296 183.807 662.893 183.071 662.893C182.334 662.893 181.737 662.296 181.737 661.559C181.737 660.823 182.334 660.226 183.071 660.226ZM189.071 663.893C190.361 663.893 191.404 662.846 191.404 661.559C191.404 660.273 190.361 659.226 189.071 659.226C187.784 659.226 186.737 660.273 186.737 661.559C186.737 662.846 187.784 663.893 189.071 663.893ZM189.071 660.226C189.807 660.226 190.404 660.823 190.404 661.559C190.404 662.296 189.807 662.893 189.071 662.893C188.334 662.893 187.737 662.296 187.737 661.559C187.737 660.823 188.334 660.226 189.071 660.226Z"
    },
    "gear": {
      minX: 179.632,
      minY: 980.226,
      w: 12.88,
      h: 13.333,
      d: "M187.405 980.226C187.572 980.226 187.713 980.346 187.733 980.506L187.985 982.273C188.392 982.439 188.766 982.659 189.112 982.926L190.773 982.259C190.806 982.246 190.846 982.24 190.886 982.24C191.006 982.24 191.119 982.299 191.179 982.406L192.512 984.712C192.592 984.859 192.559 985.039 192.433 985.139L191.026 986.24C191.052 986.453 191.072 986.666 191.072 986.893C191.072 987.119 191.052 987.333 191.026 987.546L192.433 988.646C192.559 988.746 192.592 988.926 192.512 989.073L191.179 991.379C191.119 991.486 191.006 991.546 190.893 991.546C190.853 991.546 190.813 991.539 190.773 991.526L189.112 990.86C188.766 991.12 188.392 991.346 187.985 991.513L187.733 993.28C187.712 993.439 187.572 993.559 187.405 993.559H184.739C184.573 993.559 184.432 993.439 184.412 993.28L184.159 991.513C183.753 991.346 183.379 991.126 183.032 990.86L181.372 991.526C181.339 991.539 181.299 991.546 181.259 991.546C181.139 991.546 181.026 991.486 180.966 991.379L179.632 989.073C179.552 988.926 179.585 988.746 179.712 988.646L181.119 987.546C181.093 987.333 181.072 987.113 181.072 986.893C181.072 986.673 181.093 986.453 181.119 986.24L179.712 985.139C179.586 985.039 179.545 984.859 179.632 984.712L180.966 982.406C181.026 982.299 181.139 982.24 181.252 982.24C181.292 982.24 181.332 982.246 181.372 982.259L183.032 982.926C183.379 982.666 183.753 982.439 184.159 982.273L184.412 980.506C184.432 980.346 184.573 980.226 184.739 980.226H187.405ZM185.472 982.459L185.365 983.212L184.659 983.499C184.386 983.613 184.112 983.772 183.825 983.986L183.226 984.439L182.532 984.159L181.686 983.82L181.219 984.626L181.939 985.186L182.532 985.653L182.439 986.406C182.419 986.606 182.405 986.76 182.405 986.893C182.405 987.026 182.419 987.18 182.439 987.386L182.532 988.139L181.939 988.606L181.219 989.166L181.686 989.973L182.532 989.632L183.239 989.346L183.846 989.813C184.112 990.013 184.379 990.166 184.665 990.285L185.372 990.573L185.479 991.326L185.606 992.226H186.539L186.672 991.326L186.779 990.573L187.485 990.285C187.759 990.172 188.032 990.012 188.318 989.799L188.919 989.346L189.612 989.626L190.459 989.966L190.926 989.159L190.205 988.599L189.612 988.132L189.705 987.379C189.725 987.179 189.739 987.033 189.739 986.893C189.739 986.753 189.732 986.612 189.705 986.406L189.612 985.653L190.205 985.186L190.919 984.619L190.452 983.813L189.606 984.153L188.899 984.439L188.292 983.973C188.025 983.773 187.758 983.619 187.472 983.499L186.766 983.212L186.659 982.459L186.532 981.559H185.606L185.472 982.459ZM186.072 984.226C187.546 984.226 188.739 985.42 188.739 986.893C188.739 988.366 187.546 989.559 186.072 989.559C184.599 989.559 183.406 988.366 183.405 986.893C183.405 985.42 184.599 984.226 186.072 984.226ZM186.072 985.559C185.339 985.559 184.739 986.16 184.739 986.893C184.74 987.626 185.339 988.226 186.072 988.226C186.806 988.226 187.405 987.626 187.405 986.893C187.405 986.16 186.806 985.559 186.072 985.559Z"
    },
    "document": {
      // Material Icons "description" — 24×24 viewBox, Apache 2.0
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
    },
    "lightning": {
      // Material Icons "bolt" — 24×24 viewBox, Apache 2.0
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M7 2v11h3v9l7-12h-4l4-8z"
    },
    "diamond-alert": {
      minX: 179.387,
      minY: 2272.21,
      w: 13.367,
      h: 13.37,
      d: "M186.071 2285.58C185.893 2285.58 185.724 2285.54 185.562 2285.48C185.401 2285.41 185.254 2285.31 185.121 2285.19L179.771 2279.84C179.649 2279.71 179.554 2279.56 179.487 2279.4C179.421 2279.24 179.387 2279.07 179.387 2278.89C179.387 2278.71 179.421 2278.54 179.487 2278.38C179.554 2278.21 179.649 2278.06 179.771 2277.94L185.121 2272.59C185.254 2272.46 185.401 2272.36 185.562 2272.3C185.724 2272.24 185.893 2272.21 186.071 2272.21C186.249 2272.21 186.421 2272.24 186.587 2272.3C186.754 2272.36 186.899 2272.46 187.021 2272.59L192.371 2277.94C192.504 2278.06 192.601 2278.21 192.662 2278.38C192.724 2278.54 192.754 2278.71 192.754 2278.89C192.754 2279.07 192.724 2279.24 192.662 2279.4C192.601 2279.56 192.504 2279.71 192.371 2279.84L187.021 2285.19C186.899 2285.31 186.754 2285.41 186.587 2285.48C186.421 2285.54 186.249 2285.58 186.071 2285.58ZM186.071 2284.24L191.421 2278.89L186.071 2273.54L180.721 2278.89L186.071 2284.24ZM185.404 2279.56H186.737V2275.56H185.404V2279.56ZM186.071 2281.56C186.26 2281.56 186.418 2281.5 186.546 2281.37C186.674 2281.24 186.737 2281.08 186.737 2280.89C186.737 2280.7 186.674 2280.55 186.546 2280.42C186.418 2280.29 186.26 2280.23 186.071 2280.23C185.882 2280.23 185.724 2280.29 185.596 2280.42C185.468 2280.55 185.404 2280.7 185.404 2280.89C185.404 2281.08 185.468 2281.24 185.596 2281.37C185.724 2281.5 185.882 2281.56 186.071 2281.56Z"
    },
    "lightbulb": {
      minX: 181.404,
      minY: 2595.23,
      w: 9.333,
      h: 13.33,
      d: "M184.071 2607.89C184.071 2608.26 184.371 2608.56 184.737 2608.56H187.404C187.771 2608.56 188.071 2608.26 188.071 2607.89V2607.23H184.071V2607.89ZM186.071 2595.23C183.494 2595.23 181.404 2597.32 181.404 2599.89C181.404 2601.48 182.197 2602.88 183.404 2603.72V2605.23C183.404 2605.59 183.704 2605.89 184.071 2605.89H188.071C188.437 2605.89 188.737 2605.59 188.737 2605.23V2603.72C189.944 2602.88 190.737 2601.48 190.737 2599.89C190.737 2597.32 188.647 2595.23 186.071 2595.23ZM187.974 2602.63L187.404 2603.02V2604.56H184.737V2603.03L184.167 2602.63C183.271 2602 182.737 2600.98 182.737 2599.9C182.737 2598.06 184.234 2596.56 186.071 2596.56C187.907 2596.56 189.404 2598.06 189.404 2599.9C189.404 2600.98 188.871 2602 187.974 2602.63Z"
    },
    "building": {
      minX: 179.737,
      minY: 3241.23,
      w: 12.667,
      h: 13.33,
      d: "M182.737 3247.23H181.404V3251.89H182.737V3247.23ZM186.737 3247.23H185.404V3251.89H186.737V3247.23ZM192.404 3253.23H179.737V3254.56H192.404V3253.23ZM190.737 3247.23H189.404V3251.89H190.737V3247.23ZM186.071 3242.73L189.544 3244.56H182.597L186.071 3242.73ZM186.071 3241.23L179.737 3244.56V3245.89H192.404V3244.56L186.071 3241.23Z"
    },
    "bar-chart": {
      // Material Icons "bar_chart" — 24×24 viewBox, Apache 2.0
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"
    },
    "mail": {
      // Material Icons "mail_outline" — 24×24 viewBox, Apache 2.0
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
    },
    "diamond": {
      // Simple rotated square — channel/touchpoint marker
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M12 2L2 12 12 22 22 12 12 2z"
    },
    "help": {
      // Material Icons "help" — 24×24 viewBox, Apache 2.0
      minX: 0,
      minY: 0,
      w: 24,
      h: 24,
      d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"
    }
  };
  function normalizePath(d, dx, dy) {
    var _a;
    const tokens = (_a = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)) != null ? _a : [];
    const out = [];
    let i = 0;
    let cx = 0, cy = 0;
    let mx = 0, my = 0;
    let lastCmd = "";
    let lastC2x = 0, lastC2y = 0;
    const num = () => parseFloat(tokens[i++]);
    const more = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
    const pt = (x, y) => `${+(x - dx).toFixed(4)} ${+(y - dy).toFixed(4)}`;
    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (!/^[A-Za-z]$/.test(cmd)) continue;
      if (cmd === "Z" || cmd === "z") {
        out.push("Z");
        cx = mx;
        cy = my;
        lastCmd = cmd;
        continue;
      }
      do {
        switch (cmd) {
          case "M": {
            const x = num(), y = num();
            mx = cx = x;
            my = cy = y;
            out.push(`M ${pt(x, y)}`);
            break;
          }
          case "m": {
            const x = cx + num(), y = cy + num();
            mx = cx = x;
            my = cy = y;
            out.push(`M ${pt(x, y)}`);
            break;
          }
          case "L": {
            const x = num(), y = num();
            cx = x;
            cy = y;
            out.push(`L ${pt(x, y)}`);
            break;
          }
          case "l": {
            const x = cx + num(), y = cy + num();
            cx = x;
            cy = y;
            out.push(`L ${pt(x, y)}`);
            break;
          }
          case "H": {
            const x = num();
            cx = x;
            out.push(`L ${pt(x, cy)}`);
            break;
          }
          case "h": {
            const x = cx + num();
            cx = x;
            out.push(`L ${pt(x, cy)}`);
            break;
          }
          case "V": {
            const y = num();
            cy = y;
            out.push(`L ${pt(cx, y)}`);
            break;
          }
          case "v": {
            const y = cy + num();
            cy = y;
            out.push(`L ${pt(cx, y)}`);
            break;
          }
          case "C": {
            const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
            out.push(`C ${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)}`);
            lastC2x = x2;
            lastC2y = y2;
            cx = x;
            cy = y;
            break;
          }
          case "c": {
            const ox = cx, oy = cy;
            const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
            out.push(`C ${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)}`);
            lastC2x = x2;
            lastC2y = y2;
            cx = x;
            cy = y;
            break;
          }
          case "S": {
            const isCurve = /^[CcSs]$/.test(lastCmd);
            const x1 = isCurve ? 2 * cx - lastC2x : cx;
            const y1 = isCurve ? 2 * cy - lastC2y : cy;
            const x2 = num(), y2 = num(), x = num(), y = num();
            out.push(`C ${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)}`);
            lastC2x = x2;
            lastC2y = y2;
            cx = x;
            cy = y;
            break;
          }
          case "s": {
            const isCurve = /^[CcSs]$/.test(lastCmd);
            const x1 = isCurve ? 2 * cx - lastC2x : cx;
            const y1 = isCurve ? 2 * cy - lastC2y : cy;
            const x2 = cx + num(), y2 = cy + num(), x = cx + num(), y = cy + num();
            out.push(`C ${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)}`);
            lastC2x = x2;
            lastC2y = y2;
            cx = x;
            cy = y;
            break;
          }
        }
        lastCmd = cmd;
      } while (more());
    }
    return out.join(" ");
  }
  function iconKey(type, actor) {
    var _a, _b, _c;
    if (type === "person-action" && actor) return (_b = (_a = ACTOR_PALETTE[actor]) == null ? void 0 : _a.icon) != null ? _b : null;
    const p = PALETTE[type];
    const resolved = (p == null ? void 0 : p.rendersAs) ? PALETTE[p.rendersAs] : p;
    return (_c = resolved == null ? void 0 : resolved.icon) != null ? _c : null;
  }
  function vFrame(name, gap = 0) {
    const f = figma.createFrame();
    f.name = name;
    f.fills = [];
    f.layoutMode = "VERTICAL";
    f.primaryAxisSizingMode = "AUTO";
    f.counterAxisSizingMode = "AUTO";
    f.itemSpacing = gap;
    f.clipsContent = false;
    return f;
  }
  function freeFrame(name) {
    const f = figma.createFrame();
    f.name = name;
    f.fills = [];
    f.layoutMode = "NONE";
    f.clipsContent = false;
    return f;
  }
  function txt(content, size, style, color, wrapWidth) {
    const t = figma.createText();
    t.fontName = { family: "Inter", style };
    t.fontSize = size;
    t.fills = fill(color);
    t.characters = content;
    if (wrapWidth !== void 0) {
      t.textAutoResize = "HEIGHT";
      t.resize(wrapWidth, t.height);
    }
    return t;
  }
  function hDivider(container, x, y, width, color = "#CCCCCC") {
    const r = figma.createRectangle();
    container.appendChild(r);
    r.x = x;
    r.y = y;
    r.resize(width, 1);
    r.fills = fill(color);
  }
  function vDivider(container, x, y, height, color = "#DDDDDD") {
    const r = figma.createRectangle();
    container.appendChild(r);
    r.x = x;
    r.y = y;
    r.resize(1, height);
    r.fills = fill(color);
  }
  function renderNoteCard(card, cardWidth) {
    const p = PALETTE["note"];
    const textWidth = cardWidth - CARD_PADDING * 2;
    const f = vFrame("card:note", 6);
    f.fills = fill(p.headerBg);
    f.paddingTop = f.paddingBottom = CARD_PADDING;
    f.paddingLeft = f.paddingRight = CARD_PADDING;
    f.resize(cardWidth, 1);
    f.primaryAxisSizingMode = "AUTO";
    f.counterAxisSizingMode = "FIXED";
    f.cornerRadius = CARD_CORNER;
    const titleNode = txt(card.text, 13, "Semi Bold", p.headerFg, textWidth);
    f.appendChild(titleNode);
    titleNode.layoutSizingHorizontal = "FILL";
    if (card.subtext) {
      const sub = txt(card.subtext, 11, "Regular", p.bodyFg, textWidth);
      f.appendChild(sub);
      sub.layoutSizingHorizontal = "FILL";
    }
    return f;
  }
  function renderTypedCard(card, cardWidth) {
    let p = paletteFor(card.type, card.actor);
    if (card.type === "system" && card.domain) {
      p = __spreadProps(__spreadValues({}, p), { label: `SYSTEM (${card.domain.toUpperCase()})` });
    }
    if (card.type === "domain-event" && card.domain) {
      p = __spreadProps(__spreadValues({}, p), { label: `EVENT (${card.domain.toUpperCase()})` });
    }
    const textWidth = cardWidth - CARD_PADDING * 2;
    const header = vFrame("header", 6);
    header.fills = fill(p.headerBg);
    header.paddingTop = header.paddingBottom = CARD_PADDING;
    header.paddingLeft = header.paddingRight = CARD_PADDING;
    header.resize(cardWidth, 1);
    header.primaryAxisSizingMode = "AUTO";
    header.counterAxisSizingMode = "FIXED";
    const titleNode = txt(card.text, 14, "Semi Bold", p.headerFg, textWidth);
    header.appendChild(titleNode);
    titleNode.layoutSizingHorizontal = "FILL";
    const key = p.label ? iconKey(card.type, card.actor) : null;
    const def = key ? ICON_DEFS[key] : null;
    if (def && p.label) {
      const labelRow = figma.createFrame();
      labelRow.name = "label-row";
      labelRow.fills = [];
      labelRow.layoutMode = "HORIZONTAL";
      labelRow.itemSpacing = ICON_GAP;
      labelRow.primaryAxisSizingMode = "AUTO";
      labelRow.counterAxisSizingMode = "AUTO";
      labelRow.counterAxisAlignItems = "CENTER";
      const iconScale = ICON_SIZE / Math.max(def.w, def.h);
      const v = figma.createVector();
      v.vectorPaths = [{ windingRule: "NONZERO", data: normalizePath(def.d, def.minX, def.minY) }];
      v.fills = fill(p.headerFg);
      v.strokes = [];
      v.resize(def.w * iconScale, def.h * iconScale);
      v.layoutSizingHorizontal = "FIXED";
      v.layoutSizingVertical = "FIXED";
      labelRow.appendChild(v);
      const labelNode = txt(p.label, 11, "Regular", p.headerFg);
      labelRow.appendChild(labelNode);
      header.appendChild(labelRow);
    } else if (p.label) {
      const labelNode = txt(p.label, 11, "Regular", p.headerFg, textWidth);
      header.appendChild(labelNode);
      labelNode.layoutSizingHorizontal = "FILL";
    }
    header.locked = true;
    const cardFrame = vFrame(`card:${card.type}`, 0);
    cardFrame.resize(cardWidth, 1);
    cardFrame.primaryAxisSizingMode = "AUTO";
    cardFrame.counterAxisSizingMode = "FIXED";
    cardFrame.cornerRadius = CARD_CORNER;
    cardFrame.clipsContent = true;
    cardFrame.appendChild(header);
    if (card.subtext) {
      const body = vFrame("body", 0);
      body.fills = fill(p.bodyBg);
      body.paddingTop = body.paddingBottom = CARD_PADDING;
      body.paddingLeft = body.paddingRight = CARD_PADDING;
      body.resize(cardWidth, 1);
      body.primaryAxisSizingMode = "AUTO";
      body.counterAxisSizingMode = "FIXED";
      body.locked = true;
      const sub = txt(card.subtext, 12, "Regular", p.bodyFg, textWidth);
      body.appendChild(sub);
      sub.layoutSizingHorizontal = "FILL";
      cardFrame.appendChild(body);
    }
    return cardFrame;
  }
  function renderCard(card, cardWidth = CARD_WIDTH) {
    return card.type === "note" ? renderNoteCard(card, cardWidth) : renderTypedCard(card, cardWidth);
  }
  function buildKey(blueprintName) {
    const panel = freeFrame("Legend");
    panel.fills = fill("#F8F8F8");
    panel.resize(KEY_PANEL_WIDTH, 100);
    const title = txt(blueprintName, 13, "Semi Bold", "#1A1A1A");
    panel.appendChild(title);
    title.x = 20;
    title.y = 24;
    const sub = txt("Card types \u2014 copy to add", 10, "Regular", "#888888");
    panel.appendChild(sub);
    sub.x = 20;
    sub.y = 24 + title.height + 4;
    let y = 24 + title.height + 4 + sub.height + 20;
    const types = [
      "system",
      "policy",
      "communications",
      "pain-point",
      "opportunity",
      "domain-event",
      "data-entity",
      "metrics",
      "question",
      "touchpoint",
      "note"
    ];
    const actors = ["applicant", "caseworker", "supervisor"];
    for (const actor of actors) {
      const sample = renderCard(
        { type: "person-action", actor, text: ACTOR_PALETTE[actor].label, subtext: "Action taken" },
        KEY_CARD_WIDTH
      );
      panel.appendChild(sample);
      sample.x = 20;
      sample.y = y;
      y += sample.height + 10;
    }
    for (const type of types) {
      const p = PALETTE[type];
      const sample = renderCard(
        { type, text: p.label || "Note", subtext: "Description" },
        KEY_CARD_WIDTH
      );
      panel.appendChild(sample);
      sample.x = 20;
      sample.y = y;
      y += sample.height + 10;
    }
    panel.resize(KEY_PANEL_WIDTH, y + 24);
    return panel;
  }
  function renderBlueprint(blueprint) {
    return __async(this, null, function* () {
      var _a;
      yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      yield figma.loadFontAsync({ family: "Inter", style: "Medium" });
      yield figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      const columns = [];
      for (const phase of blueprint.phases) {
        for (const sp of phase.subPhases) {
          columns.push(__spreadProps(__spreadValues({}, sp), { phase }));
        }
      }
      const cellMap = /* @__PURE__ */ new Map();
      for (const cell of blueprint.cells) {
        cellMap.set(`${cell.laneId}/${cell.subPhaseId}`, cell);
      }
      const cellGrid = [];
      const rowHeights = [];
      for (const lane of blueprint.lanes) {
        const laneRow = [];
        let maxH = ROW_MIN_HEIGHT;
        for (const col of columns) {
          const entry = cellMap.get(`${lane.id}/${col.id}`);
          const cards = ((_a = entry == null ? void 0 : entry.cards) != null ? _a : []).map((c) => renderCard(c, CARD_WIDTH));
          let h = CELL_PADDING;
          for (const card of cards) h += card.height + CARD_GAP;
          if (cards.length > 0) h = h - CARD_GAP + CELL_PADDING;
          else h = CELL_PADDING * 2;
          const contentHeight = Math.max(h, ROW_MIN_HEIGHT);
          laneRow.push({ cards, contentHeight });
          maxH = Math.max(maxH, contentHeight);
        }
        cellGrid.push(laneRow);
        rowHeights.push(maxH);
      }
      const tableWidth = LANE_LABEL_WIDTH + columns.length * PHASE_WIDTH;
      const tableHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0);
      const totalWidth = KEY_TOTAL + tableWidth;
      const container = freeFrame(blueprint.name);
      container.fills = fill("#FFFFFF");
      container.resize(totalWidth, Math.max(tableHeight, 400));
      figma.currentPage.appendChild(container);
      const key = buildKey(blueprint.name);
      container.appendChild(key);
      key.x = 0;
      key.y = 0;
      const bpX = KEY_TOTAL;
      {
        let colOffset = 0;
        for (const phase of blueprint.phases) {
          const spanW = phase.subPhases.length * PHASE_WIDTH;
          const spanX = bpX + LANE_LABEL_WIDTH + colOffset * PHASE_WIDTH;
          const label = txt(phase.label, 13, "Semi Bold", "#1A1A1A");
          container.appendChild(label);
          label.x = spanX + (spanW - label.width) / 2;
          label.y = 8;
          colOffset += phase.subPhases.length;
          if (colOffset < columns.length) {
            vDivider(container, bpX + LANE_LABEL_WIDTH + colOffset * PHASE_WIDTH, 0, HEADER_HEIGHT, "#AAAAAA");
          }
        }
      }
      hDivider(container, bpX + LANE_LABEL_WIDTH, PHASE_HEADER_H, tableWidth - LANE_LABEL_WIDTH, "#CCCCCC");
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const colX = bpX + LANE_LABEL_WIDTH + i * PHASE_WIDTH;
        const label = txt(col.label, 11, "Regular", "#555555");
        container.appendChild(label);
        label.x = colX + (PHASE_WIDTH - label.width) / 2;
        label.y = PHASE_HEADER_H + 6;
        if (i < columns.length - 1 && columns[i + 1].phase.id === col.phase.id) {
          vDivider(container, colX + PHASE_WIDTH, PHASE_HEADER_H, HEADER_HEIGHT - PHASE_HEADER_H, "#DDDDDD");
        }
      }
      hDivider(container, bpX, HEADER_HEIGHT, tableWidth, "#AAAAAA");
      let y = HEADER_HEIGHT;
      for (let li = 0; li < blueprint.lanes.length; li++) {
        const lane = blueprint.lanes[li];
        const rowH = rowHeights[li];
        if (li > 0) hDivider(container, bpX, y, tableWidth, "#CCCCCC");
        const laneLabel = txt(lane.label, 11, "Semi Bold", "#555555");
        container.appendChild(laneLabel);
        laneLabel.x = bpX + (LANE_LABEL_WIDTH - laneLabel.width) / 2;
        laneLabel.y = y + (rowH - laneLabel.height) / 2;
        vDivider(container, bpX + LANE_LABEL_WIDTH, y, rowH);
        for (let ci = 0; ci < columns.length; ci++) {
          const { cards } = cellGrid[li][ci];
          const baseX = bpX + LANE_LABEL_WIDTH + ci * PHASE_WIDTH;
          let cardY = y + CELL_PADDING;
          for (const card of cards) {
            container.appendChild(card);
            card.x = baseX + CELL_PADDING;
            card.y = cardY;
            cardY += card.height + CARD_GAP;
          }
          if (ci < columns.length - 1) {
            const isPhaseBreak = columns[ci + 1].phase.id !== columns[ci].phase.id;
            vDivider(container, baseX + PHASE_WIDTH, y, rowH, isPhaseBreak ? "#AAAAAA" : "#DDDDDD");
          }
        }
        y += rowH;
      }
      hDivider(container, bpX, y, tableWidth, "#AAAAAA");
      vDivider(container, bpX, HEADER_HEIGHT, y - HEADER_HEIGHT, "#AAAAAA");
      vDivider(container, bpX + tableWidth, HEADER_HEIGHT, y - HEADER_HEIGHT, "#AAAAAA");
      container.resize(totalWidth, Math.max(y, 400));
      figma.viewport.scrollAndZoomIntoView([container]);
      figma.notify(`Generated: ${blueprint.name}`);
    });
  }
  var DESIGN_CARD_W = 240;
  var DESIGN_CARD_CORNER = 5;
  var DESIGN_HEADER_PAD = 18;
  var DESIGN_BODY_PAD = 24;
  var DESIGN_TEXT_W = DESIGN_CARD_W - DESIGN_HEADER_PAD * 2;
  var DESIGN_PILL_PAD_H = 4;
  var DESIGN_PILL_PAD_V = 8;
  var DESIGN_PILL_GAP = 4;
  var DESIGN_SECTION_GAP = 48;
  var DESIGN_CARD_GAP = 16;
  function sspTxt(content, size, style, color, opts) {
    const t = figma.createText();
    t.fontName = { family: "Source Sans Pro", style };
    t.fontSize = size;
    if ((opts == null ? void 0 : opts.lineHeight) !== void 0) {
      t.lineHeight = { value: opts.lineHeight, unit: "PIXELS" };
    }
    if ((opts == null ? void 0 : opts.letterSpacing) !== void 0) {
      t.letterSpacing = { value: opts.letterSpacing, unit: "PIXELS" };
    }
    t.characters = content;
    t.fills = fill(color);
    if ((opts == null ? void 0 : opts.wrapWidth) !== void 0) {
      t.textAutoResize = "HEIGHT";
      t.resize(opts.wrapWidth, t.height);
    }
    return t;
  }
  function renderDesignCard(entry) {
    var _a;
    const p = (_a = paletteFor(entry.type, entry.actor)) != null ? _a : PALETTE["note"];
    const bodyText = entry.subtext || "";
    const header = figma.createFrame();
    header.name = "header";
    header.layoutMode = "VERTICAL";
    header.paddingTop = header.paddingBottom = DESIGN_HEADER_PAD;
    header.paddingLeft = header.paddingRight = DESIGN_HEADER_PAD;
    header.itemSpacing = 0;
    header.fills = fill(p.headerBg);
    header.resize(DESIGN_CARD_W, 1);
    header.primaryAxisSizingMode = "AUTO";
    header.counterAxisSizingMode = "FIXED";
    const titleNode = sspTxt(entry.text, 18, "SemiBold", p.headerFg, {
      lineHeight: 24,
      wrapWidth: DESIGN_TEXT_W
    });
    header.appendChild(titleNode);
    titleNode.layoutSizingHorizontal = "FILL";
    if (p.label) {
      const pill = figma.createFrame();
      pill.name = "pill";
      pill.layoutMode = "HORIZONTAL";
      pill.primaryAxisSizingMode = "AUTO";
      pill.counterAxisSizingMode = "AUTO";
      pill.counterAxisAlignItems = "CENTER";
      pill.paddingTop = pill.paddingBottom = DESIGN_PILL_PAD_H;
      pill.paddingLeft = pill.paddingRight = DESIGN_PILL_PAD_V;
      pill.itemSpacing = DESIGN_PILL_GAP;
      pill.cornerRadius = 12;
      pill.fills = fill(p.headerBg);
      pill.strokes = [];
      const key = iconKey(entry.type, entry.actor);
      const def = key ? ICON_DEFS[key] : null;
      if (def) {
        const iconScale = ICON_SIZE / Math.max(def.w, def.h);
        const v = figma.createVector();
        v.vectorPaths = [{ windingRule: "NONZERO", data: normalizePath(def.d, def.minX, def.minY) }];
        v.fills = fill(p.headerFg);
        v.strokes = [];
        v.resize(def.w * iconScale, def.h * iconScale);
        v.layoutSizingHorizontal = "FIXED";
        v.layoutSizingVertical = "FIXED";
        pill.appendChild(v);
      }
      const labelNode = sspTxt(p.label, 12, "Regular", p.headerFg, { lineHeight: 24, letterSpacing: 1 });
      pill.appendChild(labelNode);
      header.appendChild(pill);
    }
    header.locked = true;
    const card = figma.createFrame();
    card.name = entry.citation || "";
    card.layoutMode = "VERTICAL";
    card.itemSpacing = 0;
    card.cornerRadius = DESIGN_CARD_CORNER;
    card.clipsContent = true;
    card.fills = [];
    card.resize(DESIGN_CARD_W, 1);
    card.primaryAxisSizingMode = "AUTO";
    card.counterAxisSizingMode = "FIXED";
    card.appendChild(header);
    if (bodyText) {
      const body = figma.createFrame();
      body.name = "body";
      body.layoutMode = "VERTICAL";
      body.paddingTop = body.paddingBottom = DESIGN_BODY_PAD;
      body.paddingLeft = body.paddingRight = DESIGN_HEADER_PAD;
      body.fills = fill(p.bodyBg);
      body.resize(DESIGN_CARD_W, 1);
      body.primaryAxisSizingMode = "AUTO";
      body.counterAxisSizingMode = "FIXED";
      body.locked = true;
      const sub = sspTxt(bodyText, 14, "Regular", p.bodyFg, {
        lineHeight: 21,
        wrapWidth: DESIGN_TEXT_W
      });
      body.appendChild(sub);
      sub.layoutSizingHorizontal = "FILL";
      card.appendChild(body);
    }
    return card;
  }
  function labelFrame(content, size, style, color) {
    const f = figma.createFrame();
    f.name = "";
    f.fills = [];
    f.layoutMode = "VERTICAL";
    f.primaryAxisSizingMode = "AUTO";
    f.counterAxisSizingMode = "AUTO";
    f.clipsContent = false;
    const t = txt(content, size, style, color);
    f.appendChild(t);
    return f;
  }
  function renderCards(data) {
    return __async(this, null, function* () {
      yield figma.loadFontAsync({ family: "Source Sans Pro", style: "Regular" });
      yield figma.loadFontAsync({ family: "Source Sans Pro", style: "SemiBold" });
      yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      yield figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      const PAGE_PADDING = 40;
      const CARDS_PER_ROW = 5;
      const lib = figma.createSection();
      lib.name = `${data.name} \u2014 Card Library`;
      figma.currentPage.appendChild(lib);
      let x = PAGE_PADDING;
      let y = PAGE_PADDING;
      const titleFrame = labelFrame(`${data.name} \u2014 Card Library`, 16, "Semi Bold", "#1A1A1A");
      lib.appendChild(titleFrame);
      titleFrame.x = x;
      titleFrame.y = y;
      y += titleFrame.height + 24;
      for (const phase of data.phases) {
        for (const subPhase of phase.subPhases) {
          if (!subPhase.cards.length) continue;
          const phaseLabel = `${phase.label}  /  ${subPhase.label}`;
          const labelF = labelFrame(phaseLabel.toUpperCase(), 10, "Semi Bold", "#888888");
          lib.appendChild(labelF);
          labelF.x = x;
          labelF.y = y;
          y += labelF.height + 12;
          let col = 0;
          let rowX = x;
          let rowMaxH = 0;
          for (const entry of subPhase.cards) {
            const card = renderDesignCard(entry);
            lib.appendChild(card);
            card.x = rowX;
            card.y = y;
            rowMaxH = Math.max(rowMaxH, card.height);
            rowX += DESIGN_CARD_W + DESIGN_CARD_GAP;
            col++;
            if (col >= CARDS_PER_ROW) {
              col = 0;
              rowX = x;
              y += rowMaxH + DESIGN_CARD_GAP;
              rowMaxH = 0;
            }
          }
          if (col > 0) y += rowMaxH;
          y += DESIGN_SECTION_GAP;
        }
      }
      const sectionW = PAGE_PADDING * 2 + CARDS_PER_ROW * DESIGN_CARD_W + (CARDS_PER_ROW - 1) * DESIGN_CARD_GAP;
      lib.resizeWithoutConstraints(sectionW, y + PAGE_PADDING);
      figma.viewport.scrollAndZoomIntoView([lib]);
      figma.notify(`Generated: ${data.name} \u2014 Card Library`);
    });
  }

  // service-blueprints/src/figma-plugin/src/_current.json
  var current_default = {
    id: "intake-blueprint",
    name: "Intake Service Blueprint",
    lanes: [
      {
        id: "applicant",
        label: "Applicant"
      },
      {
        id: "caseworker",
        label: "Caseworker"
      },
      {
        id: "system",
        label: "System"
      },
      {
        id: "regulations",
        label: "Regulations"
      },
      {
        id: "data",
        label: "Events"
      }
    ],
    phases: [
      {
        id: "application-intake",
        label: "Application intake",
        subPhases: [
          {
            id: "submitted",
            label: "Submission"
          }
        ]
      },
      {
        id: "application-review",
        label: "Application review",
        subPhases: [
          {
            id: "automated-screening",
            label: "Automated screening"
          },
          {
            id: "under-review",
            label: "Task assignment"
          },
          {
            id: "active-review",
            label: "Verification review"
          },
          {
            id: "interview",
            label: "Program verification"
          },
          {
            id: "escalation",
            label: "Escalation"
          }
        ]
      },
      {
        id: "eligibility-determination",
        label: "Eligibility determination",
        subPhases: [
          {
            id: "submit-for-determination",
            label: "Submit for determination"
          },
          {
            id: "benefits-calculation",
            label: "Determination"
          },
          {
            id: "decision",
            label: "Closeout"
          }
        ]
      }
    ],
    cells: [
      {
        laneId: "system",
        subPhaseId: "submitted",
        cards: [
          {
            type: "system",
            domain: "intake",
            text: "Documents linked to verification items"
          }
        ]
      },
      {
        laneId: "data",
        subPhaseId: "automated-screening",
        cards: [
          {
            type: "domain-event",
            text: "application.submitted",
            domain: "intake"
          },
          {
            type: "domain-event",
            text: "eligibility.application.expedited",
            domain: "eligibility"
          },
          {
            type: "domain-event",
            text: "call.completed",
            domain: "data_exchange",
            subtext: "One per call; results arrive asynchronously"
          },
          {
            type: "domain-event",
            text: "eligibility.application.decision_completed",
            domain: "eligibility",
            subtext: "One per auto-resolved Medicaid Decision; Decision.submissionChecks records the electronic check results"
          },
          {
            type: "domain-event",
            text: "person.match_resolved",
            domain: "client_management"
          }
        ]
      },
      {
        laneId: "system",
        subPhaseId: "automated-screening",
        cards: [
          {
            type: "system",
            domain: "workflow",
            text: "Task created in intake queue; SLA and queue routing assigned",
            subtext: "In response to event application.submitted"
          },
          {
            type: "system",
            domain: "eligibility",
            text: "Expedited screening initiated",
            subtext: "Also initiates Medicaid RTE if applicable"
          },
          {
            type: "system",
            domain: "intake",
            text: "Set isExpedited = true on application",
            subtext: "In response to event eligibility.application.expedited"
          },
          {
            type: "system",
            domain: "workflow",
            text: "Assign expedited SLA track",
            subtext: "In response to event eligibility.application.expedited"
          },
          {
            type: "system",
            domain: "eligibility",
            text: "Electronic checks evaluated per Medicaid applicant",
            subtext: "In response to event call.completed"
          },
          {
            type: "system",
            domain: "client_management",
            text: "Person matching initiated",
            subtext: "In response to event application.submitted"
          },
          {
            type: "note",
            domain: "intake",
            text: "\u26A0 Auto-confirm exact matches; queue fuzzy matches for caseworker review",
            subtext: "Person match auto-confirmation behavior not yet designed in intake"
          }
        ]
      },
      {
        laneId: "caseworker",
        subPhaseId: "under-review",
        cards: [
          {
            type: "person-action",
            actor: "caseworker",
            text: "Claims task from queue",
            subtext: "Caseworker selects from prioritized intake queue"
          },
          {
            type: "person-action",
            actor: "caseworker",
            text: "Schedules interview",
            subtext: "Launched from within intake \u2014 ensures appointment links to application"
          }
        ]
      },
      {
        laneId: "system",
        subPhaseId: "under-review",
        cards: [
          {
            type: "system",
            domain: "intake",
            text: "Application status \u2192 under_review"
          },
          {
            type: "system",
            domain: "intake",
            text: "Interview record created and linked to application"
          }
        ]
      },
      {
        laneId: "caseworker",
        subPhaseId: "active-review",
        cards: [
          {
            type: "person-action",
            actor: "caseworker",
            text: "Reviews verification results; resolves satisfied items; flags unresolved"
          },
          {
            type: "person-action",
            actor: "caseworker",
            text: "Uploads supporting document; attaches to verification item"
          },
          {
            type: "person-action",
            actor: "caseworker",
            text: "Reviews failure; determines if retriable",
            subtext: "Failure reason visible on Verification; retriable vs non-retriable per Decision 10 (data exchange)"
          },
          {
            type: "person-action",
            actor: "caseworker",
            text: "Initiates retry"
          }
        ]
      },
      {
        laneId: "system",
        subPhaseId: "active-review",
        cards: [
          {
            type: "system",
            domain: "intake",
            text: "Verification item status updated"
          },
          {
            type: "note",
            domain: "communications",
            text: "\u26A0 Document request notice sent to applicant",
            subtext: "Notice template catalog not yet designed"
          },
          {
            type: "system",
            domain: "intake",
            text: "Document linked to verification item as evidence"
          },
          {
            type: "system",
            domain: "intake",
            text: "Verification updated with new result",
            subtext: "In response to event call.completed"
          },
          {
            type: "system",
            domain: "intake",
            text: "Verification marked cannot_verify; caseworker decides next step",
            subtext: "In response to event call.completed"
          }
        ]
      },
      {
        laneId: "data",
        subPhaseId: "active-review",
        cards: [
          {
            type: "domain-event",
            text: "call.completed",
            domain: "data_exchange"
          }
        ]
      },
      {
        laneId: "system",
        subPhaseId: "interview",
        cards: [
          {
            type: "system",
            domain: "intake",
            text: "Caseworker attests interview complete (PATCH Interview.completedAt)"
          }
        ]
      },
      {
        laneId: "caseworker",
        subPhaseId: "escalation",
        cards: [
          {
            type: "person-action",
            actor: "caseworker",
            text: "Escalates case"
          },
          {
            type: "person-action",
            actor: "supervisor",
            text: "Claims escalated task"
          },
          {
            type: "person-action",
            actor: "supervisor",
            text: "Reviews escalation; provides guidance or takes over resolution"
          }
        ]
      },
      {
        laneId: "system",
        subPhaseId: "escalation",
        cards: [
          {
            type: "system",
            domain: "intake",
            text: "Application status \u2192 under supervisor review"
          }
        ]
      },
      {
        laneId: "regulations",
        subPhaseId: "decision",
        cards: [
          {
            type: "policy",
            text: "Notice of Action required",
            subtext: "Adverse action notice required for denials and closures"
          }
        ]
      }
    ]
  };

  // service-blueprints/src/figma-plugin/src/_current_cards.json
  var current_cards_default = { domain: "intake", name: "Intake", phases: [{ id: "flow-0", label: "Application Submission", subPhases: [{ id: "frag-0-0", label: "Application Submission", cards: [{ type: "policy", text: "7 CFR \xA7 273.2(g)", subtext: "Agency must accept any application on the date of first contact, even if incomplete. The date received is the application filing date and starts the processing clock.", citation: "7 CFR \xA7 273.2(g)" }, { type: "policy", text: "7 CFR \xA7 273.2(c)(1)", subtext: "Agency must date-stamp or otherwise record the date of receipt on every application. The date stamp establishes the filing date used for timeliness determinations.", citation: "7 CFR \xA7 273.2(c)(1)" }, { type: "policy", text: "7 CFR \xA7 273.2(i)(1)", subtext: "Agency must act on an application and provide benefits or send a notice of denial within 30 days of the date of application.", citation: "7 CFR \xA7 273.2(i)(1)" }, { type: "policy", text: "7 CFR \xA7 273.2(i)(3)(i)", subtext: "Benefits must be issued within 7 days for households with gross monthly income below $150 and liquid resources at or below $100, or households whose combined monthly gross income and liquid resources are less than the monthly rent or mortgage and utilities.", citation: "7 CFR \xA7 273.2(i)(3)(i)" }, { type: "policy", text: "42 CFR \xA7 435.912", subtext: "States must make eligibility determinations within 45 days of application for most applicants and within 90 days for applicants who require a disability determination.", citation: "42 CFR \xA7 435.912" }, { type: "policy", text: "7 CFR \xA7 273.2(a)", subtext: "Any household may apply for SNAP benefits regardless of current participation in other programs. Agencies may not screen out applicants before accepting an application.", citation: "7 CFR \xA7 273.2(a)" }, { type: "policy", text: "7 CFR \xA7 273.1", subtext: "All household members must be listed on the application regardless of whether they are individually applying for SNAP. Members who are ineligible \u2014 such as non-citizens who do not qualify \u2014 must still be listed because their income and resources are counted when calculating the benefit amount for the rest of the household.", citation: "7 CFR \xA7 273.1" }, { type: "policy", text: "7 CFR \xA7 273.2(f)", subtext: "Before certifying a household, the agency must verify income, identity, and residency. Verification may occur via electronic check, document review, or interview. States may not require verification of items beyond those listed in this section.", citation: "7 CFR \xA7 273.2(f)" }, { type: "policy", text: "42 CFR \xA7 435.940", subtext: "When verification is required, electronic data sources must be checked before requesting paper documentation from applicants. Applies to citizenship, immigration status, and income verification. Paper documents may only be requested when an electronic check returns inconclusive.", citation: "42 CFR \xA7 435.940" }, { type: "policy", text: "42 U.S.C. \xA7 1320b-7", subtext: "Agencies must use SSA data matches to verify identity and citizenship status for SNAP applicants. FDSH SSA is the electronic source for this check.", citation: "42 U.S.C. \xA7 1320b-7" }, { type: "policy", text: "7 CFR \xA7 272.8", subtext: "Income must be verified through available electronic data sources (SSA IEVS, IRS IEVS, SWICA, UIB) before relying on applicant statements. Electronic verification reduces documentation burden on applicants.", citation: "7 CFR \xA7 272.8" }, { type: "policy", text: "42 CFR \xA7 435.956(b)", subtext: "States must use electronic data sources to verify citizenship before requesting paper documentation. FDSH SSA citizenship check satisfies this requirement.", citation: "42 CFR \xA7 435.956(b)" }, { type: "policy", text: "42 CFR \xA7 435.956(c)", subtext: "States must use electronic data sources to verify immigration status before requesting paper documentation. FDSH VLP satisfies this requirement.", citation: "42 CFR \xA7 435.956(c)" }, { type: "policy", text: "42 CFR \xA7 435.948", subtext: "States must use data from other agencies and programs to verify eligibility information electronically before requesting documentation from applicants.", citation: "42 CFR \xA7 435.948" }] }, { id: "frag-0-1", label: "if Medicaid applied", cards: [{ type: "policy", text: "Check for existing Medicare or Medicaid enrollment before starting verification \u2014 active coverage may allow auto-approval", subtext: "Two federal data hub checks must be performed before requesting documents from the applicant: one for existing Medicare enrollment and one for existing Medicaid or other health coverage. If active coverage is found, the application may be auto-approved without further verification. Otherwise, standard electronic verification continues.", citation: "42 CFR \xA7 435.916" }] }] }, { id: "flow-1", label: "Caseworker Review", subPhases: [{ id: "frag-1-0", label: "Caseworker Review", cards: [{ type: "policy", text: "7 CFR \xA7 273.2(e)", subtext: "SNAP applicants must complete an in-person or telephone interview before certification. The interview must be conducted by a qualified eligibility worker.", citation: "7 CFR \xA7 273.2(e)" }] }] }, { id: "flow-2", label: "Eligibility Determination", subPhases: [{ id: "frag-2-0", label: "Path B: caseworker reviews complete determination picture", cards: [{ type: "policy", text: "7 CFR \xA7 273.15", subtext: "Applicants have the right to a fair hearing if the agency delays or denies benefits. Supervisor review is a prerequisite for escalated cases prior to formal hearing proceedings.", citation: "7 CFR \xA7 273.15" }, { type: "policy", text: "7 CFR \xA7 273.2(h)", subtext: "Written notice of eligibility or denial must be sent to each applicant household within the 30-day processing deadline (7 days for expedited). Notice must include the eligibility decision, benefit amount if approved, or denial reason if denied.", citation: "7 CFR \xA7 273.2(h)" }, { type: "policy", text: "42 CFR \xA7 435.917", subtext: "Written notice of eligibility, denial, or termination must be sent within the 45-day processing deadline (90 days if a disability determination is required). Notice must state the decision, the reason, and the applicant's right to appeal.", citation: "42 CFR \xA7 435.917" }, { type: "policy", text: "7 CFR \xA7 273.15(a)", subtext: "Every household has the right to a fair hearing to contest any agency action affecting their benefits, including delays, denials, reductions, and terminations.", citation: "7 CFR \xA7 273.15(a)" }, { type: "policy", text: "42 CFR \xA7 431.17(b)(1)", subtext: "Each eligibility determination must be documented with the date of the decision, the regulatory basis for the decision, and all information and documents used to support it. Applies to approvals, denials, and terminations.", citation: "42 CFR \xA7 431.17(b)(1)" }] }] }] };

  // service-blueprints/src/figma-plugin/src/main.ts
  var BLUEPRINTS = {
    intake: current_default
  };
  var CARDS = {
    intake: current_cards_default
  };
  figma.showUI(__html__, { width: 320, height: 240, title: "Service Blueprint" });
  figma.ui.on("message", (msg) => __async(null, null, function* () {
    var _a, _b;
    if (msg.type === "generate") {
      const blueprint = BLUEPRINTS[(_a = msg.blueprint) != null ? _a : ""];
      if (!blueprint) {
        figma.notify(`Unknown blueprint: ${msg.blueprint}`, { error: true });
        return;
      }
      try {
        yield renderBlueprint(blueprint);
      } catch (e) {
        figma.notify(`Error: ${e.message}`, { error: true });
      }
    }
    if (msg.type === "generate-cards") {
      const data = CARDS[(_b = msg.domain) != null ? _b : ""];
      if (!data) {
        figma.notify(`Unknown domain: ${msg.domain}`, { error: true });
        return;
      }
      try {
        yield renderCards(data);
      } catch (e) {
        figma.notify(`Error: ${e.message}`, { error: true });
      }
    }
  }));
})();
