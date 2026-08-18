/* T Finance — investment projector + budget tracker. No server, localStorage only. */
(function () {
  "use strict";

  // ---- Constants: storage keys, widget layout defaults, built-in returns ----

  var STATE_KEY = "compounding-state-v1";
  var THEME_KEY = "compounding-theme";
  var CANVAS_KEY = "compounding-canvas-v2";
  var BUDGET_STATE_KEY = "compounding-budget-v1";
  var BUDGET_CANVAS_KEY = "compounding-budget-canvas-v1";
  var PAGE_SESSION_KEY = "compounding-page";
  var SNAP = 16;
  var lastResult = null;

  // capital/contribution/allocation start below y:11.1% to clear the floating
  // controls (top-right); their heights also account for each widget's own
  // CSS min-height so a fresh "Default" layout never needs a runtime nudge.
  var WIDGET_DEFAULTS = {
    capital:      { x: 59.220, y: 11.111, w: 31.803, h: 22.222 },
    contribution: { x: 58.977, y: 34.444, w: 41.063, h: 29.444 },
    allocation:   { x: 58.977, y: 65.000, w: 41.063, h: 33.889 },
    overview:     { x: 0,      y: 0,      w: 57.027, h: 21.868 },
    chart:        { x: 0,      y: 24.481, w: 57.027, h: 49.567 },
    table:        { x: 0,      y: 76.428, w: 57.027, h: 23.325 }
  };

  var WIDGET_MIN = {
    capital:      { w: 260, h: 190 },
    contribution: { w: 280, h: 220 },
    allocation:   { w: 340, h: 280 },
    overview:     { w: 280, h: 160 },
    chart:        { w: 340, h: 260 },
    table:        { w: 360, h: 220 }
  };

  var BUDGET_WIDGET_DEFAULTS = {
    overview:  { x: 0,  y: 0,  w: 57, h: 18 },
    breakdown: { x: 0,  y: 20, w: 57, h: 52 },
    income:    { x: 59, y: 17, w: 41, h: 23 },
    expenses:  { x: 59, y: 42, w: 41, h: 28 },
    savings:   { x: 59, y: 72, w: 41, h: 26 }
  };

  var BUDGET_WIDGET_MIN = {
    overview:  { w: 280, h: 150 },
    breakdown: { w: 300, h: 260 },
    income:    { w: 300, h: 230 },
    expenses:  { w: 300, h: 220 },
    savings:   { w: 300, h: 220 }
  };

  // Long-run historical averages, no live data. "ret" = total return; "div" = yield portion of it.
  var KNOWN_RETURNS = {
    VOO:  { name: "Vanguard S&P 500 ETF",                    ret: 10, div: 1.5 },
    IVV:  { name: "iShares Core S&P 500 ETF",                ret: 10, div: 1.5 },
    SPY:  { name: "SPDR S&P 500 ETF Trust",                  ret: 10, div: 1.5 },
    VTI:  { name: "Vanguard Total US Stock Market",          ret: 10, div: 1.5 },
    VUG:  { name: "Vanguard US Growth ETF",                  ret: 11, div: 0.5 },
    VTV:  { name: "Vanguard US Value ETF",                   ret: 9,  div: 2.2 },
    VYM:  { name: "Vanguard High Dividend Yield ETF",        ret: 9,  div: 2.9 },
    SCHD: { name: "Schwab US Dividend Equity ETF",           ret: 11, div: 3.4 },
    QQQ:  { name: "Invesco QQQ Trust (Nasdaq-100)",          ret: 13, div: 0.6 },
    QQQM: { name: "Invesco NASDAQ-100 ETF",                  ret: 13, div: 0.6 },
    SPYG: { name: "SPDR Portfolio S&P 500 Growth ETF",       ret: 11, div: 0.7 },
    IWM:  { name: "iShares Russell 2000 ETF",                ret: 8,  div: 1.3 },
    VXUS: { name: "Vanguard Total International Stock",      ret: 7,  div: 3.0 },
    VEU:  { name: "Vanguard FTSE All-World ex-US ETF",       ret: 7,  div: 3.0 },
    VEA:  { name: "Vanguard FTSE Developed Markets ETF",     ret: 7,  div: 3.0 },
    VWO:  { name: "Vanguard FTSE Emerging Markets ETF",      ret: 6,  div: 2.7 },
    BND:  { name: "Vanguard Total Bond Market ETF",          ret: 4,  div: 3.5 },
    AGG:  { name: "iShares Core US Aggregate Bond ETF",      ret: 4,  div: 3.5 },
    TLT:  { name: "iShares 20+ Year Treasury Bond ETF",      ret: 4,  div: 3.8 },
    VNQ:  { name: "Vanguard Real Estate ETF",                ret: 8,  div: 3.8 },
    SCHH: { name: "Schwab US REIT ETF",                      ret: 8,  div: 3.5 },
    GLD:  { name: "SPDR Gold Shares",                        ret: 5,  div: 0   },
    IAU:  { name: "iShares Gold Trust",                      ret: 5,  div: 0   },
    DIA:  { name: "SPDR Dow Jones Industrial Average ETF",   ret: 9,  div: 1.8 }
  };

  var STARTER_ETFS = [
    { ticker: "VOO",  pct: 70, enabled: true  },
    { ticker: "QQQM", pct: 30, enabled: true  },
    { ticker: "VTI",  pct: 0,  enabled: false },
    { ticker: "QQQ",  pct: 0,  enabled: false },
    { ticker: "SCHD", pct: 0,  enabled: false },
    { ticker: "VXUS", pct: 0,  enabled: false },
    { ticker: "VNQ",  pct: 0,  enabled: false },
    { ticker: "BND",  pct: 0,  enabled: false }
  ];

  function buildDefaultEtfs() {
    return STARTER_ETFS.map(function (s) {
      var known = KNOWN_RETURNS[s.ticker];
      return { ticker: s.ticker, name: known.name, ret: known.ret, div: known.div, pct: s.pct, enabled: s.enabled, auto: true };
    });
  }

  // ---- Investment state + shared helpers (storage wrappers swallow errors on purpose) ----

  var state = {
    startingCapital: 10000,
    years: 20,
    phases: [{ from: 1, amount: 500 }],
    etfs: buildDefaultEtfs(),
    reinvestDividends: true,
    adjustInflation: false,
    inflationRate: 3
  };

  var $ = function (id) { return document.getElementById(id); };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function textSpan(text) {
    var span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  // Small "×" remove button, used by every removable list row (phases, ETFs, line items).
  function makeRemoveButton(ariaLabel, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-btn";
    btn.setAttribute("aria-label", ariaLabel);
    btn.textContent = "×";
    btn.addEventListener("click", onClick);
    return btn;
  }

  // A labeled, %-suffixed number input — one ETF row has two (return + dividend yield).
  function makeRetGroup(labelText, min, max, step, value, ariaLabel) {
    var label = textSpan(labelText);
    label.className = "etf-ret-label";
    var group = document.createElement("div");
    group.className = "etf-ret-group";
    var inputRow = document.createElement("label");
    inputRow.className = "etf-pct";
    var input = document.createElement("input");
    input.type = "number";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.setAttribute("aria-label", ariaLabel);
    inputRow.appendChild(input);
    inputRow.appendChild(textSpan("%"));
    group.appendChild(label);
    group.appendChild(inputRow);
    return { group: group, input: input };
  }

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }
  function writeStorage(key, val) {
    try { localStorage.setItem(key, val); } catch (err) { return; }
  }
  function removeStorage(key) {
    try { localStorage.removeItem(key); } catch (err) { return; }
  }
  function readJSON(key) {
    var raw = readStorage(key);
    if (!raw) return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return null; }
    return (parsed && typeof parsed === "object") ? parsed : null;
  }

  // ---- Load saved investment inputs (validated field by field; bad values fall back to defaults) ----

  function loadState() {
    var saved = readJSON(STATE_KEY);
    if (!saved) return;

    if (typeof saved.startingCapital === "number" && isFinite(saved.startingCapital) && saved.startingCapital >= 0) {
      state.startingCapital = saved.startingCapital;
    }
    if (typeof saved.years === "number" && isFinite(saved.years)) {
      state.years = clamp(Math.round(saved.years), 1, 50);
    }
    if (typeof saved.reinvestDividends === "boolean") {
      state.reinvestDividends = saved.reinvestDividends;
    }
    if (typeof saved.adjustInflation === "boolean") {
      state.adjustInflation = saved.adjustInflation;
    }
    if (typeof saved.inflationRate === "number" && isFinite(saved.inflationRate)) {
      state.inflationRate = clamp(saved.inflationRate, 0, 20);
    }
    if (Array.isArray(saved.phases)) {
      var cleanPhases = saved.phases
        .filter(function (p) { return p && typeof p.from === "number" && typeof p.amount === "number" && isFinite(p.from) && isFinite(p.amount); })
        .map(function (p) { return { from: clamp(Math.round(p.from), 1, state.years * 12), amount: clamp(p.amount, 0, 10000000) }; })
        .slice(0, 24);
      if (cleanPhases.length) {
        cleanPhases.sort(function (a, b) { return a.from - b.from; });
        cleanPhases[0].from = 1;
        state.phases = cleanPhases;
      }
    }
    if (Array.isArray(saved.etfs) && saved.etfs.length) {
      var seenTickers = {};
      var cleanEtfs = saved.etfs
        .filter(function (e) { return e && typeof e.ticker === "string" && e.ticker.trim(); })
        .slice(0, 30)
        .map(function (e) {
          var ticker = e.ticker.trim().toUpperCase().slice(0, 10);
          var known = KNOWN_RETURNS[ticker];
          return {
            ticker: ticker,
            name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 80) : (known ? known.name : "Custom entry"),
            ret: typeof e.ret === "number" && isFinite(e.ret) ? clamp(e.ret, -50, 100) : (known ? known.ret : 7),
            div: typeof e.div === "number" && isFinite(e.div) ? clamp(e.div, 0, 20) : (known ? known.div : 0),
            pct: typeof e.pct === "number" && isFinite(e.pct) ? clamp(e.pct, 0, 100) : 0,
            enabled: typeof e.enabled === "boolean" ? e.enabled : true,
            auto: typeof e.auto === "boolean" ? e.auto : !!known
          };
        })
        .filter(function (e) {
          if (seenTickers[e.ticker]) return false;
          seenTickers[e.ticker] = true;
          return true;
        });
      if (cleanEtfs.length) state.etfs = cleanEtfs;
    }
  }

  function saveState() {
    var payload = {
      startingCapital: state.startingCapital,
      years: state.years,
      reinvestDividends: !!state.reinvestDividends,
      adjustInflation: !!state.adjustInflation,
      inflationRate: state.inflationRate,
      phases: state.phases,
      etfs: state.etfs.map(function (e) { return { ticker: e.ticker, name: e.name, pct: e.pct, ret: e.ret, div: e.div, enabled: e.enabled, auto: !!e.auto }; })
    };
    writeStorage(STATE_KEY, JSON.stringify(payload));
  }

  // ---- Shared hue/lightness color picker popover for budget line-item swatches ----

  var LEGACY_COLOR_VARS = {
    grey: "var(--cat-grey-shade)", blue: "var(--cat-blue-shade)", purple: "var(--cat-purple-shade)",
    green: "var(--cat-green-shade)", orange: "var(--cat-orange-shade)", pink: "var(--cat-pink-shade)",
    teal: "var(--cat-teal-shade)", red: "var(--cat-red-shade)", yellow: "var(--cat-yellow-shade)",
    indigo: "var(--cat-indigo-shade)", cyan: "var(--cat-cyan-shade)", lime: "var(--cat-lime-shade)",
    brown: "var(--cat-brown-shade)", magenta: "var(--cat-magenta-shade)",
    accent: "var(--accent)", brass: "var(--brass)"
  };
  function resolveItemColor(value) {
    if (!value) return LEGACY_COLOR_VARS.grey;
    if (LEGACY_COLOR_VARS[value]) return LEGACY_COLOR_VARS[value];
    return value;
  }

  // Row lengths taper to a hexagon; centering each row lets rows interlock into a honeycomb.
  var HUE_GRID_ROWS = [5, 6, 7, 8, 9, 8, 7, 6, 5];
  var huePickerMenu = $("huePickerMenu");
  var huePickerCallback = null;

  function closeHuePicker() {
    huePickerMenu.hidden = true;
    huePickerCallback = null;
    document.removeEventListener("pointerdown", onHueOutsideClick, true);
    document.removeEventListener("keydown", onHueKeydown, true);
  }
  function onHueOutsideClick(e) {
    if (!huePickerMenu.contains(e.target) && !e.target.closest(".li-color-trigger")) closeHuePicker();
  }
  function onHueKeydown(e) {
    if (e.key === "Escape") closeHuePicker();
  }
  function openHuePicker(triggerEl, currentValue, onPick) {
    huePickerCallback = onPick;
    Array.prototype.forEach.call(huePickerMenu.querySelectorAll(".hue-tile"), function (t) {
      t.classList.toggle("selected", t.dataset.color === currentValue);
    });
    huePickerMenu.hidden = false;
    var rect = triggerEl.getBoundingClientRect();
    var menuRect = huePickerMenu.getBoundingClientRect();
    var top = rect.bottom + 8;
    if (top + menuRect.height > window.innerHeight) top = Math.max(8, rect.top - menuRect.height - 8);
    var left = clamp(rect.left, 8, Math.max(8, window.innerWidth - menuRect.width - 8));
    huePickerMenu.style.top = top + "px";
    huePickerMenu.style.left = left + "px";
    document.addEventListener("pointerdown", onHueOutsideClick, true);
    document.addEventListener("keydown", onHueKeydown, true);
  }

  (function buildHuePickerMenu() {
    function makeTile(color, label) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "hue-tile";
      tile.dataset.color = color;
      if (label) { tile.title = label; tile.setAttribute("aria-label", label); }
      else tile.setAttribute("aria-label", "Pick color " + color);
      tile.style.background = LEGACY_COLOR_VARS[color] || color;
      tile.addEventListener("click", function () {
        if (huePickerCallback) huePickerCallback(color);
        closeHuePicker();
      });
      return tile;
    }

    var specialRow = document.createElement("div");
    specialRow.className = "hue-row hue-row-special";
    specialRow.appendChild(makeTile("accent", "Theme accent"));
    specialRow.appendChild(makeTile("brass", "Theme highlight"));
    huePickerMenu.appendChild(specialRow);

    var grid = document.createElement("div");
    grid.className = "hue-grid";
    var rowCount = HUE_GRID_ROWS.length;
    HUE_GRID_ROWS.forEach(function (cols, rowIdx) {
      var lightness = Math.round(88 - (rowIdx / (rowCount - 1)) * 76);
      var rowEl = document.createElement("div");
      rowEl.className = "hue-row";
      for (var c = 0; c < cols; c++) {
        var hue = Math.round((c / cols) * 360);
        rowEl.appendChild(makeTile("hsl(" + hue + ", 82%, " + lightness + "%)", null));
      }
      grid.appendChild(rowEl);
    });
    huePickerMenu.appendChild(grid);
  })();

  // ---- Budget tracker state (own storage key, validated the same way as investment state) ----

  var budgetState = {
    hourlyRate: 0,
    hoursPerYear: 0,
    savingsGoalPct: 20,
    leftoverColor: "",
    incomeItems: [{ name: "Salary", amount: 0 }],
    expenseItems: [
      { name: "Rent/mortgage", amount: 0, color: "blue" },
      { name: "Groceries", amount: 0, color: "purple" },
      { name: "Utilities", amount: 0, color: "teal" }
    ],
    savingsItems: [
      { name: "Emergency fund", amount: 0, color: "green" },
      { name: "Retirement (401k/IRA)", amount: 0, color: "orange" }
    ]
  };

  function cleanLineItems(arr) {
    if (!Array.isArray(arr)) return null;
    return arr
      .filter(function (it) { return it && typeof it.name === "string"; })
      .slice(0, 50)
      .map(function (it) {
        return {
          name: it.name.slice(0, 60),
          amount: typeof it.amount === "number" && isFinite(it.amount) ? clamp(it.amount, 0, 10000000) : 0,
          color: typeof it.color === "string" && it.color.length > 0 && it.color.length <= 40 ? it.color : "grey"
        };
      });
  }

  function loadBudgetState() {
    var saved = readJSON(BUDGET_STATE_KEY);
    if (!saved) return;
    if (typeof saved.hourlyRate === "number" && isFinite(saved.hourlyRate) && saved.hourlyRate >= 0) {
      budgetState.hourlyRate = saved.hourlyRate;
    }
    if (typeof saved.hoursPerYear === "number" && isFinite(saved.hoursPerYear) && saved.hoursPerYear >= 0) {
      budgetState.hoursPerYear = saved.hoursPerYear;
    }
    if (typeof saved.savingsGoalPct === "number" && isFinite(saved.savingsGoalPct)) {
      budgetState.savingsGoalPct = clamp(saved.savingsGoalPct, 0, 100);
    }
    if (typeof saved.leftoverColor === "string" && saved.leftoverColor.length <= 40) {
      budgetState.leftoverColor = saved.leftoverColor;
    }
    var income = cleanLineItems(saved.incomeItems);
    if (income) budgetState.incomeItems = income;
    var expenses = cleanLineItems(saved.expenseItems);
    if (expenses) budgetState.expenseItems = expenses;
    var savings = cleanLineItems(saved.savingsItems);
    if (savings) budgetState.savingsItems = savings;
  }

  function saveBudgetState() {
    writeStorage(BUDGET_STATE_KEY, JSON.stringify(budgetState));
  }

  // ---- Reusable trigger+popover dropdown (open/close, outside-click, Escape) ----

  function makeDropdown(container, trigger, menu) {
    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function open() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
    }
    function onOutside(e) { if (!container.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") { close(); trigger.focus(); } }
    trigger.addEventListener("click", function () { menu.hidden ? open() : close(); });
    return { close: close };
  }

  // ---- Theme picker (swatches are custom-drawn, so preview colors are hardcoded below) ----

  var THEME_GROUPS = [
    { label: "Neutral", themes: ["light", "dark"] },
    { label: "Sakura", themes: ["sakura-light", "sakura-dark"] },
    { label: "Matrix", themes: ["matrix-light", "matrix-dark"] },
    { label: "Solarized", themes: ["solarized-light", "solarized-dark"] },
    { label: "Nord", themes: ["nord-light", "nord-dark"] },
    { label: "Studio Ghibli", themes: ["ponyo", "mononoke", "spirited-away"] },
    { label: "Cyberpunk 2077", themes: ["cyberpunk-light", "cyberpunk-dark"] }
  ];
  var THEME_PREVIEWS = {
    "light":            { paper: "#f5f6f0", accent: "#34406b", brass: "#a8792a", label: "Light" },
    "dark":              { paper: "#18181a", accent: "#93a4dd", brass: "#d9a64e", label: "Dark" },
    "sakura-light":      { paper: "#fdf3f5", accent: "#c85c82", brass: "#a8792a", label: "Sakura Light" },
    "sakura-dark":       { paper: "#241017", accent: "#f28fb0", brass: "#d9a64e", label: "Sakura Dark" },
    "matrix-light":      { paper: "#eef7ee", accent: "#12a150", brass: "#a8792a", label: "Matrix Light" },
    "matrix-dark":       { paper: "#060a06", accent: "#39ff6a", brass: "#d9a64e", label: "Matrix Dark" },
    "solarized-light":   { paper: "#eee8d5", accent: "#268bd2", brass: "#b58900", label: "Solarized Light" },
    "solarized-dark":    { paper: "#002b36", accent: "#268bd2", brass: "#b58900", label: "Solarized Dark" },
    "nord-light":        { paper: "#e5e9f0", accent: "#5e81ac", brass: "#d08770", label: "Nord Light" },
    "nord-dark":         { paper: "#2e3440", accent: "#88c0d0", brass: "#d08770", label: "Nord Dark" },
    "ponyo":             { paper: "#eaf6f6", accent: "#ff6b4a", brass: "#e8a23a", label: "Ponyo" },
    "mononoke":          { paper: "#16211a", accent: "#6fae4a", brass: "#c98a3d", label: "Princess Mononoke" },
    "spirited-away":     { paper: "#241512", accent: "#d1462f", brass: "#d9a13a", label: "Spirited Away" },
    "cyberpunk-light":   { paper: "#f2f2f5", accent: "#d6247d", brass: "#00acc1", label: "Cyberpunk Light" },
    "cyberpunk-dark":    { paper: "#0d0d0f", accent: "#fcee0a", brass: "#00f0ff", label: "Cyberpunk Dark" }
  };
  var THEMES = Object.keys(THEME_PREVIEWS);

  (function initTheme() {
    var picker = $("themePicker");
    var trigger = $("themeTrigger");
    var triggerHex = $("themeTriggerHex");
    var triggerLabel = $("themeTriggerLabel");
    var menu = $("themeMenu");
    var dropdown = makeDropdown(picker, trigger, menu);

    function hexBackground(info) {
      return "linear-gradient(135deg, " + info.paper + " 50%, " + info.accent + " 50%)";
    }

    function applyTheme(theme) {
      var info = THEME_PREVIEWS[theme] || THEME_PREVIEWS.light;
      document.documentElement.setAttribute("data-theme", theme);
      triggerHex.style.background = hexBackground(info);
      triggerLabel.textContent = info.label;
      Array.prototype.forEach.call(menu.querySelectorAll(".theme-hex"), function (hx) {
        hx.classList.toggle("selected", hx.dataset.theme === theme);
      });
    }

    THEME_GROUPS.forEach(function (group) {
      var label = document.createElement("div");
      label.className = "theme-hex-label";
      label.textContent = group.label;
      menu.appendChild(label);

      group.themes.forEach(function (key) {
        var info = THEME_PREVIEWS[key];
        var hex = document.createElement("button");
        hex.type = "button";
        hex.className = "theme-hex";
        hex.dataset.theme = key;
        hex.title = info.label;
        hex.setAttribute("aria-label", info.label);
        hex.style.background = hexBackground(info);
        var dot = document.createElement("span");
        dot.className = "theme-hex-accent";
        dot.setAttribute("aria-hidden", "true");
        dot.style.background = info.brass;
        hex.appendChild(dot);
        hex.addEventListener("click", function () {
          applyTheme(key);
          writeStorage(THEME_KEY, key);
          dropdown.close();
        });
        menu.appendChild(hex);
      });
    });

    var stored = readStorage(THEME_KEY);
    applyTheme(THEMES.indexOf(stored) !== -1 ? stored : "light");
  })();

  // ---- Freeform canvas: draggable/resizable widgets, one controller instance per page ----

  function isNarrowLayout() { return window.matchMedia("(max-width: 900px)").matches; }
  var floatingControlsEl = $("floatingControls");

  // Nudges a dragged rect (x,y,w,h) the minimum distance needed so it no longer
  // overlaps `zone` — used to keep widgets from being dropped under the floating controls.
  function keepOutOfZone(x, y, w, h, zone) {
    var overlaps = x < zone.right && x + w > zone.left && y < zone.bottom && y + h > zone.top;
    if (!overlaps) return { x: x, y: y };
    var pushLeft = x + w - zone.left;
    var pushRight = zone.right - x;
    var pushUp = y + h - zone.top;
    var pushDown = zone.bottom - y;
    var minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);
    if (minPush === pushUp) return { x: x, y: zone.top - h };
    if (minPush === pushDown) return { x: x, y: zone.bottom };
    if (minPush === pushLeft) return { x: zone.left - w, y: y };
    return { x: zone.right, y: y };
  }

  // Shrinks a growing rect (fixed x,y; growing w,h) so it stops at the zone's edge
  // instead of resizing into it. Used by the resize handle (position never moves).
  function capSizeForZone(x, y, w, h, zone) {
    var overlaps = x < zone.right && x + w > zone.left && y < zone.bottom && y + h > zone.top;
    if (!overlaps) return { w: w, h: h };
    var maxW = zone.left - x, maxH = zone.top - y;
    return maxW >= maxH ? { w: Math.max(0, maxW), h: h } : { w: w, h: Math.max(0, maxH) };
  }

  // floatingControlsEl's rect, in coordinates relative to canvasRect (both from getBoundingClientRect).
  function zoneFromCanvas(canvasRect) {
    var fcRect = floatingControlsEl.getBoundingClientRect();
    return {
      left: fcRect.left - canvasRect.left, top: fcRect.top - canvasRect.top,
      right: fcRect.right - canvasRect.left, bottom: fcRect.bottom - canvasRect.top
    };
  }

  function initCanvasController(opts) {
    var canvasEl = opts.canvas;
    var defaults = opts.defaults;
    var mins = opts.mins;
    var storageKey = opts.storageKey;

    var widgetEls = {};
    Array.prototype.forEach.call(canvasEl.querySelectorAll(".widget"), function (w) {
      widgetEls[w.dataset.widgetId] = w;
    });

    var topZ = 10;
    Object.keys(widgetEls).forEach(function (id, i) { widgetEls[id].style.zIndex = String(topZ + i); });
    topZ += Object.keys(widgetEls).length;

    function loadLayout() {
      var result = {};
      var parsed = readJSON(storageKey);
      if (!parsed) return result;
      Object.keys(defaults).forEach(function (id) {
        var r = parsed[id];
        if (r && typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number" &&
            isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h)) {
          result[id] = {
            x: clamp(r.x, 0, 100), y: clamp(r.y, 0, 100), w: clamp(r.w, 5, 100), h: clamp(r.h, 5, 100),
            minimized: r.minimized === true
          };
        }
      });
      return result;
    }

    var layout = {};
    Object.keys(defaults).forEach(function (id) { layout[id] = Object.assign({}, defaults[id]); });
    Object.assign(layout, loadLayout());

    function saveLayout() { writeStorage(storageKey, JSON.stringify(layout)); }

    // Repositions (never resizes) widgets out of the floating-controls zone at render
    // time — a pure display correction, not written back to `layout`, so it keeps
    // stored positions safe at any viewport size without ever touching saved data.
    function applyAllLayout() {
      var canvasRect = canvasEl.getBoundingClientRect();
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
      var zone = zoneFromCanvas(canvasRect);
      Object.keys(widgetEls).forEach(function (id) {
        var widget = widgetEls[id];
        var r = layout[id];
        var x = r.x / 100 * canvasRect.width;
        var y = r.y / 100 * canvasRect.height;
        var w = r.w / 100 * canvasRect.width;
        var h = r.h / 100 * canvasRect.height;
        var pos = keepOutOfZone(x, y, w, h, zone);
        widget.style.left = clamp(pos.x, 0, Math.max(0, canvasRect.width - w)) + "px";
        widget.style.top = clamp(pos.y, 0, Math.max(0, canvasRect.height - h)) + "px";
        widget.style.width = w + "px";
        widget.style.height = h + "px";
      });
    }

    // While minimized, the widget's rendered height is just its header, so the real
    // (pre-minimize) height is kept from layout instead of measured from the DOM.
    function persistWidgetRect(widget) {
      var canvasRect = canvasEl.getBoundingClientRect();
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
      var wRect = widget.getBoundingClientRect();
      var id = widget.dataset.widgetId;
      var minimized = widget.classList.contains("minimized");
      var prevH = layout[id] && layout[id].h;
      layout[id] = {
        x: clamp((wRect.left - canvasRect.left) / canvasRect.width * 100, 0, 100),
        y: clamp((wRect.top - canvasRect.top) / canvasRect.height * 100, 0, 100),
        w: clamp(wRect.width / canvasRect.width * 100, 5, 100),
        h: minimized && prevH ? prevH : clamp(wRect.height / canvasRect.height * 100, 5, 100),
        minimized: minimized
      };
      saveLayout();
    }

    function bringToFront(widget) {
      topZ += 1;
      widget.style.zIndex = String(topZ);
    }

    // Collapses a widget to just its header. persistWidgetRect() (above) handles
    // keeping the real height and the minimized flag in sync in localStorage.
    function makeMinimizeButton(widget) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "widget-minimize";
      function sync() {
        var minimized = widget.classList.contains("minimized");
        btn.textContent = minimized ? "▸" : "▾";
        btn.setAttribute("aria-label", minimized ? "Expand widget" : "Minimize widget");
      }
      btn.addEventListener("click", function () {
        widget.classList.toggle("minimized");
        sync();
        persistWidgetRect(widget);
      });
      sync();
      return btn;
    }

    // Snaps to a SNAP-px grid, clamped inside the canvas.
    function makeDraggable(widget, header) {
      header.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 && e.pointerType !== "touch") return;
        if (isNarrowLayout()) return;
        if (e.target.closest("button, input, select, a, [role=\"button\"]")) return;
        var canvasRect = canvasEl.getBoundingClientRect();
        var widgetRect = widget.getBoundingClientRect();
        var offsetX = e.clientX - widgetRect.left;
        var offsetY = e.clientY - widgetRect.top;
        var exclusionZone = zoneFromCanvas(canvasRect);
        bringToFront(widget);
        widget.classList.add("dragging");
        try { header.setPointerCapture(e.pointerId); } catch (err) { /* see note above */ }

        function onMove(ev) {
          var rawX = ev.clientX - canvasRect.left - offsetX;
          var rawY = ev.clientY - canvasRect.top - offsetY;
          var snappedX = Math.round(rawX / SNAP) * SNAP;
          var snappedY = Math.round(rawY / SNAP) * SNAP;
          var maxX = Math.max(0, canvasRect.width - widgetRect.width);
          var maxY = Math.max(0, canvasRect.height - widgetRect.height);
          var pos = keepOutOfZone(
            clamp(snappedX, 0, maxX), clamp(snappedY, 0, maxY),
            widgetRect.width, widgetRect.height, exclusionZone
          );
          widget.style.left = clamp(pos.x, 0, maxX) + "px";
          widget.style.top = clamp(pos.y, 0, maxY) + "px";
        }
        function onUp() {
          header.removeEventListener("pointermove", onMove);
          header.removeEventListener("pointerup", onUp);
          header.removeEventListener("pointercancel", onUp);
          widget.classList.remove("dragging");
          persistWidgetRect(widget);
        }
        header.addEventListener("pointermove", onMove);
        header.addEventListener("pointerup", onUp);
        header.addEventListener("pointercancel", onUp);
      });
    }

    // Same snap-to-grid approach as makeDraggable, but resizing.
    function makeResizable(widget, handle, id) {
      handle.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 && e.pointerType !== "touch") return;
        if (isNarrowLayout()) return;
        e.preventDefault();
        e.stopPropagation();
        var canvasRect = canvasEl.getBoundingClientRect();
        var widgetRect = widget.getBoundingClientRect();
        var startX = e.clientX, startY = e.clientY;
        var startW = widgetRect.width, startH = widgetRect.height;
        var widgetX = widgetRect.left - canvasRect.left, widgetY = widgetRect.top - canvasRect.top;
        var exclusionZone = zoneFromCanvas(canvasRect);
        var min = mins[id] || { w: 220, h: 140 };
        var maxW = canvasRect.right - widgetRect.left;
        var maxH = canvasRect.bottom - widgetRect.top;
        bringToFront(widget);
        widget.classList.add("resizing");
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* see note above */ }

        function onMove(ev) {
          var rawW = startW + (ev.clientX - startX);
          var rawH = startH + (ev.clientY - startY);
          var snappedW = Math.round(rawW / SNAP) * SNAP;
          var snappedH = Math.round(rawH / SNAP) * SNAP;
          var w = clamp(snappedW, min.w, Math.max(min.w, maxW));
          var h = clamp(snappedH, min.h, Math.max(min.h, maxH));
          var size = capSizeForZone(widgetX, widgetY, w, h, exclusionZone);
          widget.style.width = Math.max(min.w, size.w) + "px";
          widget.style.height = Math.max(min.h, size.h) + "px";
          if (opts.onWidgetResize) opts.onWidgetResize(id);
        }
        function onUp() {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
          widget.classList.remove("resizing");
          persistWidgetRect(widget);
        }
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      });
    }

    Object.keys(widgetEls).forEach(function (id) {
      var widget = widgetEls[id];
      var header = widget.querySelector(".widget-header");
      var handle = widget.querySelector(".resize-handle");
      if (layout[id].minimized) widget.classList.add("minimized");
      header.appendChild(makeMinimizeButton(widget));
      makeDraggable(widget, header);
      makeResizable(widget, handle, id);
      widget.addEventListener("pointerdown", function () { bringToFront(widget); });

      if (typeof ResizeObserver !== "undefined") {
        var ro = new ResizeObserver(function () {
          if (isNarrowLayout()) return;
          persistWidgetRect(widget);
          if (opts.onWidgetResize) opts.onWidgetResize(id);
        });
        ro.observe(widget);
      }
    });

    return { applyAllLayout: applyAllLayout };
  }

  var investmentCanvasCtl = initCanvasController({
    canvas: $("canvas"),
    defaults: WIDGET_DEFAULTS,
    mins: WIDGET_MIN,
    storageKey: CANVAS_KEY,
    onWidgetResize: function (id) { if (id === "chart" && lastResult) renderChart(lastResult); }
  });

  var budgetCanvasCtl = initCanvasController({
    canvas: $("budgetCanvas"),
    defaults: BUDGET_WIDGET_DEFAULTS,
    mins: BUDGET_WIDGET_MIN,
    storageKey: BUDGET_CANVAS_KEY,
    onWidgetResize: null
  });

  investmentCanvasCtl.applyAllLayout();
  budgetCanvasCtl.applyAllLayout();
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (isNarrowLayout()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      investmentCanvasCtl.applyAllLayout();
      budgetCanvasCtl.applyAllLayout();
    }, 120);
  });

  var fmtFull = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var fmtCompact = new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 });
  var fmtPct = function (n) { return (Math.round(n * 10) / 10) + "%"; };

  loadState();

  var phaseList = $("phaseList");
  var etfList = $("etfList");
  var allocTotalEl = $("allocTotal");
  var statRow = $("statRow");
  var legendEl = $("legend");
  var tableBody = $("tableBody");
  var chartSvg = $("chartSvg");
  var chartWrap = $("chartWrap");
  var tooltip = $("tooltip");

  $("startingCapital").value = state.startingCapital;
  $("years").value = state.years;

  loadBudgetState();

  var incomeListEl = $("incomeList");
  var expenseListEl = $("expenseList");
  var savingsListEl = $("savingsList");
  var budgetStatRow = $("budgetStatRow");
  var budgetLegendEl = $("budgetLegend");
  var pieSvg = $("pieSvg");
  var pieWrap = $("pieWrap");
  var pieTooltip = $("pieTooltip");

  $("hourlyRate").value = budgetState.hourlyRate;
  $("hoursPerYear").value = budgetState.hoursPerYear;
  $("savingsGoalPct").value = budgetState.savingsGoalPct;

  // ---- Investment controls: contribution phases, ETF allocation list, ticker-add form ----

  function renderPhases() {
    state.phases.sort(function (a, b) { return a.from - b.from; });
    phaseList.innerHTML = "";
    state.phases.forEach(function (phase, i) {
      var row = document.createElement("div");
      row.className = "phase-row" + (i === 0 ? " fixed" : "");

      if (i === 0) {
        var fromLabel = document.createElement("div");
        fromLabel.className = "field";
        fromLabel.innerHTML = '<span>Timing</span><span class="static-label">From the start</span>';
        row.appendChild(fromLabel);
      } else {
        var fromField = document.createElement("label");
        fromField.className = "field";
        fromField.innerHTML = '<span>Starting month</span>';
        var fromInput = document.createElement("input");
        fromInput.type = "number";
        fromInput.min = "2";
        fromInput.max = String(state.years * 12);
        fromInput.value = phase.from;
        fromInput.addEventListener("change", function () {
          phase.from = clamp(parseInt(fromInput.value, 10) || 2, 2, state.years * 12);
          recompute();
        });
        fromField.appendChild(fromInput);
        row.appendChild(fromField);
      }

      var amtField = document.createElement("label");
      amtField.className = "field";
      amtField.innerHTML = '<span>Monthly amount</span>';
      var amtWrap = document.createElement("div");
      amtWrap.className = "input-prefix";
      amtWrap.innerHTML = "<span>$</span>";
      var amtInput = document.createElement("input");
      amtInput.type = "number";
      amtInput.min = "0";
      amtInput.step = "50";
      amtInput.value = phase.amount;
      amtInput.addEventListener("input", function () {
        phase.amount = Math.max(0, parseFloat(amtInput.value) || 0);
        recompute();
      });
      amtWrap.appendChild(amtInput);
      amtField.appendChild(amtWrap);
      row.appendChild(amtField);

      if (i > 0) {
        var removeBtn = makeRemoveButton("Remove this contribution change", function () {
          state.phases.splice(state.phases.indexOf(phase), 1);
          renderPhases();
          recompute();
        });
        row.appendChild(removeBtn);
      }

      phaseList.appendChild(row);
    });
  }

  $("addPhase").addEventListener("click", function () {
    var lastMonth = state.phases.length ? state.phases[state.phases.length - 1].from : 1;
    var nextMonth = clamp(lastMonth + 12, 2, state.years * 12);
    state.phases.push({ from: nextMonth, amount: state.phases[state.phases.length - 1].amount });
    renderPhases();
    recompute();
  });

  function otherEnabledPct(etf) {
    return state.etfs.reduce(function (s, e) { return s + (e.enabled && e !== etf ? e.pct : 0); }, 0);
  }

  function renderEtfList() {
    etfList.innerHTML = "";
    state.etfs.forEach(function (etf) {
      var row = document.createElement("div");
      row.className = "etf-row" + (etf.enabled ? "" : " disabled");

      var check = document.createElement("input");
      check.type = "checkbox";
      check.checked = etf.enabled;
      check.setAttribute("aria-label", "Include " + etf.ticker);
      check.addEventListener("change", function () {
        etf.enabled = check.checked;
        if (etf.enabled) {
          var room = 100 - otherEnabledPct(etf);
          if (etf.pct > room) { etf.pct = Math.max(0, room); pctInput.value = etf.pct; }
          if (etf.pct === 0 && room > 0) { etf.pct = Math.min(room, 10); pctInput.value = etf.pct; }
        }
        row.classList.toggle("disabled", !etf.enabled);
        recompute();
      });
      row.appendChild(check);

      var meta = document.createElement("div");
      meta.className = "etf-meta";
      var tickerEl = document.createElement("span");
      tickerEl.className = "etf-ticker";
      tickerEl.textContent = etf.ticker;
      var nameEl = document.createElement("span");
      nameEl.className = "etf-name";
      nameEl.textContent = etf.name;
      nameEl.title = etf.name;
      meta.appendChild(tickerEl);
      meta.appendChild(nameEl);
      row.appendChild(meta);

      var pctWrap = document.createElement("label");
      pctWrap.className = "etf-pct";
      var pctInput = document.createElement("input");
      pctInput.type = "number";
      pctInput.min = "0";
      pctInput.max = "100";
      pctInput.value = etf.pct;
      pctInput.setAttribute("aria-label", etf.ticker + " allocation percent");
      pctInput.addEventListener("input", function () {
        var room = 100 - otherEnabledPct(etf);
        var val = clamp(parseFloat(pctInput.value) || 0, 0, Math.max(0, room));
        etf.pct = val;
        if (parseFloat(pctInput.value) !== val) pctInput.value = val;
        recompute();
      });
      pctWrap.appendChild(pctInput);
      pctWrap.appendChild(textSpan("%"));
      row.appendChild(pctWrap);

      var retWrap = document.createElement("div");
      retWrap.className = "etf-ret";

      function tagTitle() {
        return etf.auto
          ? "Matched to a built-in table of long-run historical averages"
          : "No match in the built-in table — this is your own estimate (dashed border)";
      }

      var retField = makeRetGroup("APY", "-20", "40", "0.5", etf.ret, etf.ticker + " assumed annual return (APY) percent");
      var divField = makeRetGroup("div yield", "0", "20", "0.1", etf.div || 0, etf.ticker + " assumed dividend yield percent");
      var retInput = retField.input, divInput = divField.input;
      retInput.classList.toggle("is-custom", !etf.auto);
      retInput.title = tagTitle();
      divInput.classList.toggle("is-custom", !etf.auto);
      divInput.title = tagTitle();

      function markCustom() {
        etf.auto = false;
        retInput.classList.add("is-custom");
        divInput.classList.add("is-custom");
        retInput.title = tagTitle();
        divInput.title = tagTitle();
      }
      retInput.addEventListener("input", function () {
        etf.ret = parseFloat(retInput.value) || 0;
        markCustom();
        recompute();
      });
      divInput.addEventListener("input", function () {
        etf.div = clamp(parseFloat(divInput.value) || 0, 0, 20);
        markCustom();
        recompute();
      });

      retWrap.appendChild(retField.group);
      retWrap.appendChild(divField.group);
      row.appendChild(retWrap);

      var removeEtfBtn = makeRemoveButton("Remove " + etf.ticker, function () {
        state.etfs.splice(state.etfs.indexOf(etf), 1);
        renderEtfList();
        recompute();
      });
      row.appendChild(removeEtfBtn);

      etfList.appendChild(row);
    });
  }

  function flashInvalid(input) {
    input.classList.add("invalid");
    setTimeout(function () { input.classList.remove("invalid"); }, 900);
  }

  function addTicker(raw) {
    var ticker = (raw || "").trim().toUpperCase().slice(0, 10);
    var input = $("newTicker");
    if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
      flashInvalid(input);
      return;
    }
    if (state.etfs.length >= 30) {
      flashInvalid(input);
      return;
    }
    var existing = state.etfs.filter(function (e) { return e.ticker === ticker; })[0];
    if (existing) {
      existing.enabled = true;
    } else {
      var known = KNOWN_RETURNS[ticker];
      state.etfs.push({
        ticker: ticker,
        name: known ? known.name : "Custom entry — no match in the built-in table",
        ret: known ? known.ret : 7,
        div: known ? known.div : 0,
        pct: 0,
        enabled: true,
        auto: !!known
      });
    }
    input.value = "";
    renderEtfList();
    recompute();
  }

  $("addEtfBtn").addEventListener("click", function () { addTicker($("newTicker").value); });
  $("newTicker").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addTicker(this.value); }
  });

  var reinvestToggle = $("reinvestToggle");
  reinvestToggle.checked = state.reinvestDividends;
  reinvestToggle.addEventListener("change", function () {
    state.reinvestDividends = reinvestToggle.checked;
    recompute();
  });

  $("startingCapital").addEventListener("input", function (e) {
    state.startingCapital = Math.max(0, parseFloat(e.target.value) || 0);
    recompute();
  });
  $("years").addEventListener("input", function (e) {
    state.years = clamp(parseInt(e.target.value, 10) || 1, 1, 50);
    recompute();
  });

  var inflationToggle = $("inflationToggle");
  inflationToggle.checked = state.adjustInflation;
  inflationToggle.addEventListener("change", function () {
    state.adjustInflation = inflationToggle.checked;
    recompute();
  });
  $("inflationRate").value = state.inflationRate;
  $("inflationRate").addEventListener("input", function (e) {
    state.inflationRate = clamp(parseFloat(e.target.value) || 0, 0, 20);
    recompute();
  });

  // ---- Budget line-item lists (income/expenses/savings share one render function) ----

  function renderLineItems(container, items, placeholder, onChange, includeColor) {
    container.innerHTML = "";
    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "line-item-row" + (includeColor ? " has-color" : "");

      if (includeColor) {
        var colorTrigger = document.createElement("button");
        colorTrigger.type = "button";
        colorTrigger.className = "li-color-trigger";
        colorTrigger.setAttribute("aria-label", "Choose category color for " + (item.name || "this item"));
        colorTrigger.style.background = resolveItemColor(item.color);
        colorTrigger.addEventListener("click", function () {
          openHuePicker(colorTrigger, item.color || "grey", function (picked) {
            item.color = picked;
            colorTrigger.style.background = resolveItemColor(picked);
            onChange();
          });
        });
        row.appendChild(colorTrigger);
      }

      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "li-name";
      nameInput.placeholder = placeholder;
      nameInput.value = item.name;
      nameInput.maxLength = 60;
      nameInput.setAttribute("aria-label", "Line item name");
      nameInput.addEventListener("input", function () {
        item.name = nameInput.value;
        onChange();
      });
      row.appendChild(nameInput);

      var amtWrap = document.createElement("div");
      amtWrap.className = "input-prefix li-amount";
      amtWrap.innerHTML = "<span>$</span>";
      var amtInput = document.createElement("input");
      amtInput.type = "number";
      amtInput.min = "0";
      amtInput.step = "10";
      amtInput.value = item.amount;
      amtInput.setAttribute("aria-label", "Monthly amount");
      amtInput.addEventListener("input", function () {
        item.amount = Math.max(0, parseFloat(amtInput.value) || 0);
        onChange();
      });
      amtWrap.appendChild(amtInput);
      row.appendChild(amtWrap);

      var removeBtn = makeRemoveButton("Remove line item", function () {
        items.splice(items.indexOf(item), 1);
        renderLineItems(container, items, placeholder, onChange, includeColor);
        onChange();
      });
      row.appendChild(removeBtn);

      container.appendChild(row);
    });
  }

  function renderIncomeList() { renderLineItems(incomeListEl, budgetState.incomeItems, "e.g. Salary", recomputeBudget, false); }
  function renderExpenseList() { renderLineItems(expenseListEl, budgetState.expenseItems, "e.g. Rent", recomputeBudget, true); }
  function renderSavingsList() { renderLineItems(savingsListEl, budgetState.savingsItems, "e.g. 401k", recomputeBudget, true); }

  $("addIncome").addEventListener("click", function () {
    budgetState.incomeItems.push({ name: "", amount: 0 });
    renderIncomeList();
    recomputeBudget();
  });
  $("addExpense").addEventListener("click", function () {
    budgetState.expenseItems.push({ name: "", amount: 0, color: "grey" });
    renderExpenseList();
    recomputeBudget();
  });
  $("addSavings").addEventListener("click", function () {
    budgetState.savingsItems.push({ name: "", amount: 0, color: "grey" });
    renderSavingsList();
    recomputeBudget();
  });

  $("hourlyRate").addEventListener("input", function (e) {
    budgetState.hourlyRate = Math.max(0, parseFloat(e.target.value) || 0);
    recomputeBudget();
  });
  $("hoursPerYear").addEventListener("input", function (e) {
    budgetState.hoursPerYear = Math.max(0, parseFloat(e.target.value) || 0);
    recomputeBudget();
  });
  $("savingsGoalPct").addEventListener("input", function (e) {
    budgetState.savingsGoalPct = clamp(parseFloat(e.target.value) || 0, 0, 100);
    recomputeBudget();
  });

  $("leftoverColorTrigger").addEventListener("click", function () {
    var trigger = this;
    openHuePicker(trigger, budgetState.leftoverColor, function (picked) {
      budgetState.leftoverColor = picked;
      recomputeBudget();
    });
  });

  $("resetAll").addEventListener("click", function () {
    var pageLabel = currentPage === "investment" ? "the investment projection" : "the budget tracker";
    var ok = window.confirm("Reset " + pageLabel + "'s inputs and layout to their defaults? This clears your saved data for this page (your color theme is kept).");
    if (!ok) return;
    if (currentPage === "investment") {
      removeStorage(STATE_KEY);
      removeStorage(CANVAS_KEY);
    } else {
      removeStorage(BUDGET_STATE_KEY);
      removeStorage(BUDGET_CANVAS_KEY);
    }
    location.reload();
  });

  // ---- Backup: export all localStorage keys to JSON, or restore them from a file ----

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportBackup() {
    var payload = {
      schema: 1,
      exportedAt: new Date().toISOString(),
      theme: readStorage(THEME_KEY),
      investment: readJSON(STATE_KEY),
      investmentLayout: readJSON(CANVAS_KEY),
      budget: readJSON(BUDGET_STATE_KEY),
      budgetLayout: readJSON(BUDGET_CANVAS_KEY)
    };
    downloadFile("t-finance-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(payload, null, 2), "application/json");
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (err) { window.alert("That file isn't valid JSON."); return; }
      if (!data || typeof data !== "object") { window.alert("That file isn't a valid backup."); return; }
      if (!window.confirm("Import this backup? It will replace your current investment and budget data.")) return;
      if (typeof data.theme === "string") writeStorage(THEME_KEY, data.theme);
      if (data.investment) writeStorage(STATE_KEY, JSON.stringify(data.investment));
      if (data.investmentLayout) writeStorage(CANVAS_KEY, JSON.stringify(data.investmentLayout));
      if (data.budget) writeStorage(BUDGET_STATE_KEY, JSON.stringify(data.budget));
      if (data.budgetLayout) writeStorage(BUDGET_CANVAS_KEY, JSON.stringify(data.budgetLayout));
      location.reload();
    };
    reader.readAsText(file);
  }

  var backupDropdown = makeDropdown($("backupPicker"), $("backupTrigger"), $("backupMenu"));
  $("exportBackupBtn").addEventListener("click", function () { exportBackup(); backupDropdown.close(); });
  $("importBackupBtn").addEventListener("click", function () { backupDropdown.close(); $("importFileInput").click(); });
  $("importFileInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = "";
  });

  // ---- Projection math: month-by-month compounding, then optional inflation deflation ----

  function weightedRates() {
    var enabled = state.etfs.filter(function (e) { return e.enabled && e.pct > 0; });
    var sum = enabled.reduce(function (s, e) { return s + e.pct; }, 0);
    if (sum <= 0) return { totalRate: 0, divRate: 0, priceRate: 0, sum: 0 };
    var totalRate = enabled.reduce(function (s, e) { return s + (e.pct / sum) * e.ret; }, 0) / 100;
    var divRate = enabled.reduce(function (s, e) { return s + (e.pct / sum) * (e.div || 0); }, 0) / 100;
    return { totalRate: totalRate, divRate: divRate, priceRate: totalRate - divRate, sum: sum };
  }

  function contributionForMonth(month) {
    var applicable = state.phases[0];
    for (var i = 0; i < state.phases.length; i++) {
      if (state.phases[i].from <= month) applicable = state.phases[i];
    }
    return applicable.amount;
  }

  function computeProjection() {
    var wr = weightedRates();
    var reinvest = !!state.reinvestDividends;
    var effectiveRate = reinvest ? wr.totalRate : wr.priceRate;
    var monthlyRate = Math.pow(1 + effectiveRate, 1 / 12) - 1;
    var monthlyDivRate = Math.pow(1 + wr.divRate, 1 / 12) - 1;
    var totalMonths = state.years * 12;

    var balance = state.startingCapital;
    var cumContrib = 0;
    var yearContrib = 0;
    var divCash = 0;
    var points = [{
      year: 0, month: 0,
      principal: state.startingCapital,
      contributedCum: 0,
      growth: 0,
      dividends: 0,
      total: state.startingCapital,
      contribThisYear: 0
    }];

    for (var m = 1; m <= totalMonths; m++) {
      var c = contributionForMonth(m);
      if (!reinvest) { divCash += balance * monthlyDivRate; }
      balance = balance * (1 + monthlyRate) + c;
      cumContrib += c;
      yearContrib += c;
      if (m % 12 === 0) {
        var principal = state.startingCapital + cumContrib;
        var growth = balance - principal;
        var dividends = reinvest ? 0 : divCash;
        points.push({
          year: m / 12, month: m,
          principal: principal,
          contributedCum: cumContrib,
          growth: growth,
          dividends: dividends,
          total: balance + dividends,
          contribThisYear: yearContrib
        });
        yearContrib = 0;
      }
    }

    var inflationAdjusted = !!state.adjustInflation && state.inflationRate > 0;
    if (inflationAdjusted) {
      var inflation = state.inflationRate / 100;
      points = points.map(function (p) {
        var deflator = Math.pow(1 + inflation, p.year);
        return {
          year: p.year, month: p.month,
          principal: p.principal / deflator,
          contributedCum: p.contributedCum / deflator,
          growth: p.growth / deflator,
          dividends: p.dividends / deflator,
          total: p.total / deflator,
          contribThisYear: p.contribThisYear / deflator
        };
      });
    }

    return {
      points: points,
      monthlyRate: monthlyRate,
      annualRate: wr.totalRate,
      priceRate: wr.priceRate,
      divRate: wr.divRate,
      allocSum: wr.sum,
      reinvest: reinvest,
      inflationAdjusted: inflationAdjusted,
      inflationRate: state.inflationRate
    };
  }

  // ---- Rendering investment results: alloc summary, stats, legend, table, CSV export ----

  function renderAllocTotal(result) {
    var sum = result.allocSum;
    var ok = Math.abs(sum - 100) < 0.05;
    allocTotalEl.classList.toggle("warn", !ok);
    if (sum === 0) {
      allocTotalEl.textContent = "No ETFs selected — select at least one to project growth.";
    } else if (ok) {
      allocTotalEl.textContent = "Allocated: 100% • blended est. return " + fmtPct(result.annualRate * 100) + "/yr (incl. " + fmtPct(result.divRate * 100) + " dividend yield)";
    } else {
      allocTotalEl.textContent = "Allocated: " + Math.round(sum * 10) / 10 + "% • " + Math.round((100 - sum) * 10) / 10 + "% left unallocated (blended est. " + fmtPct(result.annualRate * 100) + "/yr on the invested portion)";
    }
  }

  // Shared by the investment and budget pages' stat rows: { cls, label, value, sub?, delta?, deltaDanger? }[].
  function renderStatTiles(container, tiles) {
    container.innerHTML = "";
    tiles.forEach(function (t) {
      var tile = document.createElement("div");
      tile.className = "stat-tile" + (t.cls ? " " + t.cls : "");
      tile.innerHTML = '<p class="stat-label"></p><p class="stat-value"></p>';
      tile.querySelector(".stat-label").textContent = t.label;
      tile.querySelector(".stat-value").textContent = t.value;
      if (t.sub) {
        var sub = document.createElement("p");
        sub.className = "stat-sub";
        sub.textContent = t.sub;
        tile.appendChild(sub);
      }
      if (t.delta) {
        var delta = document.createElement("p");
        delta.className = "stat-delta" + (t.deltaDanger ? " danger" : "");
        delta.textContent = (t.deltaDanger ? "⚠ " : "↑ ") + t.delta;
        tile.appendChild(delta);
      }
      container.appendChild(tile);
    });
  }

  function renderStats(result) {
    var last = result.points[result.points.length - 1];
    var contributedTotal = last.contributedCum;
    var growthPct = last.total > 0 ? (last.growth / last.total) * 100 : 0;

    var tiles = [
      {
        cls: "hero",
        label: "Final balance • year " + state.years,
        value: fmtFull.format(last.total),
        sub: (result.reinvest
          ? "Blended est. return " + fmtPct(result.annualRate * 100) + " / yr (dividends reinvested)"
          : "Est. price return " + fmtPct(result.priceRate * 100) + " / yr + " + fmtPct(result.divRate * 100) + " / yr in dividends paid out"
        ) + (result.inflationAdjusted ? " • shown in today's dollars (" + fmtPct(result.inflationRate) + "/yr inflation)" : "")
      },
      {
        cls: "",
        label: "Total contributed",
        value: fmtFull.format(last.principal),
        sub: "Starting capital + " + fmtFull.format(contributedTotal) + " contributed"
      },
      {
        cls: "",
        label: result.reinvest ? "Total growth" : "Price growth",
        value: fmtFull.format(last.growth),
        delta: fmtPct(growthPct) + " of final balance"
      }
    ];

    if (!result.reinvest) {
      tiles.push({
        cls: "",
        label: "Dividends received",
        value: fmtFull.format(last.dividends),
        sub: "Paid out, not reinvested — assumed to sit in cash"
      });
    }

    renderStatTiles(statRow, tiles);
  }

  function renderLegend(result) {
    legendEl.innerHTML = "";
    var items = [
      { color: "var(--series-principal)", label: "Contributed to date" },
      { color: "var(--series-growth)", label: result.reinvest ? "Growth" : "Price growth" }
    ];
    if (!result.reinvest) {
      items.push({ color: "var(--series-dividend)", label: "Dividends (cash)" });
    }
    items.forEach(function (it) {
      var elx = document.createElement("span");
      elx.className = "legend-item";
      var sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = it.color;
      elx.appendChild(sw);
      elx.appendChild(document.createTextNode(it.label));
      legendEl.appendChild(elx);
    });
  }

  function renderTable(result) {
    tableBody.innerHTML = "";
    result.points.forEach(function (p) {
      if (p.year === 0) return;
      var tr = document.createElement("tr");
      var divCell = result.reinvest ? '<span class="muted-cell">reinvested</span>' : fmtFull.format(p.dividends);
      tr.innerHTML =
        "<td>" + p.year + "</td>" +
        "<td>" + fmtFull.format(p.contribThisYear) + "</td>" +
        "<td>" + fmtFull.format(p.contributedCum) + "</td>" +
        '<td class="growth">' + fmtFull.format(p.growth) + "</td>" +
        '<td class="growth">' + divCell + "</td>" +
        '<td class="total">' + fmtFull.format(p.total) + "</td>";
      tableBody.appendChild(tr);
    });
  }

  function exportTableCsv() {
    if (!lastResult) return;
    var rows = [["Year", "Contributed this year", "Total contributed", "Growth", "Dividends", "Total value"]];
    lastResult.points.forEach(function (p) {
      if (p.year === 0) return;
      rows.push([p.year, p.contribThisYear.toFixed(2), p.contributedCum.toFixed(2), p.growth.toFixed(2), p.dividends.toFixed(2), p.total.toFixed(2)]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (cell) {
        var s = String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
    downloadFile("investment-projection.csv", csv, "text/csv");
  }
  $("exportCsvBtn").addEventListener("click", exportTableCsv);

  // ---- Chart: hand-built SVG line/area chart, no library. W/H recomputed per render. ----

  var NS = "http://www.w3.org/2000/svg";
  var W = 760, H = 380;
  var PAD = { top: 18, right: 20, bottom: 30, left: 66 };
  var plotW = W - PAD.left - PAD.right;
  var plotH = H - PAD.top - PAD.bottom;

  function updateChartDims() {
    var rect = chartWrap.getBoundingClientRect();
    W = Math.max(240, Math.round(rect.width) || 760);
    H = Math.max(160, Math.round(rect.height) || 380);
    plotW = W - PAD.left - PAD.right;
    plotH = H - PAD.top - PAD.bottom;
    chartSvg.setAttribute("viewBox", "0 0 " + W + " " + H);
  }

  function niceStep(maxVal, ticks) {
    if (maxVal <= 0) return 1;
    var rough = maxVal / ticks;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    var residual = rough / magnitude;
    var niceResidual = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
    return niceResidual * magnitude;
  }

  function xScale(yearIdx, years) { return PAD.left + (yearIdx / years) * plotW; }
  function yScale(val, maxVal) { return PAD.top + plotH - (val / maxVal) * plotH; }

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // chartWrap persists across renders, so listeners are registered once here
  // (not inside renderChart) and delegate to the latest render via chartNav.
  var chartNav = { showAtYear: function () {}, hide: function () {}, years: state.years };
  chartWrap.addEventListener("focus", function () { chartNav.showAtYear(chartWrap._focusYear || chartNav.years); });
  chartWrap.addEventListener("blur", function () { chartNav.hide(); });
  chartWrap.addEventListener("keydown", function (e) {
    var focusYear = chartWrap._focusYear != null ? chartWrap._focusYear : chartNav.years;
    if (e.key === "ArrowLeft") { focusYear = clamp(focusYear - 1, 0, chartNav.years); chartNav.showAtYear(focusYear); chartWrap._focusYear = focusYear; e.preventDefault(); }
    else if (e.key === "ArrowRight") { focusYear = clamp(focusYear + 1, 0, chartNav.years); chartNav.showAtYear(focusYear); chartWrap._focusYear = focusYear; e.preventDefault(); }
  });

  // Rebuilds the whole chart SVG each call: gridlines, stacked area/line
  // series, end markers, then an invisible hit-rect for the hover tooltip.
  function renderChart(result) {
    updateChartDims();
    chartSvg.innerHTML = "";
    var points = result.points;
    var years = state.years;
    var maxTotal = points.reduce(function (m, p) { return Math.max(m, p.total); }, 0);
    if (maxTotal <= 0) maxTotal = 1;
    var step = niceStep(maxTotal, 5);
    var topTick = Math.ceil((maxTotal * 1.02) / step) * step;
    if (topTick <= 0) topTick = step;

    for (var v = 0; v <= topTick + 0.001; v += step) {
      var y = yScale(v, topTick);
      chartSvg.appendChild(el("line", { class: "grid-line", x1: PAD.left, x2: W - PAD.right, y1: y, y2: y }));
      var label = el("text", { class: "tick-label", x: PAD.left - 10, y: y + 4, "text-anchor": "end" });
      label.textContent = fmtCompact.format(v);
      chartSvg.appendChild(label);
    }

    chartSvg.appendChild(el("line", { class: "axis-line", x1: PAD.left, x2: W - PAD.right, y1: PAD.top + plotH, y2: PAD.top + plotH }));
    var tickInterval = years <= 10 ? 1 : years <= 20 ? 2 : years <= 40 ? 5 : 10;
    for (var yr = 0; yr <= years; yr++) {
      if (yr !== 0 && yr !== years && yr % tickInterval !== 0) continue;
      var x = xScale(yr, years);
      var xl = el("text", { class: "tick-label", x: x, y: PAD.top + plotH + 20, "text-anchor": yr === years ? "end" : (yr === 0 ? "start" : "middle") });
      xl.textContent = "Yr " + yr;
      chartSvg.appendChild(xl);
    }

    var reinvest = result.reinvest;
    var principalTop = points.map(function (p) { return [xScale(p.year, years), yScale(p.principal, topTick)]; });
    var balanceTop = points.map(function (p) { return [xScale(p.year, years), yScale(p.principal + p.growth, topTick)]; });
    var grandTotalTop = points.map(function (p) { return [xScale(p.year, years), yScale(p.total, topTick)]; });
    var baseline = yScale(0, topTick);

    function pathFrom(coords) {
      return coords.map(function (c, i) { return (i === 0 ? "M" : "L") + c[0].toFixed(2) + "," + c[1].toFixed(2); }).join(" ");
    }
    function stackedAreaD(topCoords, bottomCoords) {
      return pathFrom(topCoords) + " " +
        bottomCoords.slice().reverse().map(function (c) { return "L" + c[0].toFixed(2) + "," + c[1].toFixed(2); }).join(" ") + " Z";
    }

    var principalAreaD = pathFrom(principalTop) +
      " L " + principalTop[principalTop.length - 1][0].toFixed(2) + "," + baseline.toFixed(2) +
      " L " + principalTop[0][0].toFixed(2) + "," + baseline.toFixed(2) + " Z";
    chartSvg.appendChild(el("path", { d: principalAreaD, fill: "var(--series-principal)", "fill-opacity": "0.14", stroke: "none" }));

    chartSvg.appendChild(el("path", { d: stackedAreaD(balanceTop, principalTop), fill: "var(--series-growth)", "fill-opacity": "0.16", stroke: "none" }));

    if (!reinvest) {
      chartSvg.appendChild(el("path", { d: stackedAreaD(grandTotalTop, balanceTop), fill: "var(--series-dividend)", "fill-opacity": "0.16", stroke: "none" }));
    }

    chartSvg.appendChild(el("path", { d: pathFrom(principalTop), fill: "none", stroke: "var(--series-principal)", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
    chartSvg.appendChild(el("path", { d: pathFrom(balanceTop), fill: "none", stroke: "var(--series-growth)", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (!reinvest) {
      chartSvg.appendChild(el("path", { d: pathFrom(grandTotalTop), fill: "none", stroke: "var(--series-dividend)", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }

    var lastPrincipal = principalTop[principalTop.length - 1];
    var lastBalance = balanceTop[balanceTop.length - 1];
    var lastGrandTotal = grandTotalTop[grandTotalTop.length - 1];
    var endMarkers = [
      { pt: lastPrincipal, color: "var(--series-principal)" },
      { pt: lastBalance, color: "var(--series-growth)" }
    ];
    if (!reinvest) endMarkers.push({ pt: lastGrandTotal, color: "var(--series-dividend)" });
    endMarkers.forEach(function (m) {
      chartSvg.appendChild(el("circle", { cx: m.pt[0], cy: m.pt[1], r: 5, fill: m.color, stroke: "var(--chart-surface)", "stroke-width": 2 }));
    });
    var labelPt = reinvest ? lastBalance : lastGrandTotal;
    var endLabel = el("text", { class: "end-label", x: clamp(labelPt[0] - 4, PAD.left, W - PAD.right - 4), y: labelPt[1] - 12, "text-anchor": "end" });
    endLabel.textContent = fmtCompact.format(points[points.length - 1].total);
    chartSvg.appendChild(endLabel);

    var crosshair = el("line", { class: "crosshair-line", x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + plotH, opacity: 0 });
    var hoverPrincipalDot = el("circle", { r: 4, fill: "var(--series-principal)", stroke: "var(--chart-surface)", "stroke-width": 2, opacity: 0 });
    var hoverBalanceDot = el("circle", { r: 4, fill: "var(--series-growth)", stroke: "var(--chart-surface)", "stroke-width": 2, opacity: 0 });
    var hoverDivDot = el("circle", { r: 4, fill: "var(--series-dividend)", stroke: "var(--chart-surface)", "stroke-width": 2, opacity: 0 });
    chartSvg.appendChild(crosshair);
    chartSvg.appendChild(hoverPrincipalDot);
    chartSvg.appendChild(hoverBalanceDot);
    if (!reinvest) chartSvg.appendChild(hoverDivDot);

    var hitRect = el("rect", { x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: "transparent" });
    chartSvg.appendChild(hitRect);

    // Shows the crosshair, hover dots, and tooltip for one year.
    function showAtYear(yearIdx) {
      yearIdx = clamp(yearIdx, 0, years);
      var p = points[yearIdx];
      var x = xScale(yearIdx, years);
      crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x); crosshair.setAttribute("opacity", 1);
      hoverPrincipalDot.setAttribute("cx", x); hoverPrincipalDot.setAttribute("cy", yScale(p.principal, topTick)); hoverPrincipalDot.setAttribute("opacity", 1);
      hoverBalanceDot.setAttribute("cx", x); hoverBalanceDot.setAttribute("cy", yScale(p.principal + p.growth, topTick)); hoverBalanceDot.setAttribute("opacity", 1);
      if (!reinvest) {
        hoverDivDot.setAttribute("cx", x); hoverDivDot.setAttribute("cy", yScale(p.total, topTick)); hoverDivDot.setAttribute("opacity", 1);
      }

      tooltip.hidden = false;
      var rowsHtml =
        '<div class="tooltip-year">Year ' + p.year + '</div>' +
        '<div class="tooltip-row"><span class="tooltip-key"><span class="line-key" style="background:var(--series-principal)"></span>Contributed</span><span class="tooltip-val" data-k="principal"></span></div>' +
        '<div class="tooltip-row"><span class="tooltip-key"><span class="line-key" style="background:var(--series-growth)"></span>' + (reinvest ? "Growth" : "Price growth") + '</span><span class="tooltip-val" data-k="growth"></span></div>';
      if (!reinvest) {
        rowsHtml += '<div class="tooltip-row"><span class="tooltip-key"><span class="line-key" style="background:var(--series-dividend)"></span>Dividends</span><span class="tooltip-val" data-k="dividends"></span></div>';
      }
      rowsHtml += '<div class="tooltip-row total"><span class="tooltip-key">Total value</span><span class="tooltip-val" data-k="total"></span></div>';
      tooltip.innerHTML = rowsHtml;
      tooltip.querySelector('[data-k="principal"]').textContent = fmtFull.format(p.principal);
      tooltip.querySelector('[data-k="growth"]').textContent = fmtFull.format(p.growth);
      if (!reinvest) tooltip.querySelector('[data-k="dividends"]').textContent = fmtFull.format(p.dividends);
      tooltip.querySelector('[data-k="total"]').textContent = fmtFull.format(p.total);

      var svgRect = chartSvg.getBoundingClientRect();
      var wrapRect = chartWrap.getBoundingClientRect();
      var px = svgRect.left - wrapRect.left + (x / W) * svgRect.width;
      var py = svgRect.top - wrapRect.top + (yScale(p.total, topTick) / H) * svgRect.height;

      var tipW = tooltip.offsetWidth || 170;
      var tipH = tooltip.offsetHeight || 90;
      var gap = 14;
      var top = (py - tipH - gap >= 0) ? (py - tipH - gap) : (py + gap);
      top = clamp(top, 4, Math.max(4, wrapRect.height - tipH - 4));
      var left = clamp(px, tipW / 2 + 4, Math.max(tipW / 2 + 4, wrapRect.width - tipW / 2 - 4));
      tooltip.style.top = top + "px";
      tooltip.style.left = left + "px";
    }

    function hide() {
      crosshair.setAttribute("opacity", 0);
      hoverPrincipalDot.setAttribute("opacity", 0);
      hoverBalanceDot.setAttribute("opacity", 0);
      hoverDivDot.setAttribute("opacity", 0);
      tooltip.hidden = true;
    }

    hitRect.addEventListener("pointermove", function (e) {
      var rect = chartSvg.getBoundingClientRect();
      var relX = (e.clientX - rect.left) / rect.width * W;
      var yearIdx = Math.round(((relX - PAD.left) / plotW) * years);
      showAtYear(yearIdx);
    });
    hitRect.addEventListener("pointerleave", hide);

    // Repoint chartNav at this render's functions (see chartNav above).
    chartNav.showAtYear = showAtYear;
    chartNav.hide = hide;
    chartNav.years = years;
  }

  // ---- Budget: totals, savings-goal math, stat row, and the breakdown donut chart ----

  function computeBudget() {
    var manualIncome = budgetState.incomeItems.reduce(function (s, i) { return s + i.amount; }, 0);
    var calculatedMonthly = (budgetState.hourlyRate * budgetState.hoursPerYear) / 12;
    var totalIncome = manualIncome + calculatedMonthly;
    var totalExpenses = budgetState.expenseItems.reduce(function (s, i) { return s + i.amount; }, 0);
    var totalSavings = budgetState.savingsItems.reduce(function (s, i) { return s + i.amount; }, 0);
    var leftover = totalIncome - totalExpenses - totalSavings;
    var postExpenseIncome = Math.max(totalIncome - totalExpenses, 0);
    var savingsGoalPct = clamp(budgetState.savingsGoalPct, 0, 100);
    var savingsGoalAmount = postExpenseIncome * (savingsGoalPct / 100);
    return {
      manualIncome: manualIncome,
      calculatedMonthly: calculatedMonthly,
      totalIncome: totalIncome,
      totalExpenses: totalExpenses,
      totalSavings: totalSavings,
      leftover: leftover,
      postExpenseIncome: postExpenseIncome,
      savingsGoalPct: savingsGoalPct,
      savingsGoalAmount: savingsGoalAmount
    };
  }

  function renderBudgetSubtotals(result) {
    $("incomeSubtotal").textContent = "Total income: " + fmtFull.format(result.totalIncome) + "/mo";
    $("expenseSubtotal").textContent = "Total expenses: " + fmtFull.format(result.totalExpenses) + "/mo";
    $("savingsSubtotal").textContent = "Total savings & investing: " + fmtFull.format(result.totalSavings) + "/mo";
    $("hourlyIncomeReadout").textContent = (budgetState.hourlyRate > 0 && budgetState.hoursPerYear > 0)
      ? "≈ " + fmtFull.format(result.calculatedMonthly) + "/mo from hourly pay, added to income above"
      : "Add an hourly rate and hours/year to include wage income you haven't itemized above.";

    var goalValueEl = $("savingsGoalValue");
    var goalSubEl = $("savingsGoalSub");
    var goalDeltaEl = $("savingsGoalDelta");
    if (result.postExpenseIncome <= 0) {
      goalValueEl.textContent = "—";
      goalSubEl.textContent = "No income left after expenses to base a goal on";
      goalDeltaEl.textContent = "";
      goalDeltaEl.className = "stat-delta";
    } else {
      var gap = result.totalSavings - result.savingsGoalAmount;
      var behind = gap < -0.005;
      goalValueEl.textContent = fmtFull.format(result.savingsGoalAmount) + "/mo";
      goalSubEl.textContent = result.savingsGoalPct + "% of " + fmtFull.format(result.postExpenseIncome) + " after expenses";
      goalDeltaEl.className = "stat-delta" + (behind ? " danger" : "");
      goalDeltaEl.textContent = (behind ? "⚠ " : "↑ ") +
        (behind ? fmtFull.format(-gap) + "/mo short" : fmtFull.format(gap) + "/mo ahead");
    }
  }

  function renderBudgetStats(result) {
    var over = result.leftover < 0;
    var tiles = [
      { cls: "hero", label: "Total income", value: fmtFull.format(result.totalIncome) + "/mo" },
      { cls: "", label: "Total expenses", value: fmtFull.format(result.totalExpenses) + "/mo" },
      { cls: "", label: "Savings & investing", value: fmtFull.format(result.totalSavings) + "/mo" },
      {
        cls: "",
        label: over ? "Over budget" : "Leftover",
        value: fmtFull.format(Math.abs(result.leftover)) + "/mo",
        delta: over ? "spending more than you earn" : "left after expenses & savings",
        deltaDanger: over
      }
    ];
    renderStatTiles(budgetStatRow, tiles);
  }

  function polarToXY(cx, cy, r, deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function donutArcPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
    var largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
    var p1 = polarToXY(cx, cy, rOuter, startDeg);
    var p2 = polarToXY(cx, cy, rOuter, endDeg);
    var p3 = polarToXY(cx, cy, rInner, endDeg);
    var p4 = polarToXY(cx, cy, rInner, startDeg);
    return [
      "M", p1.x.toFixed(2), p1.y.toFixed(2),
      "A", rOuter.toFixed(2), rOuter.toFixed(2), 0, largeArc, 1, p2.x.toFixed(2), p2.y.toFixed(2),
      "L", p3.x.toFixed(2), p3.y.toFixed(2),
      "A", rInner.toFixed(2), rInner.toFixed(2), 0, largeArc, 0, p4.x.toFixed(2), p4.y.toFixed(2),
      "Z"
    ].join(" ");
  }

  // One slice per line item, plus leftover. pctDenom switches to total spending
  // (not income) when over budget, so the legend and chart always agree.
  function renderBreakdownChart(result) {
    pieSvg.innerHTML = "";
    var cx = 160, cy = 160, rOuter = 130, rInner = 76;
    var income = Math.max(result.totalIncome, 0);
    var overBudget = result.leftover < 0;

    var slices = budgetState.expenseItems
      .filter(function (it) { return it.amount > 0; })
      .map(function (it) { return { label: it.name || "Expense", value: it.amount, color: resolveItemColor(it.color) }; })
      .concat(budgetState.savingsItems
        .filter(function (it) { return it.amount > 0; })
        .map(function (it) { return { label: it.name || "Savings", value: it.amount, color: resolveItemColor(it.color) }; }));
    var leftoverColor = budgetState.leftoverColor ? resolveItemColor(budgetState.leftoverColor) : "var(--series-dividend)";
    if (!overBudget && result.leftover > 0) {
      slices.push({ label: "Leftover", value: result.leftover, color: leftoverColor });
    }
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    var pctDenom = overBudget ? total : income;

    var noteEl = $("breakdownNote");
    noteEl.hidden = !overBudget;
    noteEl.textContent = overBudget
      ? "Spending exceeds income — shown as share of total spending, not income."
      : "";

    $("leftoverColorTrigger").style.background = leftoverColor;

    budgetLegendEl.innerHTML = "";
    slices.forEach(function (slice) {
      var pct = pctDenom > 0 ? (slice.value / pctDenom) * 100 : 0;
      var item = document.createElement("span");
      item.className = "legend-item";
      var sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = slice.color;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(slice.label + " "));
      var val = document.createElement("span");
      val.className = "legend-value";
      val.textContent = fmtFull.format(slice.value) + " (" + Math.round(pct) + "%)";
      item.appendChild(val);
      budgetLegendEl.appendChild(item);
    });

    if (total <= 0) {
      pieSvg.appendChild(el("circle", {
        cx: cx, cy: cy, r: (rOuter + rInner) / 2,
        fill: "none", stroke: "var(--hairline)", "stroke-width": rOuter - rInner
      }));
    } else {
      var startAngle = 0;
      slices.forEach(function (slice) {
        if (slice.value <= 0) return;
        var angle = Math.min((slice.value / total) * 360, 359.99);
        var endAngle = startAngle + angle;
        var path = el("path", {
          d: donutArcPath(cx, cy, rOuter, rInner, startAngle, endAngle),
          fill: slice.color, stroke: "var(--chart-surface)", "stroke-width": 2
        });
        path.style.cursor = "pointer";
        path.addEventListener("pointerenter", function () { path.style.opacity = "0.85"; });
        path.addEventListener("pointerleave", function () { path.style.opacity = "1"; pieTooltip.hidden = true; });
        path.addEventListener("pointermove", function (e) {
          var pct = pctDenom > 0 ? (slice.value / pctDenom) * 100 : 0;
          pieTooltip.hidden = false;
          pieTooltip.innerHTML =
            '<div class="tooltip-row total"><span class="tooltip-key" data-k="label"></span><span class="tooltip-val" data-k="amt"></span></div>' +
            '<div class="tooltip-row"><span class="tooltip-key">' + (overBudget ? "Share of spending" : "Share of income") + '</span><span class="tooltip-val" data-k="pct"></span></div>';
          pieTooltip.querySelector('[data-k="label"]').textContent = slice.label;
          pieTooltip.querySelector('[data-k="amt"]').textContent = fmtFull.format(slice.value) + "/mo";
          pieTooltip.querySelector('[data-k="pct"]').textContent = Math.round(pct) + "%";
          var wrapRect = pieWrap.getBoundingClientRect();
          var left = clamp(e.clientX - wrapRect.left, 90, Math.max(90, wrapRect.width - 90));
          var top = clamp(e.clientY - wrapRect.top - 70, 4, Math.max(4, wrapRect.height - 90));
          pieTooltip.style.left = left + "px";
          pieTooltip.style.top = top + "px";
        });
        pieSvg.appendChild(path);
        startAngle = endAngle;
      });
    }

    pieSvg.appendChild(el("text", { x: cx, y: cy - 8, "text-anchor": "middle", class: "tick-label", "font-size": "12" }))
      .textContent = "Income / mo";
    pieSvg.appendChild(el("text", { x: cx, y: cy + 18, "text-anchor": "middle", class: "end-label", "font-size": "22" }))
      .textContent = fmtCompact.format(income);
  }

  function recomputeBudget() {
    var result = computeBudget();
    renderBudgetSubtotals(result);
    renderBudgetStats(result);
    renderBreakdownChart(result);
    saveBudgetState();
  }

  // ---- Page navigation: both pages stay in the DOM; switching just toggles hidden ----

  var pageInvestmentEl = $("pageInvestment");
  var pageBudgetEl = $("pageBudget");
  var pageNavBtn = $("pageNavBtn");
  var pageNavLabel = $("pageNavLabel");
  var pageNavIcon = $("pageNavIcon");
  var currentPage = "investment";

  function showPage(page) {
    currentPage = page;
    pageInvestmentEl.hidden = page !== "investment";
    pageBudgetEl.hidden = page !== "budget";
    try { sessionStorage.setItem(PAGE_SESSION_KEY, page); } catch (err) { /* storage unavailable */ }
    if (page === "investment") {
      pageNavLabel.textContent = "Budget";
      pageNavIcon.textContent = "→";
      pageNavBtn.title = "Go to the budget tracker";
      investmentCanvasCtl.applyAllLayout();
      if (lastResult) renderChart(lastResult);
    } else {
      pageNavLabel.textContent = "Investments";
      pageNavIcon.textContent = "←";
      pageNavBtn.title = "Back to the investment projection";
      budgetCanvasCtl.applyAllLayout();
    }
  }

  pageNavBtn.addEventListener("click", function () {
    showPage(currentPage === "investment" ? "budget" : "investment");
  });

  // ---- Orchestration + initial boot sequence ----

  function recompute() {
    var result = computeProjection();
    lastResult = result;
    renderAllocTotal(result);
    renderStats(result);
    renderLegend(result);
    renderChart(result);
    renderTable(result);
    saveState();
  }

  renderPhases();
  renderEtfList();
  recompute();

  renderIncomeList();
  renderExpenseList();
  renderSavingsList();
  recomputeBudget();

  var initialPage = "investment";
  try { if (sessionStorage.getItem(PAGE_SESSION_KEY) === "budget") initialPage = "budget"; } catch (err) { /* storage unavailable */ }
  showPage(initialPage);
})();
