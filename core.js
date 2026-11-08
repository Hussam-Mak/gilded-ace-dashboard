/* Shared state, filters, aggregation and chart helpers for the Gilded Ace dashboard. */
(function () {
  "use strict";
  const D = window.DATA;
  const App = (window.App = {});

  // ---------- table helpers ----------
  const toObjects = (cols, rows) => rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  App.D = D;
  App.MM = toObjects(D.machine_month_cols, D.machine_month);
  App.ZD = toObjects(D.zone_day_cols, D.zone_day);
  App.DAILY = toObjects(D.daily_cols, D.daily);
  App.MACH = Object.fromEntries(toObjects(D.machines_cols, D.machines).map((m) => [m.machine, m]));
  App.DOWN = toObjects(D.downtime_cols, D.downtime);
  App.GUESTS = toObjects(D.guests_cols, D.guests);
  App.FNB = toObjects(D.fnb_cols, D.fnb);
  App.ZONE_NAME = Object.fromEntries(D.zones.map((z) => [z[0], z[1]]));
  App.BANK_ZONE = Object.fromEntries(D.banks.map((b) => [b[0], b[1]]));
  const MONTH_LABEL = { "2025-01": "Jan", "2025-02": "Feb", "2025-03": "Mar", "2025-04": "Apr", "2025-05": "May", "2025-06": "Jun" };
  App.MONTH_LABEL = MONTH_LABEL;

  // ---------- state ----------
  const DEFAULTS = { from: D.months[0], to: D.months[D.months.length - 1], zone: "all", bank: "all", machine: "M-1158", mf: "all", tier: "all", region: "all", age: "all" };
  App.state = Object.assign({}, DEFAULTS);
  App.defaults = DEFAULTS;

  App.inMonths = (m) => m >= App.state.from && m <= App.state.to;
  App.inDates = (d) => App.inMonths(d.slice(0, 7));
  App.areaZone = () => (App.state.bank !== "all" ? App.BANK_ZONE[App.state.bank] : App.state.zone);
  App.inArea = (row) => {
    const s = App.state;
    if (s.bank !== "all") return row.bank === s.bank;
    if (s.zone !== "all") return row.zone === s.zone;
    return true;
  };
  App.areaLabel = () => {
    const s = App.state;
    if (s.bank !== "all") return `bank ${s.bank} (${App.ZONE_NAME[App.BANK_ZONE[s.bank]]})`;
    if (s.zone !== "all") return App.ZONE_NAME[s.zone];
    return "whole floor";
  };
  App.periodLabel = () => (App.state.from === App.state.to ? MONTH_LABEL[App.state.from] : `${MONTH_LABEL[App.state.from]}–${MONTH_LABEL[App.state.to]}`) + " 2025";

  // ---------- math ----------
  const erf = (x) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  App.normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  App.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  // ---------- aggregation ----------
  const SUM_FIELDS = ["days", "avail_h", "sched_h", "occ_h", "coin", "win", "theo", "var", "spins", "hits", "exp_hits", "hit_var", "exp_coin", "faults", "carded"];
  App.SUM_FIELDS = SUM_FIELDS;
  App.derive = (o) => {
    o.hold = o.coin ? o.win / o.coin : null;
    o.theoHold = o.coin ? o.theo / o.coin : null;
    o.luckZ = o.var > 0 ? (o.win - o.theo) / Math.sqrt(o.var) : null;
    o.hitZ = o.hit_var > 0 ? (o.hits - o.exp_hits) / Math.sqrt(o.hit_var) : null;
    o.hitRate = o.spins ? o.hits / o.spins : null;
    o.pubHit = o.spins ? o.exp_hits / o.spins : null;
    o.locIdx = o.exp_coin > 0 ? o.coin / o.exp_coin : null;
    o.rate = o.avail_h > 0 ? o.coin / o.avail_h : null;
    o.availability = o.sched_h > 0 ? o.avail_h / o.sched_h : null;
    return o;
  };
  /** Machine totals for the current months and area. A machine's zone is where it spent the most days. */
  App.machineTotals = (opts = {}) => {
    const useArea = opts.area !== false;
    const by = new Map();
    for (const r of App.MM) {
      if (!App.inMonths(r.month)) continue;
      if (useArea && !App.inArea(r)) continue;
      let o = by.get(r.machine);
      if (!o) { o = { machine: r.machine, zoneDays: {}, bankDays: {} }; SUM_FIELDS.forEach((f) => (o[f] = 0)); by.set(r.machine, o); }
      SUM_FIELDS.forEach((f) => (o[f] += r[f] || 0));
      o.zoneDays[r.zone] = (o.zoneDays[r.zone] || 0) + r.days;
      o.bankDays[r.bank] = (o.bankDays[r.bank] || 0) + r.days;
    }
    const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
    return [...by.values()].map((o) => {
      o.zone = top(o.zoneDays); o.bank = top(o.bankDays);
      const meta = App.MACH[o.machine] || {};
      Object.assign(o, { manufacturer: meta.manufacturer, theme: meta.theme, volatility: meta.volatility, config: meta.config });
      return App.derive(o);
    });
  };
  App.totals = (list) => {
    const t = {}; SUM_FIELDS.forEach((f) => (t[f] = App.sum(list, (x) => x[f]))); return App.derive(t);
  };
  App.groupTotals = (list, key) => {
    const g = new Map();
    for (const x of list) { const k = x[key]; if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g.entries()].map(([k, v]) => Object.assign(App.totals(v), { key: k, n: v.length }));
  };

  /** Game-adjusted earnings index per zone for the current months (1.00 = same game's floor average). */
  App.zoneIndexByZone = () => {
    const agg = {};
    for (const r of App.MM) {
      if (!App.inMonths(r.month)) continue;
      const z = (agg[r.zone] = agg[r.zone] || { coin: 0, exp: 0, avail: 0 });
      z.coin += r.coin; z.exp += r.exp_coin; z.avail += r.avail_h;
    }
    return Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { idx: v.exp ? v.coin / v.exp : null, rate: v.avail ? v.coin / v.avail : null }]));
  };
  /** Plain-language verdict tags for one machine: [label, css class]. */
  App.verdicts = (m, zoneIdx) => {
    const tags = [];
    const leak = m.hitZ != null && Math.abs(m.hitZ) > 5;
    if (leak) tags.push(["Payout leak: inspect", "t-leak"]);
    if (m.days < 120) tags.push([`Only ${m.days} days on floor`, "t-short"]);
    const zi = zoneIdx[m.zone] && zoneIdx[m.zone].idx;
    if (zi != null && zi < 0.8) tags.push(["Quiet zone", "t-loc"]);
    if (!leak && m.luckZ != null) tags.push(Math.abs(m.luckZ) < 2 ? ["Within normal luck", "t-luck"] : ["Unlucky, within 310-machine range", "t-luck"]);
    return tags;
  };

  /** Daily coin-in for the current area: property totals for the whole floor, zone totals otherwise. */
  App.dailySeries = () => {
    const z = App.areaZone();
    if (z === "all") return App.DAILY.filter((d) => App.inDates(d.date)).map((d) => ({ date: d.date, coin: d.coin, events: d.events, holiday: d.holiday, weekday: d.weekday }));
    const meta = Object.fromEntries(App.DAILY.map((d) => [d.date, d]));
    return App.ZD.filter((r) => r.zone === z && App.inDates(r.date)).map((r) => ({ date: r.date, coin: r.coin, events: meta[r.date].events, holiday: meta[r.date].holiday, weekday: meta[r.date].weekday }));
  };

  // ---------- formatting ----------
  App.fmt = {
    usd(v, d = 0) {
      if (v == null || isNaN(v)) return "–";
      const a = Math.abs(v), s = v < 0 ? "−" : "";
      if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
      if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}K`;
      return `${s}$${a.toLocaleString("en-US", { maximumFractionDigits: d })}`;
    },
    k(v) { return v == null ? "–" : `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 1000).toLocaleString("en-US")}K`; },
    pct(v, d = 1) { return v == null || isNaN(v) ? "–" : `${(v * 100).toFixed(d)}%`; },
    z(v) { return v == null ? "–" : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}`; },
    n(v, d = 0) { return v == null ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); },
    date(d) { const [, m, day] = d.split("-"); return `${MONTH_LABEL["2025-" + m]} ${+day}`; },
  };

  // ---------- DOM helpers ----------
  App.$ = (sel) => document.querySelector(sel);
  App.el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => n.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return n;
  };
  /** Build a table from column specs: {label, value(row), cls}. Text only, never HTML. */
  App.table = (target, cols, rows, opts = {}) => {
    const t = typeof target === "string" ? App.$(target) : target;
    t.replaceChildren();
    const head = App.el("tr", {}, cols.map((c) => App.el("th", { class: c.cls || "", text: c.label })));
    const body = rows.map((r) => {
      const tr = App.el("tr", { class: (opts.rowClass ? opts.rowClass(r) : "") + (opts.onRow ? " clickable" : "") });
      if (opts.onRow) { tr.tabIndex = 0; tr.addEventListener("click", () => opts.onRow(r)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onRow(r); }); }
      cols.forEach((c) => {
        const v = c.value(r);
        const td = App.el("td", { class: (c.cls || "") + (c.tone ? " " + c.tone(r) : "") });
        if (v instanceof Node) td.append(v); else td.textContent = v;
        tr.append(td);
      });
      return tr;
    });
    t.append(App.el("thead", {}, head), App.el("tbody", {}, body));
  };
  App.kpis = (target, items) => {
    App.$(target).replaceChildren(...items.map((k) => App.el("div", { class: "kpi" }, App.el("span", { class: "l", text: k.l }), App.el("span", { class: "v", text: k.v }), App.el("span", { class: "d", text: k.d || "" }))));
  };

  // ---------- charts ----------
  const charts = {};
  App.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  App.colors = () => ({
    s1: App.css("--s1"), s2: App.css("--s2"), s3: App.css("--s3"), context: App.css("--context"), grid: App.css("--grid"), axis: App.css("--axis"),
    ink: App.css("--ink"), muted: App.css("--muted"), surface: App.css("--surface"), bad: App.css("--bad"), warn: App.css("--warn"),
    divLo: App.css("--div-lo"), divMid: App.css("--div-mid"), divHi: App.css("--div-hi"),
  });
  App.chart = (id, config) => {
    if (charts[id]) charts[id].destroy();
    const c = App.colors();
    Chart.defaults.font.family = App.css("--body") || "system-ui";
    Chart.defaults.color = c.muted;
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, config.options || {});
    config.options.plugins = Object.assign({ legend: { display: false } }, config.options.plugins || {});
    charts[id] = new Chart(document.getElementById(id), config);
    return charts[id];
  };
  App.axis = (opts = {}) => {
    const c = App.colors();
    return Object.assign({ grid: { color: c.grid }, border: { display: false }, ticks: { color: c.axis } }, opts);
  };
  App.xAxis = (opts = {}) => {
    const c = App.colors();
    return Object.assign({ grid: { display: false }, border: { color: c.grid }, ticks: { color: c.axis } }, opts);
  };
  App.mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join("");
  };
  /** Diverging color for an index around 1.0 (0.6 or lower = full low, 1.3 or higher = full high). */
  App.divColor = (v) => {
    const c = App.colors();
    if (v == null) return c.divMid;
    if (v < 1) return App.mix(c.divMid, c.divLo, Math.min(1, (1 - v) / 0.4));
    return App.mix(c.divMid, c.divHi, Math.min(1, (v - 1) / 0.3));
  };

  // ---------- views and routing ----------
  App.views = {};
  const VIEWS = ["answer", "machines", "floor", "downtime", "guests", "model", "plan"];
  App.current = "answer";
  App.show = (name, opts = {}) => {
    if (!VIEWS.includes(name)) name = "answer";
    App.current = name;
    VIEWS.forEach((v) => { App.$("#v-" + v).hidden = v !== name; });
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === name)));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    App.render();
    if (opts.focus) { const n = App.$(opts.focus); if (n) n.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else if (!opts.keepScroll) window.scrollTo({ top: 0 });
  };
  App.render = () => {
    App.syncFilters();
    const v = App.views[App.current];
    if (v) v();
  };

  // ---------- filters ----------
  const opt = (value, label, sel) => { const o = App.el("option", { value, text: label }); if (sel) o.selected = true; return o; };
  App.syncFilters = () => {
    const s = App.state;
    App.$("#f-from").replaceChildren(...D.months.map((m) => opt(m, MONTH_LABEL[m] + " 2025", m === s.from)));
    App.$("#f-to").replaceChildren(...D.months.map((m) => opt(m, MONTH_LABEL[m] + " 2025", m === s.to)));
    App.$("#f-zone").replaceChildren(opt("all", "All zones", s.zone === "all"), ...D.zones.map((z) => opt(z[0], z[1], z[0] === s.zone)));
    const banks = D.banks.filter((b) => s.zone === "all" || b[1] === s.zone);
    App.$("#f-bank").replaceChildren(opt("all", "All banks", s.bank === "all"), ...banks.map((b) => opt(b[0], `${b[0]} · ${App.ZONE_NAME[b[1]]}`, b[0] === s.bank)));
    App.$("#f-summary").textContent = `${App.periodLabel()} · ${App.areaLabel()}`;
    const back = App.$("#to-floor");
    if (back) back.href = `index.html?from=${s.from}&to=${s.to}&machine=${encodeURIComponent(s.machine)}`;
  };
  const onFilter = (key) => (e) => {
    const s = App.state; s[key] = e.target.value;
    if (key === "from" && s.from > s.to) s.to = s.from;
    if (key === "to" && s.to < s.from) s.from = s.to;
    if (key === "zone") s.bank = "all";
    if (key === "bank" && s.bank !== "all") s.zone = App.BANK_ZONE[s.bank];
    App.render();
  };
  App.setArea = (zone, bank) => { App.state.zone = zone; App.state.bank = bank; App.render(); };

  // Links from the floor page carry ?machine=&from=&to= (plain query string; safe on GitHub Pages).
  App.readQuery = () => {
    const q = new URLSearchParams(location.search);
    const m = (q.get("machine") || "").toUpperCase();
    if (App.MACH[m]) App.state.machine = m;
    for (const k of ["from", "to"]) { const v = q.get(k); if (v && D.months.includes(v)) App.state[k] = v; }
    if (App.state.from > App.state.to) App.state.to = App.state.from;
    return Boolean(App.MACH[m]);
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("v-answer")) return; // floor page runs its own setup
    const fromFloor = App.readQuery();
    ["from", "to", "zone", "bank"].forEach((k) => App.$("#f-" + k).addEventListener("change", onFilter(k)));
    App.$("#f-reset").addEventListener("click", () => { Object.assign(App.state, DEFAULTS); App.render(); });
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => App.show(t.dataset.view)));
    document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => App.show(b.dataset.goto)));
    const start = location.hash.replace("#", "");
    if (fromFloor && (start === "" || start === "machines")) App.show("machines", { focus: "#machine-detail" });
    else App.show(VIEWS.includes(start) ? start : "answer", { keepScroll: true });
    window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (h !== App.current && VIEWS.includes(h)) App.show(h); });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const rerender = () => App.render();
    if (mq.addEventListener) mq.addEventListener("change", rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });
})();
