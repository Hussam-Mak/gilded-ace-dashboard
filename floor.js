/* Floor page: every slot drawn at its real position; click a machine to see its numbers. */
(function () {
  "use strict";
  const A = window.App, D = A.D, F = A.fmt, $ = A.$, el = A.el;
  const SLOTS = D.slots.map((s) => ({ slot: s[0], zone: s[1], bank: s[2], x: s[3], y: s[4] }));
  const PLACE = D.placements.map((p) => ({ machine: p[0], slot: p[1], from: p[2], to: p[3] }));
  const S = 7, PAD = 26, X0 = -6, Y0 = -10;
  const X = (x) => PAD + (x - X0) * S, Y = (y) => PAD + (y - Y0) * S;
  const W = X(146) + PAD, H = Y(121) + PAD;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  let metric = "play";
  let view = window.Floor3D && window.Floor3D.supported ? "3d" : "plan";
  let f3Ready = false, currentById = {};

  const lastDay = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const firstDay = (month) => month + "-01";

  /** The floor is shown as it stood on one day: the last day of the selected period. */
  const DATA_END = D.daily[D.daily.length - 1][0];
  function refDate() { const d = lastDay(A.state.to); return d > DATA_END ? DATA_END : d; }
  /** Machine standing in each slot on the reference date. Placements are [from, to) in gaming dates. */
  function occupancy() {
    const date = refDate(), bySlot = {};
    for (const p of PLACE) if (p.from <= date && (p.to === "" || date < p.to)) bySlot[p.slot] = p;
    return bySlot;
  }
  /** Last placement of a machine on or before the reference date (for machines no longer on the floor). */
  function lastPlacement(machine) {
    const date = refDate();
    return PLACE.filter((p) => p.machine === machine && p.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  }
  const dateLabel = () => F.date(refDate());

  // ---------- color scales ----------
  // 3D ramps are fixed (the felt scene does not change with the page theme) and tuned to read on green.
  const C3 = { dark: "#34342f", mid: "#a6a294", drift: "#5d5a51", yellow: "#f4c542", red: "#e3443a" };
  /** Payout check in three plain categories: 0 = matches the sheet, 1 = drifting, 2 = off the sheet. */
  const payoutCat = (m) => { const z = Math.abs(m.hitZ || 0); return z > 5 ? 2 : z >= 2 ? 1 : 0; };
  function color3d(m, rank) {
    if (metric === "play") return A.mix(C3.dark, C3.yellow, rank(m.rate));
    if (metric === "luck") return m.luckZ == null ? C3.mid : m.luckZ < 0 ? A.mix(C3.mid, "#1f1f1c", Math.min(1, -m.luckZ / 2.5)) : A.mix(C3.mid, C3.yellow, Math.min(1, m.luckZ / 2.5));
    if (metric === "payout") return [C3.mid, C3.drift, C3.red][payoutCat(m)];
    return A.mix(C3.mid, C3.red, Math.min(1, Math.max(0, (1 - (m.availability || 1)) / 0.02)));
  }

  function scale(list) {
    const sc = scale2d(list);
    const rates = list.map((m) => m.rate).filter((v) => v != null).sort((a, b) => a - b);
    const rank = (v) => { let lo = 0, hi = rates.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rates[mid] < v) lo = mid + 1; else hi = mid; } return rates.length > 1 ? lo / (rates.length - 1) : 0.5; };
    sc.color3d = (m) => color3d(m, rank);
    sc.ramp3d = metric === "play" ? [C3.dark, C3.yellow] : metric === "luck" ? ["#1f1f1c", C3.mid, C3.yellow] : metric === "payout" ? null : [C3.mid, C3.red];
    if (sc.items) sc.items3d = sc.items.map((it, i) => Object.assign({}, it, { color: [C3.mid, C3.drift, C3.red][i] }));
    return sc;
  }

  function scale2d(list) {
    const c = A.colors();
    if (metric === "play") {
      const rates = list.map((m) => m.rate).filter((v) => v != null).sort((a, b) => a - b);
      const rank = (v) => { let lo = 0, hi = rates.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rates[mid] < v) lo = mid + 1; else hi = mid; } return rates.length > 1 ? lo / (rates.length - 1) : 0.5; };
      return { color: (m) => A.mix(c.divMid, c.divHi, rank(m.rate)), legend: ["Less play", "More play", `coin-in per available hour, ranked across ${rates.length} machines`], ramp: [c.divMid, c.divHi] };
    }
    if (metric === "luck") {
      return { color: (m) => (m.luckZ == null ? c.divMid : m.luckZ < 0 ? A.mix(c.divMid, c.divLo, Math.min(1, -m.luckZ / 2.5)) : A.mix(c.divMid, c.divHi, Math.min(1, m.luckZ / 2.5))),
        legend: ["Won less than expected", "Won more than expected", "luck score from −2.5 to +2.5"], ramp: [c.divLo, c.divMid, c.divHi] };
    }
    if (metric === "payout") {
      const n = [0, 0, 0]; list.forEach((m) => { n[payoutCat(m)]++; });
      const plural = (k) => `${k} machine${k === 1 ? "" : "s"}`;
      return {
        color: (m) => [c.divMid, c.s3, c.bad][payoutCat(m)],
        items: [
          { color: c.divMid, label: "Matches its game sheet", detail: `within 2 standard errors · ${plural(n[0])}` },
          { color: c.s3, label: "Drifting, but within chance", detail: `2 to 5 standard errors · ${plural(n[1])}` },
          { color: c.bad, label: "Off the sheet: inspect", detail: `more than 5 standard errors · ${plural(n[2])}`, strong: true },
        ],
        note: "Payout check compares how often each machine pays anything with the rate printed on its game's sheet. With about 670,000 spins per machine, a real fault stands out far beyond chance.",
      };
    }
    return { color: (m) => A.mix(c.divMid, c.divLo, Math.min(1, Math.max(0, (1 - (m.availability || 1)) / 0.02))),
      legend: ["Always available", "2% or more of hours down", "share of scheduled hours the machine could be played"], ramp: [c.divMid, c.divLo] };
  }

  // ---------- render ----------
  function render() {
    syncFilters();
    const list = A.machineTotals({ area: false });
    const byId = Object.fromEntries(list.map((m) => [m.machine, m]));
    const occ = occupancy();
    const sc = scale(list);
    const zi = A.zoneIndexByZone();
    currentById = byId;
    const onFloor = Object.values(occ).filter((p) => byId[p.machine]).length;
    heroStats(list, onFloor);
    legend(sc);
    $("#floor3d").hidden = view !== "3d";
    $("#f3-time").hidden = view !== "3d";
    $("#view-hint").textContent = view === "3d" ? "Drag to rotate · scroll or pinch to zoom · right-drag to pan · click a cabinet." : "Hover a machine for a preview · click it to open its card.";
    $("#floor-wrap").hidden = view !== "plan";
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    if (view === "3d") {
      ensure3D();
      window.Floor3D.update({ occ, byId, sc, metric, selectedId: A.state.machine, zoneIdx: zi });
      window.Floor3D.setVisible(true);
      $("#floor-cap").textContent = `Floor as it stood on ${dateLabel()}, 2025: ${onFloor} machines and ${SLOTS.length - onFloor} empty slots (outlined) out of ${SLOTS.length}. Colors cover ${A.periodLabel()}. ` +
        "Guests arrive through the three real entrances and pick zones in proportion to each zone's counted entries for this period; their number follows the average traffic for the hour on the clock. " +
        "When the period falls mostly inside March 3 – April 6, the walkway from the Main Entrance to Back Forty is closed and guests route around it.";
    } else {
      if (window.Floor3D && f3Ready) window.Floor3D.setVisible(false);
      drawFloor(occ, byId, sc, zi);
    }
    quickPicks(list);
    machineCard(byId[A.state.machine], zi, occ);
    const dash = $("#to-dash");
    dash.href = `dashboard.html?from=${A.state.from}&to=${A.state.to}&machine=${encodeURIComponent(A.state.machine)}#machines`;
  }

  function heroStats(list, onFloor) {
    const t = A.totals(list);
    const stat = (v, l) => el("div", { class: "stat" }, el("span", { class: "v", text: v }), el("span", { class: "l", text: l }));
    $("#hero-stats").replaceChildren(
      stat(String(onFloor), `on the floor ${dateLabel()} · ${list.length} in period`),
      stat(`$${(t.coin / 1e6).toFixed(1)}M`, "coin-in"),
      stat(F.pct(t.hold, 1), `hold · configured ${F.pct(t.theoHold, 1)}`),
    );
  }

  function legend(sc) {
    const box = $("#floor-legend");
    if (sc.items) {
      const items = view === "3d" ? sc.items3d : sc.items;
      box.replaceChildren(
        el("div", { class: "lg-items" }, items.map((it) => el("div", { class: "lg-item" + (it.strong ? " strong" : "") },
          el("span", { class: "key", style: `background:${it.color}` }),
          el("span", {}, el("b", { text: it.label }), el("span", { class: "muted", text: " · " + it.detail }))))),
        el("p", { class: "muted lg-note", text: sc.note }),
      );
      return;
    }
    const bar = el("span", { class: "bar" });
    bar.style.background = `linear-gradient(90deg, ${(view === "3d" ? sc.ramp3d : sc.ramp).join(", ")})`;
    box.replaceChildren(
      el("div", { class: "lg-ramp" }, el("span", { text: sc.legend[0] }), bar, el("span", { text: sc.legend[1] })),
      el("p", { class: "muted lg-note", text: sc.legend[2][0].toUpperCase() + sc.legend[2].slice(1) + "." }),
    );
  }

  function drawFloor(occ, byId, sc, zi) {
    const c = A.colors();
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "floorsvg", role: "img", "aria-label": "Casino floor plan with each slot machine colored by the selected measure" });
    // zone areas from slot extents
    const ext = {};
    for (const s of SLOTS) { const e = (ext[s.zone] = ext[s.zone] || { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }); e.x0 = Math.min(e.x0, s.x); e.x1 = Math.max(e.x1, s.x); e.y0 = Math.min(e.y0, s.y); e.y1 = Math.max(e.y1, s.y); }
    const zone = Object.fromEntries(D.zones.map((z) => [z[0], z]));
    for (const w of D.walkways) {
      const a = zone[w[1]], b = zone[w[2]]; if (!a || !b) continue;
      svg.append(mk("line", { x1: X(a[2]), y1: Y(a[3]), x2: X(b[2]), y2: Y(b[3]), class: "walk" + (w[4] ? " closed" : "") }));
    }
    for (const [zid, e] of Object.entries(ext)) {
      svg.append(mk("rect", { x: X(e.x0 - 2.2), y: Y(e.y0 - 2.2), width: (e.x1 - e.x0 + 4.4) * S, height: (e.y1 - e.y0 + 4.4) * S, rx: 18, class: "zone-hull" }));
    }
    const closed = D.walkways.find((w) => w[4]);
    if (closed) { const a = zone[closed[1]], b = zone[closed[2]]; svg.append(mk("text", { x: (X(a[2]) + X(b[2])) / 2 + 10, y: (Y(a[3]) + Y(b[3])) / 2 + 4, class: "note" }, "Walkway closed Mar 3 – Apr 6")); }
    // zone labels: placed just outside each zone area
    const LBL = { "Z-B40": ["below"], "Z-ENT": ["above"], "Z-PIT": ["above"], "Z-HTL": ["above"], "Z-HL": ["above"], "Z-BAR": ["right"], "Z-GAR": ["below"] };
    for (const z of D.zones) {
      const e = ext[z[0]]; if (!e) continue;
      const side = (LBL[z[0]] || ["above"])[0];
      let x, y, anchor = "start";
      if (side === "above") { x = X(e.x0 - 2.2); y = Y(e.y0 - 2.2) - 32; }
      else if (side === "below") { x = X(e.x0 - 2.2); y = Y(e.y1 + 2.2) + 22; }
      else { x = X(e.x1 + 2.2) + 12; y = Y((e.y0 + e.y1) / 2) - 6; }
      const idx = zi[z[0]] ? `${zi[z[0]].idx.toFixed(2)}× same game` : "";
      svg.append(mk("text", { x, y, "text-anchor": anchor, class: "zl" }, z[1]));
      svg.append(mk("text", { x, y: y + 25, "text-anchor": anchor, class: "zs" }, idx));
    }
    // entrances and outlets
    const POI = { "L-ENT-MAIN": [0, 24, "middle"], "L-ENT-HTL": [-12, 4, "end"], "L-ENT-GAR": [10, 4, "start"], "O-BAR": [-10, -8, "end"], "O-CAFE": [-10, 4, "end"], "O-REST": [0, 22, "middle"] };
    // Markers sitting inside a zone area get a hover title only; a text label there would cover machines.
    const insideZone = (px, py) => Object.values(ext).some((e) => px >= e.x0 - 2.2 && px <= e.x1 + 2.2 && py >= e.y0 - 2.2 && py <= e.y1 + 2.2);
    for (const p of D.points) {
      const x = X(p[4]), y = Y(p[5]);
      const [dx, dy, anchor] = POI[p[0]] || [10, 4, "start"];
      const marker = p[1] === "entrance" ? mk("path", { d: `M${x - 7},${y + 6} L${x},${y - 7} L${x + 7},${y + 6} Z`, class: "poi" }) : mk("rect", { x: x - 5, y: y - 5, width: 10, height: 10, rx: 3, class: "poi" });
      marker.append(mk("title", {}, `${p[3]} (${p[1] === "entrance" ? "entrance" : "food and drink"})`));
      svg.append(marker);
      if (!insideZone(p[4], p[5])) svg.append(mk("text", { x: x + dx, y: y + dy, "text-anchor": anchor, class: "pl" }, p[3]));
    }
    // slots
    const tip = el("div", { class: "tip", hidden: "" });
    const size = 1.22 * S;
    for (const s of SLOTS) {
      const p = occ[s.slot];
      const m = p && byId[p.machine];
      const r = mk("rect", { x: X(s.x) - size / 2, y: Y(s.y) - size / 2, width: size, height: size, rx: 2.5 });
      if (!m) { r.setAttribute("class", "slot empty"); r.append(mk("title", {}, `${s.slot}: empty in this period`)); svg.append(r); continue; }
      const flag = metric === "payout" && m.hitZ != null && Math.abs(m.hitZ) > 5;
      r.setAttribute("class", "slot" + (m.machine === A.state.machine ? " sel" : "") + (flag ? " flag" : ""));
      r.setAttribute("fill", sc.color(m));
      r.setAttribute("role", "button");
      r.setAttribute("aria-label", `${m.machine}, ${m.theme}, ${A.ZONE_NAME[s.zone]}`);
      const pick = () => selectMachine(m.machine);
      r.addEventListener("click", pick);
      r.addEventListener("mouseenter", () => {
        tip.hidden = false;
        tip.textContent = `${m.machine} · ${m.theme} · ${tipValue(m)}`;
        const box = r.getBoundingClientRect(), wrap = $("#floor-wrap").getBoundingClientRect();
        tip.style.left = `${box.left - wrap.left + box.width / 2}px`; tip.style.top = `${box.top - wrap.top}px`;
      });
      r.addEventListener("mouseleave", () => { tip.hidden = true; });
      svg.append(r);
    }
    // ring around the selected machine so it is visible in any color mode
    const selP = Object.values(occ).find((p) => p.machine === A.state.machine);
    if (selP) { const s = SLOTS.find((x) => x.slot === selP.slot); if (s) svg.append(mk("circle", { cx: X(s.x), cy: Y(s.y), r: size * 1.05, class: "ring" })); }
    $("#floor-wrap").replaceChildren(svg, tip);
    const nOcc = Object.values(occ).filter((p) => byId[p.machine]).length;
    $("#floor-cap").textContent = `Floor as it stood on ${dateLabel()}, 2025: ${nOcc} machines and ${SLOTS.length - nOcc} empty slots (dashed) out of ${SLOTS.length}. Colors cover ${A.periodLabel()}. Triangles are entrances and small squares are food and drink outlets (hover to name them). Zone figures compare coin-in with the same game elsewhere on the same days. Hover a machine for a preview; click it for details.`;
  }

  function ensure3D() {
    if (f3Ready) return;
    const box = $("#floor3d");
    window.Floor3D.init(box, {
      onPick: (id) => selectMachine(id),
      describe: (id) => { const m = currentById[id]; return m ? `${m.machine} · ${m.theme} · ${tipValue(m)}` : id; },
      onClock: (h) => { if (window.Floor3D._clockCb) window.Floor3D._clockCb(h); },
    });
    box.querySelector("[data-toggle-guests]").addEventListener("click", () => window.Floor3D.setRunning(!window.Floor3D.isRunning()));
    box.querySelector("[data-reset]").addEventListener("click", () => window.Floor3D.resetView());
    box.querySelector("[data-focus]").addEventListener("click", () => window.Floor3D.focusSelected());
    // time of day: the slider follows the running clock, and dragging it jumps the clock
    const hour = $("#f3-hour"), out = $("#f3-hour-out");
    const fmtHour = (h) => { const hh = Math.floor(h), mm = Math.round((h % 1) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`; };
    let dragging = false;
    hour.addEventListener("input", () => { dragging = true; window.Floor3D.setHour(+hour.value); out.textContent = fmtHour(+hour.value); });
    hour.addEventListener("change", () => { dragging = false; });
    hour.setAttribute("aria-valuetext", fmtHour(+hour.value));
    window.Floor3D._clockCb = (h) => { if (dragging) return; hour.value = String(Math.floor(h * 4) / 4); out.textContent = fmtHour(h); hour.setAttribute("aria-valuetext", fmtHour(h)); };
    document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => {
      window.Floor3D.setSpeed(+b.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    f3Ready = true;
  }

  function tipValue(m) {
    if (metric === "play") return `${F.usd(m.rate)} per available hour`;
    if (metric === "luck") return `luck score ${F.z(m.luckZ)}`;
    if (metric === "payout") return `pays on ${F.pct(m.hitRate)} of spins (sheet ${F.pct(m.pubHit)})`;
    return `available ${F.pct(m.availability, 2)} of hours`;
  }

  function quickPicks(list) {
    const b10 = [...list].sort((a, b) => a.win - b.win).slice(0, 10);
    $("#quick").replaceChildren(...b10.map((m) => {
      const leak = m.hitZ != null && Math.abs(m.hitZ) > 5;
      const b = el("button", { type: "button", class: leak ? "flag" : "", "aria-pressed": String(m.machine === A.state.machine), text: m.machine, title: `${m.theme} · ${A.ZONE_NAME[m.zone]} · house win ${F.usd(m.win)}` });
      b.addEventListener("click", () => selectMachine(m.machine));
      return b;
    }));
  }

  function machineCard(m, zi, occ) {
    const card = $("#mcard");
    if (!m) {
      card.replaceChildren(el("span", { class: "eyebrow", style: "color:var(--on-dark-muted)", text: "Machine" }), el("div", { class: "id", text: A.state.machine }),
        el("p", { class: "cap", text: `Not on the floor in ${A.periodLabel()}. Widen the period or pick another machine.` }));
      return;
    }
    const meta = A.MACH[m.machine];
    const place = Object.values(occ).find((p) => p.machine === m.machine);
    const last = place ? null : lastPlacement(m.machine);
    const away = last ? `Not on the floor on ${dateLabel()}: stood at ${last.slot} until ${last.to ? F.date(last.to) : "the end of its data"}.` : "";
    const stat = (l, v) => el("div", {}, el("span", { class: "l", text: l }), el("span", { class: "v", text: v }));
    const tags = A.verdicts(m, zi);
    const months = A.MM.filter((r) => r.machine === m.machine && A.inMonths(r.month));
    card.replaceChildren(
      el("div", { style: "display:flex;justify-content:space-between;align-items:start;gap:10px" },
        el("div", { style: "display:grid;gap:4px" }, el("span", { class: "eyebrow", style: "color:var(--on-dark-muted)", text: `${A.ZONE_NAME[m.zone]} · ${m.bank}${place ? " · " + place.slot : ""}` }), el("div", { class: "id", text: m.machine })),
        el("span", { class: "chip", text: meta.volatility + " volatility" })),
      el("p", { class: "cap", text: `${meta.theme} by ${meta.manufacturer} · pays back ${F.pct(meta.rtp, 0)} by design · ${m.days} days on floor in ${A.periodLabel()}` }),
      away ? el("p", { class: "chip", style: "justify-self:start", text: away }) : "",
      el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, tags.map(([t, cl]) => el("span", { class: "tag " + cl, text: t }))),
      el("div", { class: "mstats" },
        stat("Coin-in", F.usd(m.coin)), stat("Per available hour", F.usd(m.rate)),
        stat("House win", F.usd(m.win)), stat("Expected", F.usd(m.theo)),
        stat("Luck score", F.z(m.luckZ)), stat("Payout check", F.z(m.hitZ)),
        stat("Pays on", `${F.pct(m.hitRate, 1)} of spins`), stat("Game sheet", F.pct(m.pubHit, 1)),
        stat("Availability", F.pct(m.availability, 2)), stat("Faults", String(m.faults))),
      el("div", { style: "display:grid;gap:6px" }, el("span", { class: "l", style: "font-size:.72rem;color:var(--on-dark-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600", text: "Monthly coin-in" }),
        el("div", { class: "chartbox h120" }, el("canvas", { id: "c-mini", role: "img", "aria-label": `${m.machine} monthly coin-in: ` + months.map((r) => `${A.MONTH_LABEL[r.month]} ${F.usd(r.coin)}`).join(", ") }))),
      el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" },
        el("a", { class: "btn yellow", href: `dashboard.html?from=${A.state.from}&to=${A.state.to}&machine=${encodeURIComponent(m.machine)}#machines`, text: "Open in dashboard →" })),
    );
    const c = A.colors();
    A.chart("c-mini", { type: "bar", data: { labels: months.map((r) => A.MONTH_LABEL[r.month]), datasets: [{ data: months.map((r) => r.coin), backgroundColor: A.css("--yellow"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 22 }] },
      options: { plugins: { tooltip: { callbacks: { label: (t) => `${F.usd(t.raw)} coin-in` } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: A.css("--on-dark-muted") } }, y: { display: false, min: 0 } } } });
  }

  // ---------- filters and search ----------
  function syncFilters() {
    const opt = (v, l, sel) => { const o = el("option", { value: v, text: l }); if (sel) o.selected = true; return o; };
    $("#f-from").replaceChildren(...D.months.map((m) => opt(m, A.MONTH_LABEL[m] + " 2025", m === A.state.from)));
    $("#f-to").replaceChildren(...D.months.map((m) => opt(m, A.MONTH_LABEL[m] + " 2025", m === A.state.to)));
  }
  function find() {
    const v = $("#m-search").value.trim().toUpperCase();
    if (!v) { $("#m-error").textContent = "Enter a machine ID, such as M-1158."; return; }
    if (!A.MACH[v]) { $("#m-error").textContent = `No machine ${v} in the data. IDs look like M-1158.`; return; }
    $("#m-error").textContent = ""; selectMachine(v);
    if (window.innerWidth <= 900) $("#mpanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /** Select a machine, make sure its card is open, and redraw. */
  function selectMachine(id) {
    A.state.machine = id;
    setCardOpen(true);
    render();
  }
  function setCardOpen(open) {
    $("#mpanel").hidden = !open;
    $("#mpanel-open").hidden = open;
  }

  document.addEventListener("DOMContentLoaded", () => {
    A.readQuery();
    $("#m-list").append(...Object.keys(A.MACH).sort().map((id) => el("option", { value: id })));
    $("#f-from").addEventListener("change", (e) => { A.state.from = e.target.value; if (A.state.from > A.state.to) A.state.to = A.state.from; render(); });
    $("#f-to").addEventListener("change", (e) => { A.state.to = e.target.value; if (A.state.to < A.state.from) A.state.from = A.state.to; render(); });
    $("#m-go").addEventListener("click", find);
    $("#m-search").addEventListener("keydown", (e) => { if (e.key === "Enter") find(); });
    $("#m-search").addEventListener("input", () => ($("#m-error").textContent = ""));
    $("#mpanel-close").addEventListener("click", () => setCardOpen(false));
    $("#mpanel-open").addEventListener("click", () => setCardOpen(true));
    $("#left-toggle").addEventListener("click", (e) => {
      const body = $("#left-body"), open = body.hidden;
      body.hidden = !open;
      e.currentTarget.textContent = open ? "–" : "+";
      e.currentTarget.setAttribute("aria-expanded", String(open));
      e.currentTarget.title = open ? "Collapse panel" : "Expand panel";
    });
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.view === "3d" && !(window.Floor3D && window.Floor3D.supported)) {
        $("#m-error").textContent = "3D needs WebGL, which this browser does not offer. Showing the plan view.";
        return;
      }
      view = b.dataset.view; render();
    }));
    document.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
      metric = b.dataset.metric;
      document.querySelectorAll("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    }));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", render);
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    render();
  });
})();
