/* Tab renderers for the Gilded Ace dashboard. Each view reads App.state and redraws its charts. */
(function () {
  "use strict";
  const A = window.App, D = A.D, F = A.fmt, $ = A.$, el = A.el;
  const HOLD = 0.0946;
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const label = (id, text) => { const n = document.getElementById(id); if (n) n.setAttribute("aria-label", text); };

  // ---------- shared pieces ----------
  const zoneIndexByZone = A.zoneIndexByZone, verdicts = A.verdicts;
  const tagList = (tags) => el("span", { style: "display:flex;flex-wrap:wrap;gap:4px" }, tags.map(([t, c]) => el("span", { class: "tag " + c, text: t })));
  const bottomTen = (list) => [...list].sort((a, b) => a.win - b.win).slice(0, 10);

  function dailyChart(id, series) {
    const c = A.colors();
    const ev = series.map((d) => (d.events ? d.coin : null));
    A.chart(id, {
      type: "line",
      data: { labels: series.map((d) => d.date), datasets: [
        { data: series.map((d) => d.coin), borderColor: c.s1, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0 },
        { data: ev, showLine: false, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: c.s2, pointBorderColor: c.surface, pointBorderWidth: 2 },
      ] },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: {
          title: (t) => { const d = series[t[0].dataIndex]; return `${F.date(d.date)} (${d.weekday})`; },
          label: (t) => `${F.usd(t.raw)} coin-in`, afterLabel: (t) => { const d = series[t.dataIndex]; return [d.events, d.holiday].filter(Boolean).join(" · "); } } } },
        scales: {
          x: A.xAxis({ ticks: { color: c.axis, autoSkip: false, maxRotation: 0, callback: (v, i) => (series[i] && series[i].date.endsWith("-01") ? F.date(series[i].date).split(" ")[0] : null) } }),
          y: A.axis({ ticks: { color: c.axis, callback: (v) => F.usd(v) } }),
        },
      },
    });
  }

  // ---------- Answer ----------
  A.views.answer = function () {
    const list = A.machineTotals();
    const t = A.totals(list);
    const lostDown = A.sum(A.DOWN.filter((r) => A.inMonths(r.month) && (A.areaZone() === "all" || r.zone === A.areaZone())), (r) => r.lost_wait_coin + r.lost_fix_coin);
    A.kpis("#answer-kpis", [
      { l: "Coin-in (all play)", v: F.usd(t.coin), d: `${list.length} machines on the floor` },
      { l: "House win vs. expected", v: F.usd(t.win), d: `expected ${F.usd(t.theo)} · luck ${F.usd(t.win - t.theo)}` },
      { l: "Observed hold", v: F.pct(t.hold, 2), d: `configured ${F.pct(t.theoHold, 2)}` },
      { l: "Machine availability", v: F.pct(t.availability, 2), d: `${F.usd(lostDown)} wagers lost to faults` },
    ]);
    const zi = zoneIndexByZone();
    const b10 = bottomTen(list);
    const withinLuck = b10.filter((m) => m.luckZ != null && Math.abs(m.luckZ) < 2.5 && !(Math.abs(m.hitZ) > 5)).length;
    const quiet = b10.filter((m) => zi[m.zone] && zi[m.zone].idx < 0.8).length;
    const leaks = list.filter((m) => m.hitZ != null && Math.abs(m.hitZ) > 5);
    const b40 = zi["Z-B40"];
    const card = (tagT, tagC, big, text, goto) => el("div", { class: "why" }, el("span", { class: "tag " + tagC, text: tagT }), el("span", { class: "big", text: big }), el("p", { class: "small", text }),
      el("button", { class: "btn link", type: "button", text: "See the evidence", onclick: goto }));
    $("#answer-trio").replaceChildren(
      card("Luck", "t-luck", `${withinLuck} of ${b10.length}`, `of the lowest earners in this selection are within the range luck alone produces across 310 machines.`, () => A.show("machines", { focus: "#t-bottom" })),
      card("Location", "t-loc", `${quiet} of ${b10.length}`, `sit in a zone earning under 0.8× the same games elsewhere. Back Forty runs at ${b40 ? b40.idx.toFixed(2) : "–"}×.`, () => A.show("floor")),
      card("Leak", "t-leak", leaks.length ? leaks.map((m) => m.machine).join(", ") : "None here", leaks.length ? `pays out on ${F.pct(leaks[0].hitRate)} of spins against a published ${F.pct(leaks[0].pubHit)}. Luck cannot produce that gap.` : "No machine in this selection fails the hit-rate test. Widen the filters to see M-1158.",
        () => { A.state.machine = "M-1158"; A.show("machines", { focus: "#machine-detail" }); }),
    );
    const s = A.dailySeries();
    dailyChart("c-answer-daily", s);
    const avg = A.sum(s, (d) => d.coin) / (s.length || 1);
    $("#answer-daily-cap").textContent = `${A.areaLabel()[0].toUpperCase() + A.areaLabel().slice(1)}, ${A.periodLabel()}: average ${F.usd(avg)} a day.${A.state.bank !== "all" ? " Daily figures are shown for the bank's zone." : ""}`;
    label("c-answer-daily", `Daily coin-in for ${A.areaLabel()}, ${A.periodLabel()}, averaging ${F.usd(avg)} a day`);
  };

  // ---------- Machines ----------
  A.views.machines = function () {
    const c = A.colors();
    const list = A.machineTotals();
    const zi = zoneIndexByZone();
    const b10 = bottomTen(list);
    const b10set = new Set(b10.map((m) => m.machine));
    A.table("#t-bottom", [
      { label: "Machine", cls: "nw", value: (m) => m.machine },
      { label: "Zone", value: (m) => A.ZONE_NAME[m.zone] },
      { label: "Game", value: (m) => `${m.theme} (${m.volatility})` },
      { label: "Days", cls: "r", value: (m) => m.days },
      { label: "House win", cls: "r", value: (m) => F.usd(m.win) },
      { label: "Expected", cls: "r", value: (m) => F.usd(m.theo) },
      { label: "Luck score", cls: "r", value: (m) => F.z(m.luckZ), tone: (m) => (Math.abs(m.luckZ) > 3 ? "neg" : "") },
      { label: "Hit-rate score", cls: "r", value: (m) => F.z(m.hitZ), tone: (m) => (Math.abs(m.hitZ) > 5 ? "neg" : "") },
      { label: "Zone index", cls: "r", value: (m) => (zi[m.zone] ? zi[m.zone].idx.toFixed(2) : "–") },
      { label: "Verdict", value: (m) => tagList(verdicts(m, zi)) },
    ], b10, { onRow: (m) => { A.state.machine = m.machine; A.views.machines(); $("#machine-detail").scrollIntoView({ behavior: "smooth" }); }, rowClass: (m) => (m.machine === A.state.machine ? "sel" : "") });

    // histogram
    const zs = list.map((m) => m.luckZ).filter((z) => z != null);
    const lo = -5, step = 0.5, bins = [];
    for (let b = lo; b < 3.5; b += step) bins.push(b);
    const counts = bins.map((b, i) => zs.filter((z) => (i === 0 ? z < b + step : z >= b && z < b + step)).length);
    counts[counts.length - 1] += zs.filter((z) => z >= bins[bins.length - 1] + step).length;
    const exp = bins.map((b, i) => zs.length * ((i === bins.length - 1 ? 1 : A.normCdf(b + step)) - (i === 0 ? 0 : A.normCdf(b))));
    const fmtB = (v) => (v < 0 ? "−" : "") + Math.abs(v);
    A.chart("c-luck-hist", {
      data: { labels: bins.map((b) => `${fmtB(b)} to ${fmtB(b + step)}`), datasets: [
        { type: "bar", data: counts, backgroundColor: bins.map((b) => (b < -3 || b >= 3 ? c.s2 : c.s1)), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", categoryPercentage: 0.92, barPercentage: 0.95, order: 2 },
        { type: "line", data: exp, borderColor: c.axis, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.35, order: 1 },
      ] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { title: (t) => `Luck score ${t[0].label}`, label: (t) => (t.datasetIndex === 0 ? `${t.raw} machines` : `Expected by chance: ${t.raw.toFixed(1)}`) } } },
        scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: false, maxRotation: 0, callback: (v, i) => (Number.isInteger(bins[i]) ? fmtB(bins[i]) : null) } }), y: A.axis({ min: 0 }) } },
    });
    const beyond2 = zs.filter((z) => Math.abs(z) > 2).length, beyond3 = list.filter((m) => m.luckZ != null && Math.abs(m.luckZ) > 3);
    $("#luck-cap").textContent = `${zs.length} machines. ${beyond2} lie beyond ±2 (pure chance predicts about ${(zs.length * 0.0455).toFixed(0)}). Beyond ±3: ${beyond3.length ? beyond3.map((m) => `${m.machine} (${F.z(m.luckZ)})`).join(", ") : "none"}.`;
    label("c-luck-hist", `Histogram of ${zs.length} machine luck scores; ${beyond2} beyond plus or minus 2`);

    // scatter
    const pt = (m) => ({ x: m.theo / 1000, y: m.win / 1000, m });
    const maxV = Math.max(10, ...list.map((m) => Math.max(m.theo, m.win) / 1000)) * 1.05;
    A.chart("c-scatter", {
      type: "scatter",
      data: { datasets: [
        { data: list.filter((m) => !b10set.has(m.machine)).map(pt), backgroundColor: c.context, pointRadius: 3.5, pointHoverRadius: 6, pointHitRadius: 6 },
        { data: b10.map(pt), backgroundColor: c.s2, pointRadius: 5, pointHoverRadius: 7, pointHitRadius: 8, borderColor: c.surface, borderWidth: 2 },
        { type: "line", data: [{ x: 0, y: 0 }, { x: maxV, y: maxV }], borderColor: c.axis, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0 },
      ] },
      options: { plugins: { tooltip: { filter: (i) => i.datasetIndex < 2, callbacks: { title: (t) => `${t[0].raw.m.machine} · ${A.ZONE_NAME[t[0].raw.m.zone]}`, label: (t) => [`Expected ${F.usd(t.raw.m.theo)}, actual ${F.usd(t.raw.m.win)}`, `Luck score ${F.z(t.raw.m.luckZ)}`] } } },
        onClick: (e, items) => { const it = items.find((i) => i.datasetIndex < 2); if (it) { A.state.machine = it.element.$context.raw.m.machine; A.views.machines(); } },
        scales: { x: A.axis({ min: 0, max: maxV, title: { display: true, text: "Expected house win ($K)", color: c.axis } }), y: A.axis({ min: Math.min(0, ...list.map((m) => m.win / 1000)), max: maxV, title: { display: true, text: "Actual house win ($K)", color: c.axis } }) } },
    });

    // machine detail
    const dl = $("#m-list");
    if (!dl.childElementCount) dl.append(...Object.keys(A.MACH).sort().map((id) => el("option", { value: id })));
    const open = () => {
      const v = $("#m-search").value.trim().toUpperCase();
      if (!v) { $("#m-error").textContent = "Enter a machine ID, such as M-1158."; return; }
      if (!A.MACH[v]) { $("#m-error").textContent = `No machine ${v} in the data. IDs look like M-1158.`; return; }
      $("#m-error").textContent = ""; A.state.machine = v; A.views.machines();
    };
    const btn = $("#m-open");
    if (!btn.dataset.bound) {
      btn.addEventListener("click", open);
      $("#m-search").addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      $("#m-search").addEventListener("input", () => ($("#m-error").textContent = ""));
      btn.dataset.bound = "1";
    }
    machineDetail(A.state.machine);
  };

  function machineDetail(id) {
    const c = A.colors();
    const meta = A.MACH[id];
    const rows = A.MM.filter((r) => r.machine === id && A.inMonths(r.month));
    const head = $("#m-head");
    if (!meta || !rows.length) { head.replaceChildren(el("p", { class: "note-banner", text: `${id} was not on the floor in ${A.periodLabel()}.` })); return; }
    const t = A.totals(rows);
    head.replaceChildren(
      el("h3", { text: `${id} · ${meta.theme} · ${meta.manufacturer}` }),
      el("p", { class: "cap", text: `${A.ZONE_NAME[rows[rows.length - 1].zone]} · ${meta.volatility} volatility · configured payout ${F.pct(meta.rtp, 0)} · ${t.days} days on floor in ${A.periodLabel()}` }),
      el("div", { class: "kpis" },
        [["Coin-in", F.usd(t.coin)], ["House win / expected", `${F.usd(t.win)} / ${F.usd(t.theo)}`], ["Luck score", F.z(t.luckZ)], ["Hit rate / published", `${F.pct(t.hitRate, 2)} / ${F.pct(t.pubHit, 2)}`], ["Hit-rate score", F.z(t.hitZ)], ["Availability", F.pct(t.availability, 2)]]
          .map(([l, v]) => el("div", { class: "kpi" }, el("span", { class: "l", text: l }), el("span", { class: "v", text: v })))),
    );
    $("#m-search").value = id;
    const labels = rows.map((r) => A.MONTH_LABEL[r.month]);
    const pct = (v) => +(v * 100).toFixed(2);
    const rng = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(1, (hi - lo) * 0.3); return { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) }; };
    const hit = rows.map((r) => pct(r.hits / r.spins)), pub = rows.map((r) => pct(r.exp_hits / r.spins));
    A.chart("c-m-hit", { type: "line", data: { labels, datasets: [
      { data: hit, borderColor: c.s2, backgroundColor: c.s2, borderWidth: 2, pointRadius: 4, pointBorderColor: c.surface, pointBorderWidth: 2 },
      { data: pub, borderColor: c.s1, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
    ] }, options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (x) => `${x.datasetIndex ? "Published" : id}: ${x.raw.toFixed(2)}%` } } }, scales: { x: A.xAxis(), y: A.axis(Object.assign(rng(hit.concat(pub)), { ticks: { color: c.axis, callback: (v) => v + "%" } })) } } });
    const hold = rows.map((r) => pct(r.win / r.coin)), cfg = rows.map((r) => pct(r.theo / r.coin));
    A.chart("c-m-hold", { type: "line", data: { labels, datasets: [
      { data: hold, borderColor: c.s2, backgroundColor: c.s2, borderWidth: 2, pointRadius: 4, pointBorderColor: c.surface, pointBorderWidth: 2 },
      { data: cfg, borderColor: c.s1, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
    ] }, options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (x) => `${x.datasetIndex ? "Configured" : "Observed"}: ${x.raw.toFixed(1)}%` } } }, scales: { x: A.xAxis(), y: A.axis(Object.assign(rng(hold.concat(cfg)), { ticks: { color: c.axis, callback: (v) => v + "%" } })) } } });
    label("c-m-hit", `${id} monthly hit rate ${hit.join(", ")} percent against published ${pub[0]} percent`);
  }

  // ---------- Floor ----------
  A.views.floor = function () {
    const c = A.colors();
    floorMap();
    const zi = zoneIndexByZone();
    const zones = D.zones.map((z) => ({ id: z[0], name: z[1], idx: zi[z[0]] ? zi[z[0]].idx : null })).filter((z) => z.idx != null).sort((a, b) => b.idx - a.idx);
    const sel = A.areaZone();
    A.chart("c-zone-index", { type: "bar", data: { labels: zones.map((z) => z.name), datasets: [{ data: zones.map((z) => +z.idx.toFixed(3)), backgroundColor: zones.map((z) => A.divColor(z.idx)), borderColor: zones.map((z) => (z.id === sel ? c.ink : "transparent")), borderWidth: 2, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "left", maxBarThickness: 22 }] },
      options: { indexAxis: "y", plugins: { tooltip: { callbacks: { label: (t) => `${t.raw.toFixed(2)}× the same game elsewhere` } } }, onClick: (e, it) => { if (it.length) A.setArea(zones[it[0].index].id, "all"); },
        scales: { x: A.axis({ min: 0, max: 1.4, ticks: { color: c.axis, callback: (v) => v.toFixed(1) + "×" } }), y: A.xAxis({ ticks: { color: c.ink } }) } } });
    label("c-zone-index", "Zone index: " + zones.map((z) => `${z.name} ${z.idx.toFixed(2)}`).join(", "));

    // closure natural experiment (ratio of Back Forty rate to rest of floor excluding High-Limit)
    const days = {};
    for (const r of A.ZD) {
      if (!A.inDates(r.date) || r.zone === "Z-HL") continue;
      const d = (days[r.date] = days[r.date] || { b: [0, 0], o: [0, 0] });
      const k = r.zone === "Z-B40" ? "b" : "o"; d[k][0] += r.coin; d[k][1] += r.avail_h;
    }
    const dates = Object.keys(days).sort();
    const ratio = dates.map((d) => { const x = days[d]; return x.b[1] && x.o[1] ? +((x.b[0] / x.b[1]) / (x.o[0] / x.o[1])).toFixed(3) : null; });
    const closed = (d) => d >= "2025-03-03" && d <= "2025-04-06";
    const avgOf = (f) => { const v = ratio.filter((r, i) => r != null && f(dates[i])); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const shade = { id: "shade", beforeDatasetsDraw(ch) { const x = ch.scales.x, a = ch.chartArea, ctx = ch.ctx; const i0 = dates.findIndex(closed), i1 = dates.length - 1 - [...dates].reverse().findIndex(closed); if (i0 < 0 || !dates.some(closed)) return; ctx.save(); ctx.fillStyle = c.s2 + "30"; const w = x.width / Math.max(1, dates.length); ctx.fillRect(x.getPixelForValue(i0) - w / 2, a.top, x.getPixelForValue(i1) - x.getPixelForValue(i0) + w, a.bottom - a.top); ctx.restore(); } };
    A.chart("c-closure", { type: "line", data: { labels: dates, datasets: [{ data: ratio, borderColor: c.s1, borderWidth: 2, pointRadius: 0, pointHitRadius: 5, tension: 0 }] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { title: (t) => F.date(t[0].label) + (closed(t[0].label) ? " · walkway closed" : ""), label: (t) => `Back Forty at ${Math.round(t.raw * 100)}% of the floor's rate` } } },
        scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: false, maxRotation: 0, callback: (v, i) => (dates[i] && dates[i].endsWith("-01") ? F.date(dates[i]).split(" ")[0] : null) } }), y: A.axis({ min: 0.3, max: 0.85, ticks: { color: c.axis, callback: (v) => Math.round(v * 100) + "%" } }) } }, plugins: [shade] });
    const bef = avgOf((d) => d < "2025-03-03"), dur = avgOf(closed), aft = avgOf((d) => d > "2025-04-06");
    $("#closure-cap").textContent = `Average share of the floor's rate: before ${bef ? Math.round(bef * 100) + "%" : "–"}, during the closure ${dur ? Math.round(dur * 100) + "%" : "–"}, after ${aft ? Math.round(aft * 100) + "%" : "–"} (within the selected months). Floor totals stayed on forecast, so the lost play moved to other zones.`;

    // weekday
    const s = A.dailySeries();
    const wk = WEEKDAYS.map((w) => { const v = s.filter((d) => d.weekday === w && !d.events && !d.holiday); return v.length ? A.sum(v, (d) => d.coin) / v.length : 0; });
    A.chart("c-weekday", { type: "bar", data: { labels: WEEKDAYS, datasets: [{ data: wk, backgroundColor: WEEKDAYS.map((w) => (w === "Sat" ? c.s2 : c.s1)), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 26 }] },
      options: { plugins: { tooltip: { callbacks: { label: (t) => `${F.usd(t.raw)} on an ordinary ${t.label}` } } }, scales: { x: A.xAxis(), y: A.axis({ min: 0, ticks: { color: c.axis, callback: (v) => F.usd(v) } }) } } });
    label("c-weekday", "Average coin-in on ordinary days by weekday: " + WEEKDAYS.map((w, i) => `${w} ${F.usd(wk[i])}`).join(", "));

    const evs = D.events.filter((e) => e[4] >= A.state.from + "-01" && e[3] <= A.state.to + "-31");
    A.table("#t-events", [
      { label: "Event", value: (e) => e[0] }, { label: "Type", value: (e) => (e[2] === "property" ? "Casino promotion" : e[1].replace("_", " ")) },
      { label: "Dates", value: (e) => `${F.date(e[3])} – ${F.date(e[4])}` },
      { label: "Avg coin-in/day", cls: "r", value: (e) => { const v = A.DAILY.filter((d) => d.date >= e[3] && d.date <= e[4]); return F.usd(A.sum(v, (d) => d.coin) / (v.length || 1)); } },
    ], evs);

  };

  function floorMap() {
    const c = A.colors();
    const agg = {};
    for (const r of A.MM) { if (!A.inMonths(r.month)) continue; const b = (agg[r.bank] = agg[r.bank] || { coin: 0, exp: 0, machines: new Set() }); b.coin += r.coin; b.exp += r.exp_coin; b.machines.add(r.machine); }
    const S = 6, PAD_X = 30, PAD_TOP = 50, W = 152 * S + PAD_X * 2, H = PAD_TOP + 122 * S + 20;
    const X = (x) => PAD_X + x * S, Y = (y) => PAD_TOP + y * S;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "map"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Floor map of the casino with banks shaded by earnings against the same game elsewhere");
    const zone = Object.fromEntries(D.zones.map((z) => [z[0], z]));
    for (const w of D.walkways) {
      const a = zone[w[1]], b = zone[w[2]]; if (!a || !b) continue;
      svg.append(mk("line", { x1: X(a[2]), y1: Y(a[3]), x2: X(b[2]), y2: Y(b[3]), class: "walk" + (w[4] ? " closed" : "") }));
      if (w[4]) svg.append(mk("text", { x: (X(a[2]) + X(b[2])) / 2 + 8, y: (Y(a[3]) + Y(b[3])) / 2, class: "note" }, "Walkway closed Mar 3 – Apr 6"));
    }
    const sel = A.state.bank;
    for (const b of D.banks) {
      const g = agg[b[0]]; const idx = g && g.exp ? g.coin / g.exp : null;
      const circ = mk("circle", { cx: X(b[2]), cy: Y(b[3]), r: 5 + Math.sqrt(b[4]) * 3, fill: A.divColor(idx), class: "bank" + (b[0] === sel ? " sel" : ""), tabindex: "0" });
      circ.append(mk("title", {}, `${b[0]} · ${A.ZONE_NAME[b[1]]} · ${idx ? idx.toFixed(2) + "× same game elsewhere" : "no play in period"} · ${g ? g.machines.size : 0} machines`));
      const pick = () => A.setArea(b[1], b[0] === sel ? "all" : b[0]);
      circ.addEventListener("click", pick); circ.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
      svg.append(circ);
    }
    const zi = zoneIndexByZone();
    // Zone labels sit beside each bank cluster (floor metres), clear of circles and walkways.
    const LABEL_AT = { "Z-B40": [31, 99, "start"], "Z-ENT": [15, 30.5, "middle"], "Z-PIT": [76, 46.5, "start"], "Z-HTL": [73, 3.5, "start"],
      "Z-HL": [101, 8, "middle"], "Z-BAR": [111, 66, "start"], "Z-GAR": [120, 117.5, "middle"] };
    for (const z of D.zones) {
      const [lx, ly, anchor] = LABEL_AT[z[0]] || [z[2], z[3] - 6, "middle"];
      svg.append(mk("text", { x: X(lx), y: Y(ly), "text-anchor": anchor, class: "zone-label" }, z[1]));
      svg.append(mk("text", { x: X(lx), y: Y(ly) + 22, "text-anchor": anchor, class: "zone-sub" }, zi[z[0]] ? zi[z[0]].idx.toFixed(2) + "×" : ""));
    }
    // Entrance and outlet labels, offset in pixels from their marker.
    const POI_AT = { "L-ENT-MAIN": [-4, 30, "start"], "L-ENT-HTL": [-60, 4, "end"], "L-ENT-GAR": [10, 4, "start"], "O-BAR": [10, 4, "start"], "O-CAFE": [-10, 4, "end"], "O-REST": [0, 22, "middle"] };
    for (const p of D.points) {
      const x = X(p[4]), y = Y(p[5]);
      const [dx, dy, anchor] = POI_AT[p[0]] || [10, 4, "start"];
      svg.append(p[1] === "entrance" ? mk("path", { d: `M${x - 7},${y + 6} L${x},${y - 7} L${x + 7},${y + 6} Z`, class: "poi" }) : mk("rect", { x: x - 5, y: y - 5, width: 10, height: 10, rx: 2, class: "poi" }));
      svg.append(mk("text", { x: x + dx, y: y + dy, "text-anchor": anchor, class: "poi-label" }, p[3]));
    }
    $("#floor-map").replaceChildren(svg);
    const ent = A.ZD.filter((r) => A.inDates(r.date));
    $("#map-cap").textContent = `${A.periodLabel()}. Triangles are entrances, squares are food and drink outlets. Lines are walkways; the dashed one was closed for renovation.${A.state.bank !== "all" ? ` Selected: ${A.state.bank}. Click it again to clear.` : ""}${ent.length ? "" : " No data in this period."}`;
  }

  // ---------- Downtime ----------
  A.views.downtime = function () {
    const c = A.colors();
    const mfSel = $("#f-mf");
    if (!mfSel.childElementCount) {
      mfSel.append(el("option", { value: "all", text: "All manufacturers" }), ...["Halcyon", "Northwind", "Ridgeline"].map((m) => el("option", { value: m, text: m })));
      mfSel.addEventListener("change", (e) => { A.state.mf = e.target.value; A.views.downtime(); });
    }
    mfSel.value = A.state.mf;
    const z = A.areaZone();
    const rows = A.DOWN.filter((r) => A.inMonths(r.month) && (z === "all" || r.zone === z) && (A.state.mf === "all" || r.manufacturer === A.state.mf));
    const n = A.sum(rows, (r) => r.faults), lost = A.sum(rows, (r) => r.lost_wait_coin + r.lost_fix_coin);
    A.kpis("#down-kpis", [
      { l: "Fault repairs", v: F.n(n), d: `${A.periodLabel()} · ${z === "all" ? "whole floor" : A.ZONE_NAME[z]}` },
      { l: "Wagers lost while down", v: F.usd(lost), d: `≈ ${F.usd(lost * HOLD)} expected house win` },
      { l: "Repair bills", v: F.usd(A.sum(rows, (r) => r.repair_cost)), d: n ? `${F.usd(A.sum(rows, (r) => r.repair_cost) / n)} per fault` : "" },
      { l: "Average wait for a technician", v: n ? `${(A.sum(rows, (r) => r.wait_h) / n).toFixed(1)} h` : "–", d: n ? `repair itself ${(A.sum(rows, (r) => r.fix_h) / n).toFixed(1)} h` : "" },
    ]);
    const months = D.months.filter(A.inMonths);
    const by = (m, f) => A.sum(rows.filter((r) => r.month === m), f);
    A.chart("c-down-month", { type: "bar", data: { labels: months.map((m) => A.MONTH_LABEL[m]), datasets: [
      { data: months.map((m) => by(m, (r) => r.lost_fix_coin)), backgroundColor: c.s1, borderColor: c.surface, borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 30 },
      { data: months.map((m) => by(m, (r) => r.lost_wait_coin)), backgroundColor: c.s2, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 30 },
    ] }, options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (t) => `${t.datasetIndex ? "Waiting" : "Repairing"}: ${F.usd(t.raw)}` } } }, scales: { x: A.xAxis({ stacked: true }), y: A.axis({ stacked: true, min: 0, ticks: { color: c.axis, callback: (v) => F.usd(v) } }) } } });

    const list = A.machineTotals();
    const mf = ["Halcyon", "Northwind", "Ridgeline"].map((m) => { const v = list.filter((x) => x.manufacturer === m); const mm = A.sum(v, (x) => x.days) / 30.4; return { m, rate: mm ? A.sum(v, (x) => x.faults) / mm : 0, n: v.length }; });
    A.chart("c-down-mf", { type: "bar", data: { labels: mf.map((x) => `${x.m} (${x.n})`), datasets: [{ data: mf.map((x) => +x.rate.toFixed(3)), backgroundColor: mf.map((x) => (x.m === "Ridgeline" ? c.s2 : c.s1)), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 40 }] },
      options: { plugins: { tooltip: { callbacks: { label: (t) => `${t.raw.toFixed(2)} faults per machine per month` } } }, scales: { x: A.xAxis(), y: A.axis({ min: 0 }) } } });
    label("c-down-mf", "Faults per machine per month: " + mf.map((x) => `${x.m} ${x.rate.toFixed(2)}`).join(", "));

    const q = (techs, k) => { const r = D.queue.find((x) => x[0] === techs && x[1] === k); return r ? r[3] : null; };
    const qn = (techs, k) => { const r = D.queue.find((x) => x[0] === techs && x[1] === k); return r ? r[2] : 0; };
    A.chart("c-queue", { type: "bar", data: { labels: ["No other ticket open", "1 open", "2 or more open"], datasets: [2, 1, 0].map((t, i) => ({ data: [0, 1, 2].map((k) => q(t, k)), backgroundColor: [c.s1, c.s2, c.bad][i], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 24, techs: t })) },
      options: { plugins: { tooltip: { callbacks: { label: (t) => `${t.dataset.techs} on shift: ${t.raw == null ? "no cases" : t.raw.toFixed(1) + " h wait"} (${qn(t.dataset.techs, t.dataIndex)} faults)` } } }, scales: { x: A.xAxis(), y: A.axis({ min: 0, ticks: { color: c.axis, callback: (v) => v + " h" } }) } } });

    const ro = D.roster.filter((r) => A.inMonths(r[0]));
    const shifts = ["day", "swing", "grave"];
    const avgS = (s, i) => { const v = ro.filter((r) => r[1] === s); return v.length ? A.sum(v, (r) => r[i]) / v.length : null; };
    A.chart("c-roster", { type: "bar", data: { labels: ["Day", "Swing", "Grave"], datasets: [
      { data: shifts.map((s) => avgS(s, 2)), backgroundColor: c.context, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 26 },
      { data: shifts.map((s) => avgS(s, 3)), backgroundColor: c.s1, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 26 },
    ] }, options: { plugins: { tooltip: { callbacks: { label: (t) => `${t.datasetIndex ? "Worked" : "Planned"}: ${t.raw.toFixed(2)} technicians` } } }, scales: { x: A.xAxis(), y: A.axis({ min: 0 }) } } });
  };

  // ---------- Guests and comps ----------
  A.views.guests = function () {
    const c = A.colors();
    const fill = (id, key, vals, allText) => {
      const s = $(id);
      if (!s.childElementCount) { s.append(el("option", { value: "all", text: allText }), ...vals.map((v) => el("option", { value: v, text: v }))); s.addEventListener("change", (e) => { A.state[key] = e.target.value; A.views.guests(); }); }
      s.value = A.state[key];
    };
    const uniq = (k) => [...new Set(A.GUESTS.map((g) => g[k]))].sort();
    fill("#g-tier", "tier", uniq("tier"), "All tiers"); fill("#g-region", "region", uniq("region"), "All regions"); fill("#g-age", "age", uniq("age"), "All ages");
    const st = A.state;
    const g = A.GUESTS.filter((r) => A.inMonths(r.month) && (st.tier === "all" || r.tier === st.tier) && (st.region === "all" || r.region === st.region) && (st.age === "all" || r.age === st.age));
    const S = (k) => A.sum(g, (r) => r[k]);
    const pm = S("player_months");
    A.kpis("#guest-kpis", [
      { l: "Player-months", v: F.n(pm), d: `${A.periodLabel()}` },
      { l: "Tracked wagers", v: F.usd(S("coin")), d: `paid back ${F.usd(S("payout"))}` },
      { l: "Players' net result", v: F.usd(S("net")), d: `expected ${F.usd(-S("theo"))}` },
      { l: "Player-months ahead", v: pm ? F.pct(S("ahead") / pm) : "–", d: "net result above zero" },
      { l: "Comp cost / expected loss", v: S("theo") ? F.pct(S("comp_cost") / S("theo"), 2) : "–", d: `${F.usd(S("comp_cost"))} comp cost` },
    ]);
    const vals = [S("coin"), S("payout"), -S("net"), S("theo")];
    A.chart("c-funnel", { type: "bar", data: { labels: ["Wagered", "Paid back", "Net loss", "Expected loss"], datasets: [{ data: vals, backgroundColor: [c.s1, c.s1, c.s2, c.context], borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "left", maxBarThickness: 26 }] },
      options: { indexAxis: "y", plugins: { tooltip: { callbacks: { label: (t) => F.usd(t.raw) } } }, scales: { x: A.axis({ min: 0, ticks: { color: c.axis, callback: (v) => F.usd(v) } }), y: A.xAxis({ ticks: { color: c.ink } }) } } });
    label("c-funnel", `Wagered ${F.usd(vals[0])}, paid back ${F.usd(vals[1])}, net loss ${F.usd(vals[2])}, expected loss ${F.usd(vals[3])}`);

    const key = st.tier !== "all" ? "tier:" + st.tier : st.region !== "all" ? "region:" + st.region : st.age !== "all" ? "age:" + st.age : "all";
    const cc = D.concentration[key] || D.concentration.all;
    A.chart("c-conc", { type: "bar", data: { labels: cc.share.map((v, i) => (i === 0 ? "Top 10%" : String(i + 1))), datasets: [{ data: cc.share.map((v) => +(v * 100).toFixed(2)), backgroundColor: cc.share.map((v, i) => (i === 0 ? c.s1 : c.context)), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 26 }] },
      options: { plugins: { tooltip: { callbacks: { title: (t) => (t[0].dataIndex === 0 ? "Top 10% of card holders" : `Decile ${t[0].dataIndex + 1}`), label: (t) => [`${t.raw.toFixed(1)}% of expected loss`, `${F.pct(cc.ahead[t.dataIndex])} came out ahead · average net ${F.usd(cc.avg_net[t.dataIndex])}`] } } }, scales: { x: A.xAxis({ title: { display: true, text: "Card-holder decile by expected loss", color: c.axis } }), y: A.axis({ min: 0, ticks: { color: c.axis, callback: (v) => v + "%" } }) } } });
    const ahead = cc.ahead.reduce((a, v) => a + v, 0) / cc.ahead.length;
    $("#conc-cap").textContent = `${key === "all" ? "All card holders" : key.split(":")[1]}, Jan–Jun (whole period; ${F.n(cc.players)} players). The top 10% account for ${F.pct(cc.share[0])} of expected loss. About ${F.pct(ahead, 0)} came out ahead.${[st.tier, st.region, st.age].filter((v) => v !== "all").length > 1 ? " With several guest filters set, this chart uses the first one." : ""}`;

    const weeks = [...new Set(D.comp_weekly.map((r) => r[0]))].filter((w) => A.inDates(w));
    const tierLine = (t, col, dash) => ({ data: weeks.map((w) => { const r = D.comp_weekly.find((x) => x[0] === w && x[1] === t); return r ? r[2] : null; }), borderColor: col, borderDash: dash, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0, label: t });
    A.chart("c-comp-price", { type: "line", data: { labels: weeks, datasets: [tierLine("Base", c.s1, []), tierLine("Gold", c.s2, [6, 4]), tierLine("Platinum", c.s3, [])] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { title: (t) => "Week of " + F.date(t[0].label), label: (t) => `${t.dataset.label}: ${t.raw == null ? "–" : t.raw.toFixed(1)} points per $1` } } },
        scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: true, maxTicksLimit: 7, maxRotation: 0, callback: (v, i) => F.date(weeks[i]) } }), y: A.axis({ min: 0, max: 16 }) } } });

    const wkOf = (d) => { const dt = new Date(d + "T12:00:00Z"); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); };
    const fw = {};
    for (const r of A.FNB) {
      if (!A.inDates(r.date)) continue;
      const k = wkOf(r.date); const o = (fw[k] = fw[k] || { carded: 0, uncarded: 0, comp: 0, days: new Set() });
      o.days.add(r.date); if (r.kind === "comp") o.comp += r.face; else o[r.kind] += r.cash;
    }
    const wks = Object.keys(fw).sort().filter((k) => fw[k].days.size >= 5);
    const per = (k, f) => fw[k][f] / fw[k].days.size;
    A.chart("c-fnb", { type: "line", data: { labels: wks, datasets: [
      { data: wks.map((k) => per(k, "carded")), borderColor: c.s1, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0, label: "Carded cash" },
      { data: wks.map((k) => per(k, "uncarded")), borderColor: c.s2, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0, label: "Uncarded cash" },
      { data: wks.map((k) => per(k, "comp")), borderColor: c.s3, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0, label: "Comps (menu value)" },
    ] }, options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { title: (t) => "Week of " + F.date(t[0].label), label: (t) => `${t.dataset.label}: ${F.usd(t.raw)} a day` } } },
      scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: true, maxTicksLimit: 7, maxRotation: 0, callback: (v, i) => F.date(wks[i]) } }), y: A.axis({ min: 0, ticks: { color: c.axis, callback: (v) => F.usd(v) } }) } } });
  };

  // ---------- Model ----------
  A.views.model = function () {
    const c = A.colors(), M = D.model;
    A.kpis("#model-kpis", [
      { l: "Weekday + calendar · MAE", v: F.usd(M.holdout.m2.mae), d: `${M.holdout.m2.mape}% average miss` },
      { l: "Weekday average · MAE", v: F.usd(M.holdout.b1.mae), d: `${M.holdout.b1.mape}% average miss` },
      { l: "Flat average · MAE", v: F.usd(M.holdout.b0.mae), d: `${M.holdout.b0.mape}% average miss` },
      { l: "Split", v: `${M.train_days} / ${M.test_days} days`, d: "train Jan–Apr · test May–Jun" },
    ]);
    const test = M.daily.filter((r) => !r[5]);
    const notes = Object.fromEntries(A.DAILY.map((d) => [d.date, [d.events, d.holiday].filter(Boolean).join(" · ")]));
    A.chart("c-holdout", { type: "line", data: { labels: test.map((r) => r[0]), datasets: [
      { data: test.map((r) => r[1]), borderColor: c.s1, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0, label: "Actual" },
      { data: test.map((r) => r[4]), borderColor: c.s2, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0, label: "Weekday + calendar" },
      { data: test.map((r) => r[3]), borderColor: c.axis, borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0, tension: 0, label: "Weekday average" },
      { data: test.map((r) => r[2]), borderColor: c.context, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: 0, label: "Flat average" },
    ] }, options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { title: (t) => F.date(t[0].label) + (notes[t[0].label] ? " · " + notes[t[0].label] : ""), label: (t) => `${t.dataset.label}: ${F.usd(t.raw)}` } } },
      scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: false, maxRotation: 0, callback: (v, i) => (test[i] && (test[i][0].endsWith("-01") || test[i][0].endsWith("-15")) ? F.date(test[i][0]) : null) } }), y: A.axis({ ticks: { color: c.axis, callback: (v) => F.usd(v) } }) } } });
    const mrow = (k, name) => ({ name, all: M.holdout[k], ev: M.holdout_event_days[k], nm: M.holdout_normal_days[k] });
    A.table("#t-errors", [
      { label: "Forecast", value: (r) => r.name }, { label: "MAE, all days", cls: "r", value: (r) => F.usd(r.all.mae) }, { label: "Event days", cls: "r", value: (r) => F.usd(r.ev.mae) },
      { label: "Ordinary days", cls: "r", value: (r) => F.usd(r.nm.mae) }, { label: "Avg miss", cls: "r", value: (r) => r.all.mape + "%" }, { label: "Bias", cls: "r", value: (r) => F.usd(r.all.bias) },
    ], [mrow("m2", "Weekday + calendar"), mrow("b1", "Weekday average"), mrow("b0", "Flat average")]);
    const pe = M.tournament_pre_event;
    A.table("#t-preevent", [
      { label: "Pre-event baseline", value: (r) => r[0] }, { label: "Event 3 days", cls: "r", value: (r) => F.usd(r[1].event_3d) }, { label: "Next 7 days", cls: "r", value: (r) => F.usd(r[1].next_7d) },
      { label: "Net", cls: "r", value: (r) => F.usd(r[1].net) }, { label: "vs. break-even", cls: "r", value: (r) => (r[1].net / pe.break_even_coin_in).toFixed(1) + "×" },
    ], [["All days Jan 1 – Feb 20", pe.all_pre_event_days], ["Ordinary days Jan 1 – Feb 20", pe.normal_pre_event_days]]);
    const pl = [...M.placebo].sort((a, b) => a[1] - b[1]);
    const ps = M.placebo_summary;
    const bars = pl.map((w) => ({ l: F.date(w[0]), v: w[1], real: false })).concat([{ l: "Slot tournament", v: ps.tournament_lift, real: true }]);
    A.chart("c-placebo", { type: "bar", data: { labels: bars.map((b) => b.l), datasets: [{ data: bars.map((b) => b.v), backgroundColor: bars.map((b) => (b.real ? c.s2 : c.context)), borderRadius: 3, borderSkipped: false, maxBarThickness: 26 }] },
      options: { plugins: { tooltip: { callbacks: { title: (t) => (bars[t[0].dataIndex].real ? "February slot tournament" : "Weekend of " + t[0].label), label: (t) => `${F.usd(t.raw)} vs. forecast` } } }, scales: { x: A.xAxis({ ticks: { color: c.axis, autoSkip: true, maxRotation: 50 } }), y: A.axis({ ticks: { color: c.axis, callback: (v) => F.usd(v) } }) } } });
    label("c-placebo", `Ordinary weekend deviations range from ${F.usd(ps.min_lift)} to ${F.usd(ps.max_lift)}; the tournament is ${F.usd(ps.tournament_lift)}, rank ${ps.tournament_rank}`);
  };

  // ---------- Plan ----------
  const CLAIMS = [
    ["M-1158 hits 38.57% of 674,454 spins vs 31.54% on the other 47 Desert Gold machines", "Verified fact", "t-fact", "Does not identify the cause"],
    ["309 of 310 machines are consistent with luck", "Model estimate", "t-model", "Normal approximation is weaker for 18 very-high-volatility games"],
    ["9 of the bottom 10 by house win are in Back Forty", "Verified fact", "t-fact", "Ranking uses raw six-month house win"],
    ["Back Forty earns 0.65× the same game elsewhere", "Model estimate", "t-model", "Assumes comparable game mix within zones"],
    ["Walkway closure: Back Forty fell from 64% to 44% of the floor's rate; floor totals on forecast", "Model estimate", "t-model", "Shows displacement when access is removed, not what signs would add"],
    ["February tournament: $566K–$884K net extra wagers", "Model estimate", "t-model", "One event; a forecast deviation, not proven cause"],
    ["Tournament ranks first of 21 weekends", "Verified fact", "t-fact", "Only 20 comparison weekends; rank p ≈ 0.05"],
    ["Forecast MAE $47K vs $69K vs $218K on the holdout", "Verified fact", "t-fact", "Two months of holdout"],
    ["Ridgeline faults 3.6× Halcyon per machine", "Verified fact", "t-fact", "Cause unknown"],
    ["May 1 comp change cut points prices about 53% in every tier", "Verified fact", "t-fact", "Effect on play is before-and-after only"],
    ["A fix on M-1158 recovers about $200 a day", "Assumption", "t-assume", "Depends on a repair not yet scoped"],
    ["Simulated plan results", "Assumption-based", "t-assume", "Conditional on assumed input ranges"],
  ];
  A.views.plan = function () {
    const P = D.plan;
    A.table("#t-scen", [
      { label: "Scenario", value: (r) => r[0] }, { label: "Net extra wagers", cls: "r", value: (r) => F.usd(r[1].net_extra_coin_in) },
      { label: "July net", cls: "r", value: (r) => F.usd(r[1].july_net), tone: (r) => (r[1].july_net < 0 ? "neg" : "pos") },
      { label: "With $5K extra cost", cls: "r", value: (r) => F.usd(r[1].july_net_with_5k_extra_cost), tone: (r) => (r[1].july_net_with_5k_extra_cost < 0 ? "neg" : "pos") },
    ], Object.entries(P.scenarios));
    const pick = [["R. Revised: inspect + one weekend", "Recommended: inspect + one weekend"], ["B. Two promo weekends + inspect + maintenance", "Inspect + two weekends + maintenance"], ["A. Current plan", "Inspect + one weekend + maintenance"], ["I. Keep the whole budget", "Keep the whole budget"], ["H. Technician + signs + inspect", "Technician + Back Forty signs + inspect"], ["G. Manager-style: lease 10 replacements", "Manager-style: lease 10 replacements"]];
    A.table("#t-plans", [
      { label: "Plan", value: (r) => r[1] }, { label: "Cost", cls: "r", value: (r) => F.usd(P.plans[r[0]].cost) },
      { label: "Simulated July net", cls: "r", value: (r) => F.usd(P.plans[r[0]].july_net_mean), tone: (r) => (P.plans[r[0]].july_net_mean < 0 ? "neg" : "") },
      { label: "10th–90th percentile", cls: "r", value: (r) => `${F.usd(P.plans[r[0]].july_net_p10)} to ${F.usd(P.plans[r[0]].july_net_p90)}` },
    ], pick.filter((r) => P.plans[r[0]]), { rowClass: (r) => (r[0].startsWith("R.") ? "sel" : "") });
    A.table("#t-claims", [{ label: "Claim", value: (r) => r[0] }, { label: "Type", value: (r) => el("span", { class: "tag " + r[2], text: r[1] }) }, { label: "Limitation", value: (r) => r[3] }], CLAIMS);
  };

  // ---------- evidence links ----------
  const EVIDENCE = {
    m1158: () => { Object.assign(A.state, { machine: "M-1158", zone: "all", bank: "all" }); A.show("machines", { focus: "#machine-detail" }); },
    bottom: () => A.show("machines", { focus: "#t-bottom" }),
    placebo: () => A.show("model", { focus: "#c-placebo" }),
    closure: () => A.show("floor", { focus: "#c-closure" }),
    queue: () => A.show("downtime", { focus: "#c-queue" }),
    comps: () => A.show("guests", { focus: "#c-comp-price" }),
  };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-evidence]"); if (b && EVIDENCE[b.dataset.evidence]) EVIDENCE[b.dataset.evidence](); });
})();
