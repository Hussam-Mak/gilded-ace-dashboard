/* 3D casino floor.
   - Felt floor painted to the real layout: patterned carpet per zone, marble promenades along the real walkways.
   - One slot machine per occupied slot (instanced for speed); its screen, topper and candle light carry the data color.
   - Neon zone signs whose brightness follows each zone's game-adjusted earnings.
   - Guests whose numbers, entrances, routes and destinations follow the zone foot-traffic counters. */
(function () {
  "use strict";
  const A = window.App, D = A.D;
  const F3 = (window.Floor3D = {});
  F3.supported = (() => { try { const c = document.createElement("canvas"); return !!window.THREE && !!(c.getContext("webgl") || c.getContext("experimental-webgl")); } catch (e) { return false; } })();

  // Floor frame in metres (data x → east, data y → south).
  const FX0 = -6, FX1 = 144, FY0 = -10, FY1 = 122;
  const FW = FX1 - FX0, FH = FY1 - FY0, CX = (FX0 + FX1) / 2, CY = (FY0 + FY1) / 2;
  const wx = (x) => x - CX, wz = (y) => y - CY;
  const PPM = 14; // texture pixels per metre
  const CLOSED_FROM = "2025-03-03", CLOSED_TO = "2025-04-06";
  const DOOR_ZONE = { "L-ENT-MAIN": "Z-ENT", "L-ENT-GAR": "Z-GAR", "L-ENT-HTL": "Z-HTL" };
  const OUTFITS = [0xf4c542, 0xe9e4d4, 0x3b6ea8, 0xb8483c, 0x6d5a8c, 0x2f2f2d, 0xd98c4a, 0x2f8f7a];
  const SECONDS_PER_SIM_HOUR = 15; // at 1x a full day takes six minutes

  const SLOTS = D.slots.map((s) => ({ slot: s[0], zone: s[1], bank: s[2], x: s[3], y: s[4] }));
  const SLOT_INDEX = new Map(SLOTS.map((s, i) => [s.slot, i]));
  const ZONES = Object.fromEntries(D.zones.map((z) => [z[0], { id: z[0], name: z[1], x: z[2], y: z[3] }]));
  const DOORS = D.points.filter((p) => p[1] === "entrance").map((p) => ({ id: p[0], name: p[3], zone: DOOR_ZONE[p[0]], x: p[4], y: p[5] }));
  const EXT = {};
  for (const s of SLOTS) { const e = (EXT[s.zone] = EXT[s.zone] || { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }); e.x0 = Math.min(e.x0, s.x); e.x1 = Math.max(e.x1, s.x); e.y0 = Math.min(e.y0, s.y); e.y1 = Math.max(e.y1, s.y); }
  // Where each zone's name sits relative to its carpet (also used for the neon signs).
  const LABEL_SIDE = { "Z-B40": "below", "Z-ENT": "above", "Z-PIT": "above", "Z-HTL": "left", "Z-HL": "above", "Z-BAR": "right", "Z-GAR": "below" };

  let T, renderer, scene, camera, controls, container, tip, clockEl, composer, bloom;
  let floorCanvas, floorTex, ring, guestRoot;
  let guests = [], running = true, simHour = 20, speed = 1, lastFrame = 0, needsRender = true, clockTick = 0;
  let routing = { closed: false, doorW: [], zoneW: {}, target: 40 };
  let callbacks = { onPick: () => {} };
  let selectedIdx = -1, flagged = [], pulseT = 0, visible = true;
  // Quality: "high" = bloom + shadows + zone lights; "medium" = no bloom; "low" = no bloom, no shadows, 1x pixels.
  let quality = "high", keyLight = null, hemi = null, perf = { frames: 0, time: 0, settled: false };
  const zoneLights = [];
  const occupant = new Array(SLOTS.length).fill(null); // machine id per slot index
  const baseColor = [];                                 // data color per slot index
  const parts = {};                                     // instanced meshes by part name
  const pads = [];                                      // outline pads for empty slots
  const signs = {};                                     // neon sprites by zone id

  // ---------- floor texture ----------
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const P = (x, y) => [(x - FX0) * PPM, (y - FY0) * PPM];

  /** Classic casino carpet tile: navy ground, gold lattice, small rose and teal medallions. */
  function carpetPattern(ctx) {
    const t = document.createElement("canvas"); t.width = t.height = 56;
    const c = t.getContext("2d");
    c.fillStyle = "#1a1d3d"; c.fillRect(0, 0, 56, 56);
    c.strokeStyle = "rgba(201,163,74,0.55)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(28, 0); c.lineTo(56, 28); c.lineTo(28, 56); c.lineTo(0, 28); c.closePath(); c.stroke();
    c.strokeStyle = "rgba(201,163,74,0.25)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(28, 10); c.lineTo(46, 28); c.lineTo(28, 46); c.lineTo(10, 28); c.closePath(); c.stroke();
    c.fillStyle = "#9b2c4f"; c.beginPath(); c.arc(28, 28, 4.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e0b955"; c.beginPath(); c.arc(28, 28, 1.8, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#2f8f86"; [[0, 0], [56, 0], [0, 56], [56, 56]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 3.4, 0, Math.PI * 2); c.fill(); });
    return ctx.createPattern(t, "repeat");
  }

  function paintFloor(zoneIdx, closedActive) {
    const ctx = floorCanvas.getContext("2d");
    const W = floorCanvas.width, H = floorCanvas.height;
    // green felt base with seeded grain
    ctx.fillStyle = "#1d5a39"; ctx.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26000; i++) { ctx.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)"; ctx.fillRect(rnd() * W, rnd() * H, 2, 2); }
    ctx.strokeStyle = "#0b2417"; ctx.lineWidth = 10; rrect(ctx, 0.6 * PPM, 0.6 * PPM, W - 1.2 * PPM, H - 1.2 * PPM, 3 * PPM); ctx.stroke();
    ctx.strokeStyle = "rgba(214,178,92,0.6)"; ctx.lineWidth = 3; rrect(ctx, 1.6 * PPM, 1.6 * PPM, W - 3.2 * PPM, H - 3.2 * PPM, 2.4 * PPM); ctx.stroke();
    ctx.fillStyle = "rgba(11,36,23,0.85)"; ctx.font = `${3.2 * PPM}px Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("♣  ♥  ♦  ♠", (24 - FX0) * PPM, 4.6 * PPM);
    ctx.fillStyle = "rgba(201,57,47,0.85)"; ctx.font = `${6 * PPM}px Georgia, serif`; ctx.fillText("♠", W - 7 * PPM, H - 7 * PPM);

    // marble promenades along the real walkways, gold edges and inlay
    for (const w of D.walkways) {
      const a = ZONES[w[1]], b = ZONES[w[2]]; if (!a || !b) continue;
      const [x1, y1] = P(a.x, a.y), [x2, y2] = P(b.x, b.y);
      ctx.lineCap = "round";
      ctx.strokeStyle = "#b8933a"; ctx.lineWidth = 4.1 * PPM; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = w[4] && closedActive ? "#8f6f6a" : "#cdbf9f"; ctx.lineWidth = 3.6 * PPM; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = "rgba(184,147,58,0.75)"; ctx.lineWidth = 0.18 * PPM; ctx.setLineDash([2.2 * PPM, 1.1 * PPM]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      if (w[4]) {
        ctx.setLineDash([1.2 * PPM, 1.2 * PPM]); ctx.strokeStyle = "rgba(201,57,47,0.95)"; ctx.lineWidth = 0.55 * PPM;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.translate((x1 + x2) / 2 + 3 * PPM, (y1 + y2) / 2); ctx.fillStyle = closedActive ? "#ffd8d2" : "rgba(255,216,210,0.85)";
        ctx.font = `700 ${1.5 * PPM}px Manrope, system-ui, sans-serif`; ctx.textAlign = "left";
        ctx.fillText(closedActive ? "CLOSED for renovation in this period" : "Closed Mar 3 – Apr 6", 0, 0); ctx.restore();
      }
    }
    // marble hubs where promenades meet
    for (const z of Object.values(ZONES)) { const [x, y] = P(z.x, z.y); ctx.fillStyle = "#cdbf9f"; ctx.beginPath(); ctx.arc(x, y, 2.4 * PPM, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#b8933a"; ctx.lineWidth = 3; ctx.stroke(); }

    // patterned carpet for each zone, framed in brass
    const pattern = carpetPattern(ctx);
    for (const e of Object.values(EXT)) {
      const [x, y] = P(e.x0 - 2.6, e.y0 - 2.6);
      const w = (e.x1 - e.x0 + 5.2) * PPM, h = (e.y1 - e.y0 + 5.2) * PPM;
      ctx.fillStyle = pattern; rrect(ctx, x, y, w, h, 1.6 * PPM); ctx.fill();
      ctx.strokeStyle = "#0b2417"; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = "#c9a34a"; ctx.lineWidth = 4; rrect(ctx, x + 0.4 * PPM, y + 0.4 * PPM, w - 0.8 * PPM, h - 0.8 * PPM, 1.3 * PPM); ctx.stroke();
    }
    // each zone's game-adjusted earnings, painted on the felt under its neon name sign
    for (const z of Object.values(ZONES)) {
      const e = EXT[z.id]; if (!e) continue;
      const [mx, my, align] = labelPointM(z.id, e);
      const [x, y] = P(mx, my);
      ctx.textAlign = align; ctx.textBaseline = "alphabetic";
      const zi = zoneIdx[z.id];
      ctx.fillStyle = zi && zi.idx < 0.8 ? "#f4c542" : "#f3ecd2"; ctx.font = `700 ${1.7 * PPM}px "JetBrains Mono", monospace`;
      if (zi) ctx.fillText(`${zi.idx.toFixed(2)}× same game`, x, y + 1.9 * PPM);
    }
    // entrances: red runner at the main doors, gold mats elsewhere; outlets as wooden counters
    for (const p of D.points) {
      const [x, y] = P(p[4], p[5]);
      if (p[1] === "entrance") {
        if (p[0] === "L-ENT-MAIN") { ctx.fillStyle = "#8c1f24"; ctx.fillRect(0, y - 1.6 * PPM, x + 3 * PPM, 3.2 * PPM); ctx.strokeStyle = "#c9a34a"; ctx.lineWidth = 3; ctx.strokeRect(0, y - 1.6 * PPM, x + 3 * PPM, 3.2 * PPM); }
        ctx.fillStyle = "rgba(214,178,92,0.95)"; rrect(ctx, x - 1.6 * PPM, y - 1.6 * PPM, 3.2 * PPM, 3.2 * PPM, 0.4 * PPM); ctx.fill();
      } else {
        ctx.fillStyle = "#5a3a22"; rrect(ctx, x - 1.8 * PPM, y - 0.9 * PPM, 3.6 * PPM, 1.8 * PPM, 0.4 * PPM); ctx.fill();
        ctx.strokeStyle = "#d6b25c"; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    floorTex.needsUpdate = true; needsRender = true;
  }
  /** Floor position (metres) of a zone's label beside its carpet: [x, y, textAlign]. */
  function labelPointM(id, e) {
    const side = LABEL_SIDE[id] || "above";
    if (side === "above") return [e.x0 - 2.6, e.y0 - 6.2, "left"];
    if (side === "below") return [e.x0 - 2.6, e.y1 + 4.6, "left"];
    if (side === "left") return [e.x0 - 3.6, (e.y0 + e.y1) / 2 - 1.4, "right"];
    return [e.x1 + 3.6, (e.y0 + e.y1) / 2 - 1.4, "left"];
  }

  // ---------- scene ----------
  F3.init = function (el, cbs) {
    T = window.THREE; container = el; callbacks = Object.assign(callbacks, cbs || {});
    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.prepend(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "3D casino floor. Drag to rotate, scroll to zoom, click a machine to open it.");
    renderer.domElement.setAttribute("role", "img");
    scene = new T.Scene();
    scene.background = new T.Color(0x150c14);
    scene.fog = new T.Fog(0x150c14, 200, 460);
    camera = new T.PerspectiveCamera(38, 1, 0.5, 900);
    controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.3; controls.minDistance = 10; controls.maxDistance = 260;
    controls.addEventListener("change", () => { needsRender = true; });
    F3.resetView();

    // warm, dim casino light: soft fill, one shadow-casting key, pools of light over each zone
    hemi = new T.HemisphereLight(0xffe9c7, 0x1b2a22, 0.62); scene.add(hemi);
    const key = (keyLight = new T.DirectionalLight(0xffe2b0, 0.6));
    key.position.set(-60, 120, 70); key.castShadow = true; key.shadow.mapSize.set(1536, 1536);
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 80, bottom: -80, near: 10, far: 400 });
    key.shadow.bias = -0.0008; key.shadow.autoUpdate = false; key.shadow.needsUpdate = true; scene.add(key);
    for (const z of Object.values(ZONES)) { const pl = new T.PointLight(0xffc98a, 0.55, 48, 2); pl.position.set(wx(z.x), 16, wz(z.y)); scene.add(pl); zoneLights.push(pl); }

    floorCanvas = document.createElement("canvas"); floorCanvas.width = FW * PPM; floorCanvas.height = FH * PPM;
    floorTex = new T.CanvasTexture(floorCanvas); floorTex.encoding = T.sRGBEncoding; floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new T.Mesh(new T.PlaneGeometry(FW, FH), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    buildRoom();
    buildMachines();
    buildSigns();
    ring = new T.Mesh(new T.RingGeometry(1.3, 1.7, 40), new T.MeshBasicMaterial({ color: 0xffd54a, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.visible = false; scene.add(ring);
    guestRoot = new T.Group(); scene.add(guestRoot);
    setupBloom();

    tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; container.append(tip);
    clockEl = container.querySelector("[data-clock]");
    drawClock();
    bindPointer();
    new ResizeObserver(resize).observe(container); resize();
    document.addEventListener("visibilitychange", () => { lastFrame = 0; });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) F3.setRunning(false);
    requestAnimationFrame(loop);
  };

  /** Walls, rails, sconces, entrance arches and the house sign. Purely decorative. */
  function buildRoom() {
    const wood = new T.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.55 });
    const velvet = new T.MeshStandardMaterial({ color: 0x4a1220, roughness: 0.85 });
    const gold = new T.MeshStandardMaterial({ color: 0xc9a34a, roughness: 0.32, metalness: 0.85 });
    const glow = new T.MeshBasicMaterial({ color: 0xffd9a0 });
    const box = (w, h, d, m, x, y, z, shadow) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (shadow) b.castShadow = true; scene.add(b); return b; };
    // low rails on the near sides, tall upholstered walls on the far sides
    box(FW + 2.4, 1.1, 1.2, wood, 0, 0.55, FH / 2 + 0.6, true);
    box(1.2, 1.1, FH, wood, FW / 2 + 0.6, 0.55, 0, true);
    box(FW + 2.4, 6, 1.2, velvet, 0, 3, -FH / 2 - 0.6);
    box(1.2, 6, FH + 2.4, velvet, -FW / 2 - 0.6, 3, 0);
    box(FW + 2.4, 0.35, 1.4, gold, 0, 6.1, -FH / 2 - 0.6); box(1.4, 0.35, FH + 2.4, gold, -FW / 2 - 0.6, 6.1, 0);
    box(FW + 2.4, 1.2, 1.3, wood, 0, 0.6, -FH / 2 - 0.5); box(1.3, 1.2, FH + 2.4, wood, -FW / 2 - 0.5, 0.6, 0);
    const sconce = new T.SphereGeometry(0.35, 14, 10);
    for (let x = -FW / 2 + 8; x < FW / 2; x += 12) { const s = new T.Mesh(sconce, glow); s.position.set(x, 4.2, -FH / 2 + 0.2); scene.add(s); }
    for (let z = -FH / 2 + 8; z < FH / 2; z += 12) { const s = new T.Mesh(sconce, glow); s.position.set(-FW / 2 + 0.2, 4.2, z); scene.add(s); }
    // gold arches at the three real entrances
    const post = new T.CylinderGeometry(0.28, 0.32, 4.4, 14), arcGeo = new T.TorusGeometry(1.9, 0.26, 10, 28, Math.PI);
    const arch = (x, z, rotY) => {
      const g = new T.Group();
      const p1 = new T.Mesh(post, gold); p1.position.set(-1.9, 2.2, 0); const p2 = p1.clone(); p2.position.x = 1.9;
      const top = new T.Mesh(arcGeo, gold); top.position.y = 4.4;
      const lamp = new T.Mesh(new T.SphereGeometry(0.4, 14, 10), glow); lamp.position.y = 6.3;
      g.add(p1, p2, top, lamp); [p1, p2, top].forEach((m) => { m.castShadow = true; });
      g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
    };
    arch(wx(FX0 + 0.8), wz(50), Math.PI / 2);   // main doors, west wall
    arch(wx(62), wz(FY0 + 0.8), 0);            // hotel lobby, north wall
    arch(wx(FX1 - 0.8), wz(110), Math.PI / 2); // garage doors, east rail
    // house sign on the back wall
    const sign = neonSprite("THE GILDED ACE", "#ffd36b");
    sign.scale.set(7 * sign.userData.aspect, 7, 1); sign.position.set(0, 10.5, -FH / 2 - 0.4); scene.add(sign);
  }

  // ---------- machines (instanced) ----------
  const PARTS = [
    // name, geometry factory, material key, offset [x, y, z], rotation x, colored by data
    ["body", () => new T.BoxGeometry(1.15, 1.2, 0.78), "lacquer", [0, 0.6, 0], 0, false],
    ["trim", () => new T.BoxGeometry(1.2, 0.07, 0.83), "gold", [0, 1.23, 0], 0, false],
    ["deck", () => new T.BoxGeometry(1.0, 0.09, 0.34), "deck", [0, 0.78, 0.5], 0, false],
    ["seat", () => new T.CylinderGeometry(0.3, 0.3, 0.14, 18), "leather", [0, 0.62, 1.08], 0, false],
    ["leg", () => new T.CylinderGeometry(0.06, 0.06, 0.52, 8), "chrome", [0, 0.28, 1.08], 0, false],
    ["stick", () => new T.CylinderGeometry(0.045, 0.045, 0.5, 8), "chrome", [0.38, 1.85, -0.22], 0, false],
    ["screen", () => new T.PlaneGeometry(0.92, 0.6), "lit", [0, 1.0, 0.405], -0.22, true],
    ["topper", () => new T.BoxGeometry(1.08, 0.36, 0.6), "lit", [0, 1.44, -0.05], 0, true],
    ["bulb", () => new T.SphereGeometry(0.13, 12, 10), "lit", [0.38, 2.14, -0.22], 0, true],
  ];
  function buildMachines() {
    const mats = {
      lacquer: new T.MeshStandardMaterial({ color: 0x1c1b1f, roughness: 0.35, metalness: 0.4 }),
      gold: new T.MeshStandardMaterial({ color: 0xc9a34a, roughness: 0.3, metalness: 0.9 }),
      deck: new T.MeshStandardMaterial({ color: 0x5c1a22, roughness: 0.5, emissive: 0x3a0a12, emissiveIntensity: 0.6 }),
      leather: new T.MeshStandardMaterial({ color: 0x8c2a24, roughness: 0.55 }),
      chrome: new T.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.25, metalness: 0.9 }),
    };
    const N = SLOTS.length;
    for (const [name, geoFn, matKey, , , colored] of PARTS) {
      const mat = colored ? new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }) : mats[matKey];
      const mesh = new T.InstancedMesh(geoFn(), mat, N);
      mesh.castShadow = !colored; mesh.receiveShadow = false;
      if (colored) mesh.setColorAt(0, new T.Color(0xffffff));
      mesh.userData.part = name;
      scene.add(mesh); parts[name] = mesh;
    }
    const padGeo = new T.EdgesGeometry(new T.BoxGeometry(1.15, 0.02, 0.8));
    const padMat = new T.LineBasicMaterial({ color: 0xe3cf93, transparent: true, opacity: 0.85 });
    SLOTS.forEach((s) => { const pad = new T.LineSegments(padGeo, padMat); pad.position.set(wx(s.x), 0.04, wz(s.y)); pad.visible = false; scene.add(pad); pads.push(pad); });
    placeAll();
  }
  /** Write every part's instance matrix: real position for occupied slots, zero scale for empty ones. */
  function placeAll(lift) {
    const M = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), S1 = new T.Vector3(1, 1, 1), S0 = new T.Vector3(0, 0, 0), V = new T.Vector3();
    SLOTS.forEach((s, i) => {
      const on = Boolean(occupant[i]);
      const dy = lift && lift[i] ? lift[i] : 0;
      for (const [name, , , off, rx] of PARTS) {
        E.set(rx, 0, 0); Q.setFromEuler(E);
        V.set(wx(s.x) + off[0], off[1] + dy, wz(s.y) + off[2]);
        M.compose(V, Q, on ? S1 : S0);
        parts[name].setMatrixAt(i, M);
      }
      pads[i].visible = !on;
    });
    for (const name in parts) parts[name].instanceMatrix.needsUpdate = true;
  }
  function paintColors(pulse) {
    const C = new T.Color(), W = new T.Color(0xffffff), Rh = new T.Color(0xffe0d8);
    SLOTS.forEach((s, i) => {
      if (!occupant[i]) return;
      C.set(baseColor[i] || "#888888");
      if (pulse != null && flagged.includes(i)) C.lerp(Rh, pulse);
      parts.screen.setColorAt(i, C);
      parts.topper.setColorAt(i, C.clone().multiplyScalar(0.82));
      parts.bulb.setColorAt(i, C.clone().lerp(W, 0.25));
    });
    ["screen", "topper", "bulb"].forEach((n) => { if (parts[n].instanceColor) parts[n].instanceColor.needsUpdate = true; });
  }

  // ---------- neon signs ----------
  /** Glowing text on a canvas sized to the text; sprite.userData.aspect = width / height. */
  function neonSprite(text, color, h = 150) {
    const font = `800 ${Math.round(h * 0.56)}px Manrope, system-ui, sans-serif`;
    const probe = document.createElement("canvas").getContext("2d"); probe.font = font;
    const w = Math.ceil(probe.measureText(text).width + h * 0.7);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = color; ctx.shadowBlur = h * 0.22; ctx.fillStyle = color;
    for (let k = 0; k < 3; k++) ctx.fillText(text, w / 2, h / 2);
    ctx.shadowBlur = 0; ctx.fillStyle = "#fff8e6"; ctx.globalAlpha = 0.85; ctx.fillText(text, w / 2, h / 2);
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding;
    const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    spr.userData.aspect = w / h;
    return spr;
  }
  function buildSigns() {
    for (const z of Object.values(ZONES)) {
      const e = EXT[z.id]; if (!e) continue;
      const spr = neonSprite(z.name.toUpperCase(), z.id === "Z-HL" ? "#ff5fa2" : "#ffcf5a");
      const SIGN_H = 5.4; // metres tall
      const len = SIGN_H * spr.userData.aspect;
      spr.scale.set(len, SIGN_H, 1);
      // sit the sign where the name used to be painted, nudged up so it hovers just above the floor
      const [mx, my, align] = labelPointM(z.id, e);
      const cx = align === "right" ? mx - len * 0.45 : mx + len * 0.45;
      spr.position.set(wx(cx), 3.2, wz(my - 2));
      scene.add(spr); signs[z.id] = spr;
    }
  }

  // ---------- bloom ----------
  function setupBloom() {
    try {
      if (!(T.EffectComposer && T.RenderPass && T.UnrealBloomPass)) return;
      composer = new T.EffectComposer(renderer);
      composer.addPass(new T.RenderPass(scene, camera));
      bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.6, 0.45, 0.88);
      composer.addPass(bloom);
      if (T.ShaderPass && T.GammaCorrectionShader) composer.addPass(new T.ShaderPass(T.GammaCorrectionShader));
    } catch (e) { composer = null; }
  }

  /** Switch rendering quality. Shadows of the static floor are drawn once and refreshed only when machines change. */
  F3.setQuality = function (q) {
    quality = q;
    const shadows = q !== "low";
    renderer.shadowMap.enabled = shadows; keyLight.castShadow = shadows;
    zoneLights.forEach((l) => { l.visible = q === "high"; });
    hemi.intensity = q === "high" ? 0.62 : 0.8;
    renderer.setPixelRatio(q === "low" ? 1 : Math.min(window.devicePixelRatio || 1, q === "high" ? 1.5 : 1.25));
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    keyLight.shadow.needsUpdate = true;
    resize(); needsRender = true;
  };
  F3.getQuality = () => quality;

  F3.resetView = function () { camera.position.set(0, 128, 98); controls.target.set(0, 0, 6); controls.update(); needsRender = true; };
  F3.setVisible = function (v) { visible = v; lastFrame = 0; needsRender = true; };
  F3.setRunning = function (r) { running = r; lastFrame = 0; const b = container && container.querySelector("[data-toggle-guests]"); if (b) { b.textContent = r ? "Pause guests" : "Play guests"; b.setAttribute("aria-pressed", String(!r)); } };
  F3.isRunning = () => running;
  F3.setSpeed = (s) => { speed = s; };
  F3.setHour = (h) => { simHour = ((h % 24) + 24) % 24; drawClock(); needsRender = true; };
  F3.getHour = () => simHour;
  function drawClock() {
    if (!clockEl) return;
    const h = Math.floor(simHour), m = Math.floor((simHour % 1) * 60);
    clockEl.textContent = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} · ${guests.length} guest${guests.length === 1 ? "" : "s"} on the floor`;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    if (composer) { composer.setSize(w, h); if (bloom) bloom.resolution.set(w, h); }
    camera.aspect = w / h; camera.updateProjectionMatrix(); needsRender = true;
  }

  // ---------- update from page state ----------
  F3.update = function ({ occ, byId, sc, metric, selectedId, zoneIdx }) {
    flagged = []; selectedIdx = -1;
    SLOTS.forEach((s, i) => {
      const p = occ[s.slot], m = p && byId[p.machine];
      occupant[i] = m ? m.machine : null;
      if (!m) return;
      baseColor[i] = sc.color3d ? sc.color3d(m) : sc.color(m);
      if (metric === "payout" && m.hitZ != null && Math.abs(m.hitZ) > 5) flagged.push(i);
      if (m.machine === selectedId) selectedIdx = i;
    });
    placeAll();
    paintColors(null);
    if (keyLight) keyLight.shadow.needsUpdate = true;
    if (selectedIdx >= 0) { const s = SLOTS[selectedIdx]; ring.visible = true; ring.position.x = wx(s.x); ring.position.z = wz(s.y) + 0.3; } else ring.visible = false;
    // neon brightness follows each zone's game-adjusted earnings (1.00 = same game elsewhere)
    for (const [id, spr] of Object.entries(signs)) {
      const zi = zoneIdx[id]; const v = zi ? zi.idx : 1;
      spr.material.opacity = Math.max(0.5, Math.min(1, 0.4 + (v - 0.6) * 1.1));
    }
    updateRouting();
    paintFloor(zoneIdx, routing.closed);
    needsRender = true;
  };

  F3.focusSelected = function () {
    if (selectedIdx < 0) return;
    const s = SLOTS[selectedIdx];
    controls.target.set(wx(s.x), 0, wz(s.y)); camera.position.set(wx(s.x) + 9, 22, wz(s.y) + 24); controls.update(); needsRender = true;
  };
  /** Screen position of a machine's cabinet inside the 3D box (used for testing clicks). */
  F3.screenPos = (machineId) => {
    const i = occupant.indexOf(machineId); if (i < 0) return null;
    const s = SLOTS[i], v = new T.Vector3(wx(s.x), 1.3, wz(s.y)); v.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  /** Snapshot of the guest simulation, for checking that it follows the traffic data. */
  F3.stats = () => {
    const byZone = {}, byState = {};
    for (const g of guests) { byZone[g.zone] = (byZone[g.zone] || 0) + 1; byState[g.state] = (byState[g.state] || 0) + 1; }
    return { guests: guests.length, target: routing.target, closed: routing.closed, usingClosedWalkway: guests.filter((g) => g.usesClosed).length, byZone, byState,
      machines: occupant.filter(Boolean).length, zoneWeights: Object.fromEntries(Object.entries(routing.zoneW).map(([k, v]) => [k, Math.round(v)])) };
  };

  // ---------- picking ----------
  function bindPointer() {
    const rc = new T.Raycaster(), v = new T.Vector2(); let down = null;
    const pickMeshes = [parts.body, parts.topper, parts.screen];
    const hit = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rc.setFromCamera(v, camera);
      const h = rc.intersectObjects(pickMeshes, false).find((x) => x.instanceId != null && occupant[x.instanceId]);
      return h ? occupant[h.instanceId] : null;
    };
    renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointermove", (e) => {
      const id = hit(e);
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      if (!id || !callbacks.describe) { tip.hidden = true; return; }
      const r = container.getBoundingClientRect();
      tip.hidden = false; tip.textContent = callbacks.describe(id);
      tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`;
    });
    renderer.domElement.addEventListener("pointerleave", () => { tip.hidden = true; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const id = hit(e); if (id) callbacks.onPick(id);
    });
  }

  // ---------- guests driven by zone foot traffic ----------
  function lastDay(month) { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
  function updateRouting() {
    const from = A.state.from + "-01", to = lastDay(A.state.to);
    const days = D.traffic_day.filter((r) => r[0] >= from && r[0] <= to);
    const perZone = {};
    for (const r of days) { const rate = r[3] ? r[2] / r[3] : 0; perZone[r[1]] = (perZone[r[1]] || 0) + rate; }
    const nDays = new Set(days.map((r) => r[0])).size || 1;
    routing.zoneW = Object.fromEntries(Object.entries(perZone).map(([z, v]) => [z, v / nDays]));
    const closedDays = new Set(days.filter((r) => r[0] >= CLOSED_FROM && r[0] <= CLOSED_TO).map((r) => r[0])).size;
    routing.closed = closedDays / nDays > 0.5;
    routing.doorW = DOORS.map((d) => ({ door: d, w: routing.zoneW[d.zone] || 1 }));
    routing.hourly = Array.from({ length: 24 }, (_, h) => D.traffic_hour.filter((r) => r[1] === h).reduce((a, r) => a + r[2], 0));
    routing.hourMax = Math.max(...routing.hourly);
    routing.scale = Object.values(routing.zoneW).reduce((a, b) => a + b, 0) / 620; // about 1.0 for a typical month
    guests.forEach((g) => { if (routing.closed && g.usesClosed) g.dead = true; });
  }
  function graph() {
    const adj = {};
    for (const w of D.walkways) {
      if (routing.closed && w[4]) continue;
      const a = ZONES[w[1]], b = ZONES[w[2]]; if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      (adj[a.id] = adj[a.id] || []).push([b.id, d]); (adj[b.id] = adj[b.id] || []).push([a.id, d]);
    }
    return adj;
  }
  function route(fromZone, toZone) {
    const adj = graph(), dist = { [fromZone]: 0 }, prev = {}, q = new Set(Object.keys(ZONES));
    while (q.size) {
      let u = null; for (const n of q) if (dist[n] != null && (u == null || dist[n] < dist[u])) u = n;
      if (u == null || u === toZone) break; q.delete(u);
      for (const [v, w] of adj[u] || []) { const nd = dist[u] + w; if (dist[v] == null || nd < dist[v]) { dist[v] = nd; prev[v] = u; } }
    }
    if (dist[toZone] == null) return null;
    const path = [toZone]; while (path[0] !== fromZone) path.unshift(prev[path[0]]);
    return path;
  }
  const pickW = (items, wf) => { const tot = items.reduce((a, x) => a + wf(x), 0); let r = Math.random() * tot; for (const x of items) { r -= wf(x); if (r <= 0) return x; } return items[items.length - 1]; };
  const gGeo = {}, gMat = [];
  const seatsIn = (zone) => SLOTS.filter((s, i) => s.zone === zone && occupant[i]);
  function spawnGuest() {
    if (!gGeo.body) {
      gGeo.body = new T.CylinderGeometry(0.26, 0.34, 1.05, 10); gGeo.head = new T.SphereGeometry(0.22, 12, 10);
      OUTFITS.forEach((c) => gMat.push(new T.MeshStandardMaterial({ color: c, roughness: 0.7 }))); gGeo.skin = new T.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 });
    }
    const door = pickW(routing.doorW, (d) => d.w).door;
    const dest = pickW(Object.keys(routing.zoneW), (z) => routing.zoneW[z]);
    const zr = route(door.zone, dest); if (!zr) return;
    const seats = seatsIn(dest); if (!seats.length) return;
    const seat = seats[Math.floor(Math.random() * seats.length)];
    const pts = [[door.x, door.y], ...zr.map((z) => [ZONES[z].x + (Math.random() - 0.5) * 2.4, ZONES[z].y + (Math.random() - 0.5) * 2.4]), [seat.x, seat.y + 1.08]];
    const g = new T.Group();
    const body = new T.Mesh(gGeo.body, gMat[Math.floor(Math.random() * gMat.length)]); body.position.y = 0.55;
    const head = new T.Mesh(gGeo.head, gGeo.skin); head.position.y = 1.3;
    g.add(body, head); g.scale.setScalar(1.7); g.position.set(wx(door.x), 0, wz(door.y)); guestRoot.add(g);
    const usesClosed = zr.some((z, i) => i && ((z === "Z-B40" && zr[i - 1] === "Z-ENT") || (z === "Z-ENT" && zr[i - 1] === "Z-B40")));
    guests.push({ g, pts, i: 1, state: "walk", wait: 0, speed: 3.2 + Math.random() * 1.6, zone: dest, seat, phase: Math.random() * 6, usesClosed });
  }
  function leave(gu) {
    const best = DOORS.reduce((b, d) => { const r = route(gu.zone, d.zone); return r && (!b || r.length < b.r.length) ? { d, r } : b; }, null);
    if (!best) { gu.dead = true; return; }
    gu.pts = [[gu.seat.x, gu.seat.y + 1.08], ...best.r.map((z) => [ZONES[z].x, ZONES[z].y]), [best.d.x, best.d.y]]; gu.i = 1; gu.state = "exit";
  }
  function stepGuests(dt) {
    const hourFactor = routing.hourMax ? routing.hourly[Math.floor(simHour) % 24] / routing.hourMax : 1;
    routing.target = Math.round(18 + 62 * hourFactor * Math.min(1.3, routing.scale || 1));
    const active = guests.filter((g) => !g.dead).length;
    if (active < routing.target && Math.random() < dt * 6) spawnGuest();
    for (const gu of guests) {
      if (gu.dead) continue;
      if (gu.state === "play") {
        gu.wait -= dt; gu.g.position.y = 0;
        if (gu.wait <= 0) {
          if (Math.random() < 0.35 && active <= routing.target) {
            const z = pickW(Object.keys(routing.zoneW), (k) => routing.zoneW[k]); const r = route(gu.zone, z); const seats = seatsIn(z);
            if (r && seats.length) { const seat = seats[Math.floor(Math.random() * seats.length)]; gu.pts = [[gu.seat.x, gu.seat.y + 1.08], ...r.map((k) => [ZONES[k].x, ZONES[k].y]), [seat.x, seat.y + 1.08]]; gu.i = 1; gu.zone = z; gu.seat = seat; gu.state = "walk"; continue; }
          }
          leave(gu);
        }
        continue;
      }
      const [tx, ty] = gu.pts[gu.i];
      const px = gu.g.position.x + CX, py = gu.g.position.z + CY;
      const dx = tx - px, dy = ty - py, d = Math.hypot(dx, dy), step = gu.speed * dt;
      if (d <= step) {
        gu.g.position.set(wx(tx), 0, wz(ty)); gu.i++;
        if (gu.i >= gu.pts.length) {
          if (gu.state === "exit") gu.dead = true;
          else { gu.state = "play"; gu.wait = 14 + Math.random() * 22; gu.g.rotation.y = Math.PI; }
        }
      } else {
        gu.g.position.x += (dx / d) * step; gu.g.position.z += (dy / d) * step;
        gu.g.rotation.y = Math.atan2(dx, dy);
        gu.phase += dt * 10; gu.g.position.y = Math.abs(Math.sin(gu.phase)) * 0.08;
      }
    }
    for (const gu of guests) if (gu.dead && gu.g.parent) guestRoot.remove(gu.g);
    guests = guests.filter((g) => !g.dead);
  }

  // ---------- loop ----------
  function loop(t) {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) { lastFrame = 0; return; }
    const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0; lastFrame = t;
    controls.update();
    if (running && dt) {
      const simDt = dt * speed; // guests and clock share one time scale
      simHour = (simHour + simDt / SECONDS_PER_SIM_HOUR) % 24;
      stepGuests(simDt); needsRender = true;
      clockTick += dt;
      if (clockTick > 0.25) { clockTick = 0; drawClock(); if (callbacks.onClock) callbacks.onClock(simHour); }
    }
    if (flagged.length) { pulseT += dt; paintColors(0.5 + 0.5 * Math.sin(pulseT * 5)); needsRender = true; }
    if (ring.visible) { ring.rotation.z += dt * 0.8; needsRender = true; }
    if (needsRender) {
      const t0 = performance.now();
      if (composer && quality === "high") composer.render(); else renderer.render(scene, camera);
      needsRender = false;
      adaptQuality(performance.now() - t0, dt);
    }
  }
  /** Watch real frame times for the first moments on screen and step quality down if the machine struggles. */
  function adaptQuality(renderMs, dt) {
    if (perf.settled || !dt) return;
    perf.frames++; perf.time += dt;
    if (perf.frames < 45) return;
    const fps = perf.frames / perf.time;
    perf.frames = 0; perf.time = 0;
    if (fps >= 28) { perf.settled = true; return; }
    if (quality === "high") F3.setQuality("medium");
    else if (quality === "medium") F3.setQuality("low");
    else perf.settled = true;
  }
})();
