'use strict';
/* =====================================================================
   LIBERTY BLOCKS — Top-Down Roleplay Live-Simulator
   Alles in einer Datei, kein Framework, kein Build nötig.
   ===================================================================== */

/* ---------------- Utilities ---------------- */
const TAU = Math.PI * 2;
const rnd  = (a, b) => a + Math.random() * (b - a);
const ri   = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const d2    = (ax, ay, bx, by) => { const x = ax - bx, y = ay - by; return x * x + y * y; };
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function mul32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- Konstanten ---------------- */
const T = 40, SEG = 12, NB = 8, MAPT = SEG * NB + 2, WORLD = MAPT * T;
const ROADS = NB + 1;                       // 9 Strassenbaender pro Achse
const DAY_LEN = 240;                        // ein Spieltag = 4 min
const AUTO = /[?&]auto=/.test(location.href);

const CAR_KIND = {
  sedan:  { w: 36, h: 17, max: 295, col: ['#8a2f2f', '#2f5a8a', '#5a6c50', '#7d7d84', '#b8b0a4', '#3c3c40'] },
  sport:  { w: 37, h: 15, max: 380, col: ['#d83125', '#e8b71e', '#d84bd8', '#2fd8a0'] },
  van:    { w: 46, h: 21, max: 230, col: ['#6b7f92', '#8a8a8a', '#c8bfae'] },
  taxi:   { w: 37, h: 17, max: 305, col: ['#f4c11c'] },
  police: { w: 37, h: 17, max: 345, col: ['#e8e8ee'] },
};
const WEAPONS = [
  { name: 'Faust',   melee: true, dmg: 10, range: 30, rate: 0.38 },
  { name: 'Bat',     melee: true, dmg: 26, range: 40, rate: 0.55 },
  { name: 'Pistole', melee: false, dmg: 26, rate: 0.30, spread: 0.05, spd: 950, auto: false },
  { name: 'MP',      melee: false, dmg: 15, rate: 0.09, spread: 0.17, spd: 880, auto: true },
];

/* ---------------- Stadt-Generierung ---------------- */
const blocks = [];
const SPECIAL = { police: [3, 3], hospital: [4, 4], ammu: [2, 5], spray: [5, 2], rest: [6, 3], bank: [3, 6], depot: [7, 7] };
const BLD_COL = ['#6d6257', '#7a6a5a', '#5f6b74', '#75636b', '#68795f', '#7b7464', '#5c5668'];

(function buildCity() {
  const R = mul32(1337);
  for (let by = 0; by < NB; by++) { blocks[by] = []; for (let bx = 0; bx < NB; bx++) blocks[by][bx] = { kind: 'bld' }; }
  for (const k in SPECIAL) { const [bx, by] = SPECIAL[k]; blocks[by][bx] = { kind: k }; }
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    if (blocks[by][bx].kind !== 'bld') continue;
    const r = R();
    blocks[by][bx] = r < 0.17 ? { kind: 'park' } : r < 0.32 ? { kind: 'lot' } : { kind: 'bld' };
  }
})();

const isRoadIdx = i => (i % SEG) < 2;
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAPT || ty >= MAPT) return 'x';
  if (isRoadIdx(tx) || isRoadIdx(ty)) return 'r';
  const b = blocks[ty / SEG | 0][tx / SEG | 0];
  const sx = tx % SEG - 2, sy = ty % SEG - 2;
  if (sx === 0 || sx === 9 || sy === 0 || sy === 9) return 'w';   // sidewalk
  if (b.kind === 'park') return 'g';
  if (b.kind === 'bld') return 'b';
  return 'p';                                                     // lot/spray = befahrbar
}
function blocked(wx, wy) { const c = tileAt(wx / T | 0, wy / T | 0); return c === 'b' || c === 'x'; }
function blockFront(bx, by) { return { x: (bx * SEG + 7) * T, y: (by * SEG + 11.5) * T }; }

/* ---------------- Canvas ---------------- */
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
let VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  VW = window.innerWidth; VH = window.innerHeight;
  cvs.width = VW * DPR; cvs.height = VH * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

/* ---------------- Zustand ---------------- */
const G = {
  time: 0.35, day: 1, cam: { x: 0, y: 0 }, shake: 0,
  cars: [], peds: [], bullets: [], parts: [], decals: [], pickups: [], lamps: [],
  overlay: { t: 'intro' }, msg: [], playing: false, muted: false,
};
const P = {
  x: 0, y: 0, a: 0, aim: 0, hp: 100, ar: 0, money: 320, wanted: 0, hidden: 0,
  wi: 0, ammo: [Infinity, Infinity, 0, 0], own: [true, false, false, false],
  car: null, coolS: 0, coolE: 0, walkPh: 0, dead: 0,
};
P.x = (SPECIAL.hospital[0] * SEG + 7) * T; P.y = (SPECIAL.hospital[1] * SEG + 11.5) * T - 6;
const JOB = { taxi: 'off', taxiId: null, paused: false, dest: null, fromX: 0, fromY: 0, courier: 'off', courierTo: null };
const BANK_CD = { t: 0 };
const SPRAY = { x0: (SPECIAL.spray[0] * SEG + 3) * T, y0: (SPECIAL.spray[1] * SEG + 3) * T, w: 3 * T, h: 8 * T, cd: 0 };
function sprayZone() {
  const c = P.car;
  if (!c || P.dead) { if (SPRAY.cd > 0) SPRAY.cd = 0; return; }
  if (SPRAY.cd > 0) { SPRAY.cd -= 1 / 60; return; }
  if (c.x > SPRAY.x0 - 10 && c.x < SPRAY.x0 + SPRAY.w + 10 && c.y > SPRAY.y0 && c.y < SPRAY.y0 + SPRAY.h && Math.hypot(c.vx, c.vy) < 60) {
    if (P.wanted === 0 && c.hp > 89) return;
    if (P.money < 200) { msg("Pay'n'Spray: $200 noetig!", '#ff5a4e'); SPRAY.cd = 3; return; }
    P.money -= 200; P.wanted = 0; P.hidden = 0; c.hp = 100; c.fire = 0;
    sCash(); G.shake = 3;
    msg("Pay'n'Spray: Neuer look, sterile Akten. -200$, Fahndung geloescht!", '#ff9b2e');
    SPRAY.cd = 4;
  }
}

/* ---------------- Audio ---------------- */
const SND = { ctx: null, master: null, eng: null, engG: null, sir: null, sirG: null, sirT: 0, sirF: 0 };
function sfxInit() {
  if (SND.ctx) return;
  try {
    SND.ctx = new (window.AudioContext || window.webkitAudioContext)();
    SND.master = SND.ctx.createGain(); SND.master.gain.value = 0.5; SND.master.connect(SND.ctx.destination);
    SND.eng = SND.ctx.createOscillator(); SND.eng.type = 'sawtooth'; SND.eng.frequency.value = 50;
    SND.engG = SND.ctx.createGain(); SND.engG.gain.value = 0; SND.eng.connect(SND.engG).connect(SND.master); SND.eng.start();
    SND.sir = SND.ctx.createOscillator(); SND.sir.type = 'square'; SND.sir.frequency.value = 700;
    SND.sirG = SND.ctx.createGain(); SND.sirG.gain.value = 0; SND.sir.connect(SND.sirG).connect(SND.master); SND.sir.start();
  } catch (e) { SND.ctx = null; }
}
function beep(freq, dur, type, vol) {
  if (!SND.ctx || G.muted) return;
  try {
    const o = SND.ctx.createOscillator(), g = SND.ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, SND.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, SND.ctx.currentTime + dur);
    o.connect(g).connect(SND.master); o.start(); o.stop(SND.ctx.currentTime + dur);
  } catch (e) {}
}
function noiseHit(dur, vol, lp) {
  if (!SND.ctx || G.muted) return;
  try {
    const n = Math.floor(SND.ctx.sampleRate * dur), buf = SND.ctx.createBuffer(1, n, SND.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = SND.ctx.createBufferSource(); src.buffer = buf;
    const f = SND.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 2400;
    const g = SND.ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f).connect(g).connect(SND.master); src.start();
  } catch (e) {}
}
const sShot  = () => { noiseHit(0.09, 0.5, 3200); beep(90, 0.06, 'square', 0.1); };
const sPunch = () => noiseHit(0.06, 0.35, 900);
const sCash  = () => { beep(880, 0.08, 'sine', 0.18); setTimeout(() => beep(1320, 0.1, 'sine', 0.18), 70); };
const sBoom  = () => { noiseHit(0.7, 0.8, 500); beep(55, 0.5, 'sine', 0.4); };
const sHurt  = () => beep(180, 0.12, 'sawtooth', 0.12);
const sStar  = () => beep(440, 0.25, 'sine', 0.2);

/* ---------------- RP-Feed ---------------- */
function msg(text, col) {
  G.msg.push({ t: String(text).slice(0, 110), c: col || '#dfe6f2', life: 6.5 });
  if (G.msg.length > 7) G.msg.shift();
}
const PED_LINES = ['Ey! Pass auf, wo du faehrst!', 'Ich bin unschuldig, Officer!', 'Nette Karre, Boss.', 'Mann, ich brauche einen Drink…', 'Hast du einen Dollar? Nein? Mist.', 'Dieser Stadtteil wird immer schlimmer.', 'Laufst du etwa zu Fuss?! Krass.', 'Ich bin gleich da, Schatz, versprochen.'];
const pedSays = (line) => msg('Urbaner Buerger: \u201E' + line + '\u201C', '#9fb4d8');

/* ---------------- Entities ---------------- */
const CIV_SHIRTS = ['#c94f4f', '#4f77c9', '#4fc97a', '#c9b64f', '#9a4fc9', '#4fc9c1', '#e08a4f', '#c9528f', '#8892a0'];
function mkPed(x, y, type) {
  return { x, y, a: rnd(0, TAU), type, hp: type === 'cop' ? 60 : 30, state: 'walk',
    shirt: type === 'cop' ? '#2e4a8e' : pick(CIV_SHIRTS),
    spd: type === 'cop' ? 96 : rnd(34, 58), chat: rnd(6, 30), dead: 0, shootCd: rnd(0.5, 2),
    flee: 0, fx: 0, fy: 0, st: { x, y }, waitT: 0, taxiJobId: undefined, steer: 0 };
}
function mkCar(x, y, a, type) {
  const k = CAR_KIND[type];
  return { x, y, a, type, w: k.w, h: k.h, max: k.max, hp: type === 'police' ? 120 : 100,
    vx: 0, vy: 0,
    color: type === 'police' ? '#e8e8ee' : type === 'taxi' ? '#f4c11c' : pick(k.col),
    driver: null, ai: null, parked: false, panic: 0, siren: false, stuck: 0, rev: 0,
    hitByPlayer: false, fire: 0 };
}

/* Strassennetz:Nodes an Kreuzungszentren */
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];                 // 0=E 1=S 2=W 3=N
const LANE = [[0, T / 2], [T / 2, 0], [0, -T / 2], [-T / 2, 0]];
const nodePos = (vi, hi) => ({ x: vi * SEG * T + T, y: hi * SEG * T + T });
const nodeStep = (vi, hi, d) => ({ vi: vi + DX[d], hi: hi + DY[d] });
const okNode = n => n.vi >= 0 && n.vi < ROADS && n.hi >= 0 && n.hi < ROADS;

/* ---------------- Spawner ---------------- */
function randWalkable(cx, cy, r0, r1, fb) {
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, TAU), r = rnd(r0, r1);
    const x = clamp(cx + Math.cos(a) * r, T * 2, WORLD - T * 2), y = clamp(cy + Math.sin(a) * r, T * 2, WORLD - T * 2);
    if (!blocked(x, y)) return { x, y };
  }
  return fb;
}
/* Auto auf einem Strassenband nahe des Spielers spawen */
function laneSpawnPoint(horiz, insist) {
  for (let i = 0; i < 9; i++) {
    const k = ri(0, ROADS - 1);
    const lim = WORLD - 260;
    const along = clamp((horiz ? P.x : P.y) + rnd(-900, 900), 260, lim);
    const dir = horiz ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3);
    const laneC = k * SEG * T + T + (dir === 0 || dir === 3 ? T / 2 : -T / 2);
    const x = horiz ? along : laneC, y = horiz ? laneC : along;
    if (blocked(x, y)) continue;
    const dq = d2(x, y, P.x, P.y);
    if (dq < 430 * 430 || dq > 980 * 980) continue;
    let ok = true;
    for (const c of G.cars) if (d2(c.x, c.y, x, y) < 110 * 110) { ok = false; break; }
    if (!ok) continue;
    return { x, y, dir, k, along };
  }
  return null;
}
function spawnTraffic() {
  let want = 22;
  for (const c of G.cars) if (c.driver === 'ai' && c.type !== 'police') want--;
  if (want <= 0) return;
  const horiz = Math.random() < 0.5;
  const sp = laneSpawnPoint(horiz);
  if (!sp) return;
  const { x, y, dir, k, along } = sp;
  const car = mkCar(x, y, Math.atan2(DY[dir], DX[dir]), pick(['sedan', 'sedan', 'taxi', 'sport', 'van']));
  car.driver = 'ai';
  // Node "gerade passiert" bestimmen
  const s = (along - T) / (SEG * T);
  const idx = dir === 0 || dir === 1 ? Math.floor(s) : Math.ceil(s);   // hinter uns liegend
  car.ai = horiz ? { vi: clamp(idx, 0, ROADS - 1), hi: k, dir } : { vi: k, hi: clamp(idx, 0, ROADS - 1), dir };
  const ns = nodeStep(car.ai.vi, car.ai.hi, dir);
  const pos = okNode(ns) ? nodePos(ns.vi, ns.hi) : nodePos(car.ai.vi, car.ai.hi);
  car.wp = { x: pos.x + LANE[dir][0], y: pos.y + LANE[dir][1] };
  G.cars.push(car);
}
function spawnPeds() {
  let civ = 0;
  for (const p of G.peds) if (p.type === 'civ' && p.state !== 'dead') civ++;
  if (civ >= 32) return;
  const q = randWalkable(P.x, P.y, 470, 780, null);
  if (q) G.peds.push(mkPed(q.x, q.y, 'civ'));
}
function spawnPolice() {
  let foot = 0, cars = 0;
  for (const p of G.peds) if (p.type === 'cop' && p.state !== 'dead') foot++;
  for (const c of G.cars) if (c.type === 'police' && c.driver === 'cop') cars++;
  const wantFoot = P.wanted >= 1 ? Math.min(2 + Math.floor(P.wanted) * 2, 8) : 0;
  const wantCars = P.wanted >= 2 ? Math.min(Math.floor(P.wanted) - 1, 4) : 0;
  if (foot < wantFoot) {
    const q = randWalkable(P.x, P.y, 330, 640, null);
    if (q) { const c = mkPed(q.x, q.y, 'cop'); c.state = 'chase'; G.peds.push(c); if (foot === 0) msg('Polizei rueckt aus!', '#ff8866'); }
  }
  if (cars < wantCars) {
    const sp = laneSpawnPoint(Math.random() < 0.5, 'far');
    if (sp) {
      const c = mkCar(sp.x, sp.y, Math.atan2(DY[sp.dir], DX[sp.dir]), 'police');
      c.driver = 'cop'; c.siren = true; G.cars.push(c);
    }
  }
}
function despawnEntities() {
  G.cars = G.cars.filter(c => {
    if (c === P.car || c.parked) return true;
    const far = d2(c.x, c.y, P.x, P.y) > 1150 * 1150;
    if (c.type === 'police' && P.wanted === 0) return !far && d2(c.x, c.y, P.x, P.y) < 900 * 900;
    return !far;
  });
  G.peds = G.peds.filter(p => {
    if (p.state === 'dead') { p.dead -= 1 / 60; return p.dead > 0; }
    if (p.type === 'civ' && d2(p.x, p.y, P.x, P.y) > 1150 * 1150) return false;
    if (p.type === 'cop') {
      if (P.wanted === 0 && d2(p.x, p.y, P.x, P.y) > 720 * 720) return false;
      if (d2(p.x, p.y, P.x, P.y) > 1900 * 1900) return false;
    }
    return true;
  });
}

/* ---------------- Verbrechen ---------------- */
function crime(n, why) {
  const before = Math.floor(P.wanted);
  P.wanted = clamp(P.wanted + n, 0, 6); P.hidden = 0;
  if (Math.floor(P.wanted) > before) {
    sStar();
    msg(why ? why + ' Fahndung: ' + '\u2605'.repeat(Math.floor(P.wanted)) : 'Fahndung steigt!', '#ff5a4e');
  }
}
function copNear(x, y, r) {
  for (const p of G.peds) if (p.type === 'cop' && p.state !== 'dead' && d2(p.x, p.y, x, y) < r * r) return true;
  for (const c of G.cars) if (c.type === 'police' && d2(c.x, c.y, x, y) < r * r) return true;
  return false;
}

/* ---------------- Schaden ---------------- */
function bullet(x, y, a, spd, pl) {
  G.bullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 0.55, pl });
}
function part(x, y, vx, vy, life, col, size, grav) {
  if (G.parts.length > 320) G.parts.shift();
  G.parts.push({ x, y, vx, vy, life, max: life, col, size, grav: grav || 0 });
}
function blood(x, y, n) {
  for (let i = 0; i < n; i++) part(x, y, rnd(-70, 70), rnd(-70, 70), rnd(0.2, 0.5), '#a3122b', rnd(1.5, 3.5));
  if (G.decals.length > 140) G.decals.shift();
  G.decals.push({ x, y, r: rnd(9, 14), c: 'rgba(120,10,25,0.55)' });
}
function panicArea(x, y, r) {
  for (const pe of G.peds) if (pe.type === 'civ' && pe.state !== 'dead' && d2(pe.x, pe.y, x, y) < r * r) { pe.state = 'flee'; pe.flee = 6; pe.fx = x; pe.fy = y; }
  for (const c of G.cars) if (c.driver === 'ai' && d2(c.x, c.y, x, y) < r * r) c.panic = 6;
}
function killPed(ped, byPlayer) {
  if (ped.state === 'dead') return;
  ped.state = 'dead'; ped.dead = 25; blood(ped.x, ped.y, 6);
  if (byPlayer) {
    crime(ped.type === 'cop' ? 2 : 1, ped.type === 'cop' ? 'Polizist getoetet!' : 'Buerger getoetet!');
    if (ped.type === 'cop') G.pickups.push({ x: ped.x, y: ped.y, kind: 'ammo', val: 30, cd: 0 });
  }
  panicArea(ped.x, ped.y, 260);
}
function damagePed(ped, dmg, byPlayer) {
  if (ped.state === 'dead') return;
  ped.hp -= dmg; blood(ped.x, ped.y, 2);
  if (ped.hp <= 0) killPed(ped, byPlayer);
  else { ped.state = 'flee'; ped.flee = 7; ped.fx = P.x; ped.fy = P.y; panicArea(ped.x, ped.y, 200); }
}
function damagePlayer(dmg) {
  if (P.dead) return;
  if (P.ar > 0) { const a = Math.min(P.ar, dmg * 0.6); P.ar -= a; dmg -= a; }
  P.hp -= dmg; sHurt();
  if (P.hp <= 0) { P.hp = 0; wasted(); }
}
function damageCar(car, dmg, byPlayer) {
  car.hp -= dmg;
  if (byPlayer) car.hitByPlayer = true;
  if (car.hp <= 0 && car.fire === 0) car.fire = 0.0001;
}
function explode(x, y, fromPlayer) {
  sBoom(); G.shake = 12;
  if (G.decals.length > 140) G.decals.shift();
  G.decals.push({ x, y, r: 34, c: 'rgba(20,16,12,0.6)' });
  for (let i = 0; i < 36; i++) {
    const a = rnd(0, TAU), s = rnd(40, 260);
    part(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.3, 0.9), i < 18 ? '#ff9b2e' : '#55331a', rnd(3, 7), 60);
  }
  for (const pe of G.peds) if (pe.state !== 'dead' && d2(pe.x, pe.y, x, y) < 95 * 95) killPed(pe, fromPlayer);
  for (const c of G.cars) if (c.hp > 0 && d2(c.x, c.y, x, y) < 110 * 110 && d2(c.x, c.y, x, y) > 1) { c.hp -= 65; c.hitByPlayer = c.hitByPlayer || fromPlayer; }
  if (!P.car && d2(P.x, P.y, x, y) < 95 * 95) damagePlayer(70);
  if (fromPlayer) crime(2, 'Explosion!');
}
function wasted() {
  P.dead = 3; G.overlay = { t: 'wasted' };
  noiseHit(0.25, 0.4, 800);
  msg('Du bist gestorben. Krankenhaus-Rechnung: $250.', '#ff5a4e');
}
function busted() {
  P.dead = 3; G.overlay = { t: 'busted' };
  beep(220, 0.6, 'square', 0.25); setTimeout(() => beep(180, 0.6, 'square', 0.25), 350);
  msg('Festgenommen! Kaution: $300.', '#6c9bff');
}
function respawn() {
  P.dead = 0;
  const wasB = G.overlay.t === 'busted';
  const sp = wasB ? blockFront(SPECIAL.police[0], SPECIAL.police[1]) : blockFront(SPECIAL.hospital[0], SPECIAL.hospital[1]);
  P.x = sp.x; P.y = sp.y;
  P.hp = 100; P.ar = 0;
  P.money = Math.max(0, P.money - (wasB ? 300 : 250));
  P.wanted = 0; P.hidden = 0;
  for (const c of G.cars) if (c.driver === 'player') { c.driver = null; }
  P.car = null;
  G.overlay = { t: null };
}

/* ---------------- Pickups ---------------- */
function initPickups() {
  for (let i = 0; i < 14; i++) {
    const q = randWalkable(rnd(300, WORLD - 300), rnd(300, WORLD - 300), 0, 120, null);
    if (q) G.pickups.push({ x: q.x, y: q.y, kind: 'cash', val: ri(20, 90), cd: 0 });
  }
  const hf = blockFront(SPECIAL.hospital[0], SPECIAL.hospital[1]);
  G.pickups.push({ x: hf.x + 70, y: hf.y, kind: 'health', val: 50, cd: 0 });
}
function tickPickups(dt) {
  for (const k of G.pickups) {
    if (k.cd > 0) { k.cd -= dt; continue; }
    if (d2(k.x, k.y, P.x, P.y) < 22 * 22) {
      if (k.kind === 'cash') { P.money += k.val; sCash(); msg('+' + k.val + '$ aufgesammelt.', '#7dffb0'); }
      else if (k.kind === 'health') { P.hp = clamp(P.hp + k.val, 0, 100); sCash(); msg('Erste-Hilfe-Koffer: +' + k.val + ' HP.', '#7dffb0'); }
      else { P.ammo[2] += k.val; msg('+' + k.val + ' Pistolen-Munition.', '#ffd24a'); }
      k.cd = k.kind === 'cash' ? 45 : 60;
      const q = randWalkable(k.x, k.y, 300, 820, null);
      if (q) { k.x = q.x; k.y = q.y; }
    }
  }
}

/* ---------------- Shops / Marker ---------------- */
const markers = [];
function noMoney() { msg('Nicht genug Bargeld.', '#ff5a4e'); beep(160, 0.2, 'square', 0.15); }
function buyAmmu(kind) {
  const i = kind === 'bat' ? 1 : kind === 'pistol' ? 2 : 3;
  if (!P.own[i]) {
    const pr = kind === 'bat' ? 150 : kind === 'pistol' ? 600 : 1200;
    if (P.money < pr) return noMoney();
    P.money -= pr; P.own[i] = true; P.ammo[i] += (i === 2 ? 60 : 90); P.wi = i;
    sCash(); msg(WEAPONS[i].name + ' gekauft' + (kind === 'mp' ? ' – 90 Schuss' : '') + '.', '#d8b44a');
  } else {
    if (kind === 'bat') return P.wi = 1;
    const pr = i === 2 ? 240 : 420, cap = i === 2 ? 180 : 300;
    if (P.ammo[i] >= cap) return msg('Munition reicht noch (' + P.ammo[i] + ').', '#8fa3c8');
    if (P.money < pr) return noMoney();
    P.money -= pr; P.ammo[i] += i === 2 ? 60 : 90;
    sCash(); msg('+' + (i === 2 ? 60 : 90) + ' Schuss ' + WEAPONS[i].name + '.', '#d8b44a');
  }
}
function buildMarkers() {
  const f = blockFront(SPECIAL.ammu[0], SPECIAL.ammu[1]), sp = T * 3.2;
  markers.push({ x: f.x - sp * 1.5, y: f.y, r: 20, col: '#d8b44a', label: 'BAT $150', act: () => buyAmmu('bat') });
  markers.push({ x: f.x - sp * 0.5, y: f.y, r: 20, col: '#d8b44a', label: 'PISTOLE $600', act: () => buyAmmu('pistol') });
  markers.push({ x: f.x + sp * 0.5, y: f.y, r: 20, col: '#d8b44a', label: 'MP $1200', act: () => buyAmmu('mp') });
  markers.push({ x: f.x + sp * 1.5, y: f.y, r: 20, col: '#7d9bff', label: 'WESTE $450', act: () => {
    if (P.ar >= 99) return msg('Weste intakt.', '#8fa3c8');
    if (P.money >= 450) { P.money -= 450; P.ar = 100; sCash(); msg('Schutzweste gekauft.', '#7d9bff'); } else noMoney();
  } });
  const rf = blockFront(SPECIAL.rest[0], SPECIAL.rest[1]);
  markers.push({ x: rf.x, y: rf.y, r: 20, col: '#ff9b2e', label: "ESSEN $10", act: () => {
    if (P.hp >= 99) return msg('Du bist satt und gesund.', '#8fa3c8');
    if (P.money >= 10) { P.money -= 10; P.hp = 100; sCash(); msg("Cluckin' Bell: Mahlzeit verputzt – voll geheilt.", '#ff9b2e'); } else noMoney();
  } });
  const bf = blockFront(SPECIAL.bank[0], SPECIAL.bank[1]);
  markers.push({ x: bf.x, y: bf.y, r: 24, col: '#ffd24a', label: 'BANK \u2013 ROBBEN (E)', press: true, act: () => {
    if (BANK_CD.t > 0) return msg('Bank noch verriegelt (' + Math.ceil(BANK_CD.t) + 's).', '#8fa3c8');
    BANK_CD.t = 120; P.money += 2300; sCash(); sBoom();
    msg('BANKUEBERFALL! $2300 erbeutet – Alarm ausgeloest!', '#ff5a4e');
    crime(3, 'Bankraub!');
  } });
  const sf = { x: (SPECIAL.spray[0] * SEG + 4.5) * T, y: (SPECIAL.spray[1] * SEG + 7) * T };
  markers.push({ x: sf.x, y: sf.y, r: 22, col: '#ff9b2e', label: "PAY'N'SPRAY", act: () => msg('Mit dem Auto in die Garage fahren ($200).', '#ff9b2e') });
  const df = blockFront(SPECIAL.depot[0], SPECIAL.depot[1]);
  markers.push({ x: df.x, y: df.y, r: 24, col: '#4fc9e1', label: 'COURIER-JOB (E)', press: true, act: () => {
    JOB.courier = JOB.courier === 'go' ? 'off' : 'go';
    msg(JOB.courier === 'go' ? 'Courier-Dienst AN – Pakete zum Zielmarker bringen.' : 'Courier-Dienst aus.', '#4fc9e1');
    if (JOB.courier === 'go') newCourierTarget(); else JOB.courierTo = null;
  } });
}
function newTaxiPassenger() {
  for (let i = 0; i < 16; i++) {
    const q = randWalkable(P.x, P.y, 420, 1000, null);
    if (!q) continue;
    if (tileAt(q.x / T | 0, q.y / T | 0) !== 'w') continue;
    JOB.taxi = 'pickup'; JOB.taxiId = 'TX' + Math.random();
    const ped = mkPed(q.x, q.y, 'taxiped'); ped.state = 'wait'; ped.waitT = 55; ped.taxiJobId = JOB.taxiId;
    G.peds.push(ped);
    msg('Neuer Fahrgast wartet (gelber Marker auf Karte).', '#ffd24a');
    return;
  }
}
function newCourierTarget() {
  for (let i = 0; i < 16; i++) {
    const q = randWalkable(P.x, P.y, 380, 950, null);
    if (!q) continue;
    JOB.courierTo = q;
    return;
  }
}

/* ---------------- Jobs ---------------- */
function tickJobs(dt) {
  if (JOB.taxi !== 'off') {
    const inTaxi = P.car && P.car.type === 'taxi';
    if (!inTaxi) { if (!JOB.paused) { JOB.paused = true; msg('Taxi-Dienst pausiert – steig einfach ins Taxi!', '#8fa3c8'); } }
    else if (JOB.paused) { JOB.paused = false; msg('Taxi-Dienst fortgesetzt.', '#ffd24a'); }
    if (JOB.paused) return;
    if (JOB.taxi === 'cd') { JOB.cd -= dt; if (JOB.cd <= 0) newTaxiPassenger(); }
    else if (JOB.taxi === 'pickup') {
      const ped = G.peds.find(p => p.taxiJobId === JOB.taxiId && p.state !== 'dead' && p.state !== 'flee');
      if (!ped) { JOB.taxi = 'cd'; JOB.cd = 1.2; return; }
      if (d2(ped.x, ped.y, P.car.x, P.car.y) < 38 * 38 && Math.hypot(P.car.vx, P.car.vy) < 22) {
        for (let i = G.peds.length - 1; i >= 0; i--) if (G.peds[i] === ped) G.peds.splice(i, 1);
        JOB.fromX = P.car.x; JOB.fromY = P.car.y;
        JOB.taxi = 'drop';
        const q = randWalkable(P.x, P.y, 520, 1200, null);
        if (q) JOB.dest = q;
        msg('Fahrgast an Bord – fahre zum Ziel!', '#ffd24a');
      }
    } else if (JOB.taxi === 'drop' && JOB.dest) {
      if (d2(JOB.dest.x, JOB.dest.y, P.car.x, P.car.y) < 42 * 42 && Math.hypot(P.car.vx, P.car.vy) < 22) {
        const fare = 30 + Math.round(dist(JOB.dest.x, JOB.dest.y, JOB.fromX, JOB.fromY) / 5);
        P.money += fare; sCash();
        msg('Fahrgast abgeliefert: +$' + fare + ' Tarif.', '#7dffb0');
        JOB.dest = null; JOB.taxi = 'cd'; JOB.cd = 1.4;
      }
    }
  }
  if (JOB.courier === 'go' && JOB.courierTo && d2(JOB.courierTo.x, JOB.courierTo.y, P.x, P.y) < 34 * 34) {
    P.money += 150; sCash(); msg('Paket geliefert: +$150!', '#4fc9e1');
    newCourierTarget();
  }
}

/* ---------------- Eingaben ---------------- */
const keys = {};
const mouse = { x: 0, y: 0 };
let firing = false;
window.addEventListener('keydown', e => {
  if (e.code === 'Space') e.preventDefault();
  if (!G.playing) { startGame(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyF') tryEnterExit();
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyT') tryTaxiToggle();
  if (e.code === 'KeyH') msg('Hilfe: WASD laufen/fahren · F Auto · Maus zielen/schiessen · 1-4 Waffen · T Taxi · E interagieren · Leertaste Drift · M Ton', '#ffd24a');
  if (e.code === 'KeyM') { G.muted = !G.muted; if (SND.master) SND.master.gain.value = G.muted ? 0 : 0.5; msg('Ton ' + (G.muted ? 'aus' : 'an'), '#8fa3c8'); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4) { if (P.own[n - 1]) P.wi = n - 1; else msg(WEAPONS[n - 1].name + ' besitzt du nicht (Ammu-Nation).', '#8fa3c8'); }
});
window.addEventListener('keyup', e => keys[e.code] = false);
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; });
cvs.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cvs.addEventListener('mousedown', () => { if (!G.playing) { startGame(); return; } firing = true; });
window.addEventListener('mouseup', () => firing = false);
cvs.addEventListener('contextmenu', e => e.preventDefault());
function startGame() {
  if (G.playing) return;
  G.playing = true; G.overlay.t = null;
  document.getElementById('overlay').style.display = 'none';
  sfxInit(); if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume();
  msg('Willkommen in Liberty Blocks. Verdiene Geld, bleib clean… oder eben nicht.', '#ffd24a');
  msg('Tipp: T im Taxi = Taxi-Dienst. Gelbe Marker = Shops/Bank/Depot.', '#8fa3c8');
}
if (AUTO) setTimeout(startGame, 250);
const TEST = /[?&]test=/.test(location.href);
if (TEST) setTimeout(() => {
  startGame();
  // Test-Taxi auf der Ost-West-Lane suedlich vom Krankenhaus, nach Osten
  const c = mkCar(P.x - 200, P.y + 96, 0, 'taxi');
  c.driver = 'player'; P.car = c;
  keys.KeyW = true;                                  // fuer Headless-Screenshots: geradeausfahren
  msg('TEST-MODE: Taxi faehrt automatisch.', '#ffd24a');
}, 400);

function tryEnterExit() {
  if (P.coolE > 0 || P.dead) return;
  if (P.car) {
    const c = P.car;
    let ex = c.x - Math.cos(c.a) * 14 - Math.sin(c.a) * (c.h / 2 + 14);
    let ey = c.y - Math.sin(c.a) * 14 + Math.cos(c.a) * (c.h / 2 + 14);
    if (blocked(ex, ey)) { ex = c.x - Math.cos(c.a) * 32; ey = c.y - Math.sin(c.a) * 32; }
    P.x = ex; P.y = ey;
    c.driver = null; P.car = null; P.coolE = 0.35;
    if (c.type === 'taxi' && JOB.taxi !== 'off') JOB.paused = true;
  } else {
    let best = null, bd = 55 * 55;
    for (const c of G.cars) { if (c.fire > 0) continue; const q = d2(c.x, c.y, P.x, P.y); if (q < bd) { bd = q; best = c; } }
    if (!best) return;
    if (best.driver === 'ai' || best.driver === 'cop') {
      const p = mkPed(best.x - Math.sin(best.a) * 30, best.y + Math.cos(best.a) * 30, best.driver === 'cop' ? 'cop' : 'civ');
      p.state = 'flee'; p.flee = 9; p.fx = P.x; p.fy = P.y;
      if (best.type === 'taxi') p.state = 'walk';
      G.peds.push(p);
      if (best.driver === 'cop') { crime(2, 'Polizeifahrzeug geraubt!'); best.driver = null; }
      else {
        best.driver = null;
        if (copNear(best.x, best.y, 280)) crime(1, 'Autodiebstahl vor Zeugen!');
        else msg('Auto gekapert.', '#8fa3c8');
      }
    }
    best.driver = 'player'; best.panic = 0; P.car = best; P.coolE = 0.35;
    if (best.type === 'taxi' && JOB.taxi !== 'off') msg('Taxi-Dienst laeuft weiter.', '#ffd24a');
  }
}
function tryInteract() {
  for (const m of markers) if (d2(m.x, m.y, P.x, P.y) < (m.r + 14) * (m.r + 14)) { m.act(); return; }
}
function tryTaxiToggle() {
  if (P.car && P.car.type === 'taxi') {
    if (JOB.taxi === 'off') { msg('Taxi-Dienst AN. Fahrgaeste werden zuteilt, sobald du im Taxi sitzt.', '#ffd24a'); JOB.taxi = 'cd'; JOB.cd = 0.8; }
    else {
      JOB.taxi = 'off'; JOB.paused = false; JOB.dest = null;
      for (const p of G.peds) if (p.taxiJobId) { p.taxiJobId = undefined; p.state = 'flee'; p.flee = 4; p.fx = P.x; p.fy = P.y; }
      msg('Taxi-Dienst AUS.', '#8fa3c8');
    }
  } else msg('Dafuer musst du in einem Taxi sitzen (F beim gelben Auto).', '#8fa3c8');
}

/* ---------------- Spieler ---------------- */
function updatePlayer(dt) {
  P.coolS -= dt; P.coolE -= dt;
  if (P.dead > 0) { P.dead -= dt; if (P.dead <= 0) respawn(); return; }
  const up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown;
  const lf = keys.KeyA || keys.ArrowLeft, rt = keys.KeyD || keys.ArrowRight;
  P.aim = Math.atan2(mouse.y - VH / 2 - (P.y - G.cam.y), mouse.x - VW / 2 - (P.x - G.cam.x));
  if (P.car) {
    const c = P.car;
    const fwd = { x: Math.cos(c.a), y: Math.sin(c.a) }, rgt = { x: -fwd.y, y: fwd.x };
    const hb = keys.Space;
    const throttle = up ? 1 : dn ? -0.75 : 0;
    let f = c.vx * fwd.x + c.vy * fwd.y, l = c.vx * rgt.x + c.vy * rgt.y;
    f = clamp(f + throttle * (throttle * f < 0 ? 520 : 330) * dt, -170, c.max);
    f *= Math.exp(-dt * 0.55);
    l *= Math.exp(-dt * (hb ? 1.1 : 6.5));
    const steer = (rt ? 1 : 0) - (lf ? 1 : 0);
    c.a += steer * clamp(f / 110, -1.2, 1.2) * 2.7 * dt;
    c.vx = fwd.x * f + rgt.x * l; c.vy = fwd.y * f + rgt.y * l;
    carMove(c, dt, true);
    P.x = c.x; P.y = c.y;
  } else {
    let vx = (rt ? 1 : 0) - (lf ? 1 : 0), vy = (dn ? 1 : 0) - (up ? 1 : 0);
    if (vx || vy) {
      const m = Math.hypot(vx, vy); vx /= m; vy /= m;
      const sp = keys.ShiftLeft || keys.ShiftRight ? 155 : 108;
      P.x += vx * sp * dt; P.y += vy * sp * dt; P.a = Math.atan2(vy, vx);
      P.walkPh += dt * 9;
      playerCollide();
    }
    if (firing && P.coolS <= 0) shoot();
  }
  function shoot() {
    const w = WEAPONS[P.wi];
    if (w.melee) {
      P.coolS = w.rate; sPunch();
      for (const pe of G.peds) {
        if (pe.state === 'dead') continue;
        if (d2(pe.x, pe.y, P.x, P.y) < w.range * w.range && Math.abs(angDiff(Math.atan2(pe.y - P.y, pe.x - P.x), P.aim)) < 1.2) {
          damagePed(pe, w.dmg, true);
          part(pe.x, pe.y, rnd(-40, 40), rnd(-40, 40), 0.25, '#fff', 2);
        }
      }
      for (const c of G.cars) if (d2(c.x, c.y, P.x, P.y) < 42 * 42) { damageCar(c, 6, true); noiseHit(0.05, 0.2, 400); }
      P.hidden = 0;
      return;
    }
    if (P.ammo[P.wi] <= 0) { beep(210, 0.08, 'square', 0.12); P.coolS = 0.3; return; }
    P.ammo[P.wi]--; P.coolS = w.rate;
    const a = P.aim + rnd(-w.spread, w.spread);
    bullet(P.x + Math.cos(a) * 16, P.y + Math.sin(a) * 16, a, w.spd, true);
    sShot();
    for (let i = 0; i < 3; i++) part(P.x + Math.cos(a) * 18, P.y + Math.sin(a) * 18, Math.cos(a) * rnd(30, 120) + rnd(-40, 40), Math.sin(a) * rnd(30, 120) + rnd(-40, 40), rnd(0.06, 0.12), '#ffcf6b', 2);
    panicArea(P.x, P.y, 260);
    P.hidden = 0;
  }
}
function playerCollide() {
  const R = 9;
  const tx0 = (P.x - R) / T | 0, tx1 = (P.x + R) / T | 0, ty0 = (P.y - R) / T | 0, ty1 = (P.y + R) / T | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const c = tileAt(tx, ty);
    if (c !== 'b' && c !== 'x') continue;
    const bx = tx * T, by = ty * T;
    const nx = clamp(P.x, bx, bx + T), ny = clamp(P.y, by, by + T);
    const dx = P.x - nx, dy = P.y - ny, q = dx * dx + dy * dy;
    if (q < R * R && q > 0.0001) {
      const l = Math.sqrt(q);
      P.x += dx / l * (R - l); P.y += dy / l * (R - l);
    } else if (q <= 0.0001) { P.y -= R; }
  }
  P.x = clamp(P.x, 8, WORLD - 8); P.y = clamp(P.y, 8, WORLD - 8);
}

/* ---------------- Auto-Physik & KI ---------------- */
function carMove(c, dt, isPlayer) {
  const ox = c.x, oy = c.y;
  c.x += c.vx * dt; c.y += c.vy * dt;
  const fx = c.x + Math.cos(c.a) * (c.w / 2 - 4), fy = c.y + Math.sin(c.a) * (c.w / 2 - 4);
  const rx = c.x - Math.cos(c.a) * (c.w / 2 - 4), ry = c.y - Math.sin(c.a) * (c.w / 2 - 4);
  let crash = false;
  for (const [px, py] of [[fx, fy], [rx, ry]]) if (blocked(px, py)) { crash = true; c.x = ox; c.y = oy; break; }
  if (crash) {
    const spd = Math.hypot(c.vx, c.vy);
    if (spd > 130) { damageCar(c, spd * 0.08, isPlayer); noiseHit(0.08, 0.3, 700); if (isPlayer) G.shake = 6; }
    c.vx *= -0.35; c.vy *= -0.35;
  }
  c.x = clamp(c.x, 20, WORLD - 20); c.y = clamp(c.y, 20, WORLD - 20);
}
function aiCar(c, dt) {
  if (c.driver !== 'ai' && c.driver !== 'cop') return;
  let steerA = c.a, want = 0;
  if (c.driver === 'cop') {
    steerA = Math.atan2(P.y - c.y, P.x - c.x);
    const dd = dist(c.x, c.y, P.x, P.y);
    want = c.max * 0.9;
    if (dd < 120) want = 90;
    if (c.stuck > 1.7) { c.rev = 0.9; c.stuck = 0; }
    if (c.rev > 0) { c.rev -= dt; steerA = c.a; want = -140; }
  } else {
    steerA = Math.atan2(c.wp.y - c.y, c.wp.x - c.x);
    want = c.max * 0.55 * (c.panic > 0 ? 1.6 : 1);
    if (d2(c.x, c.y, c.wp.x, c.wp.y) < 40 * 40) nextWaypoint(c);
  }
  const px = c.x + Math.cos(c.a) * 60, py = c.y + Math.sin(c.a) * 60;
  let obstacle = blocked(px, py) || blocked(px + Math.cos(c.a) * 30, py + Math.sin(c.a) * 30);
  if (!obstacle && c.panic <= 0) for (const pe of G.peds) if (pe.state !== 'dead' && d2(pe.x, pe.y, px, py) < 26 * 26) { obstacle = true; break; }
  if (!obstacle && c.driver === 'cop') { /* Cops bocken nicht auf den Spieler */ }
  else if (!obstacle) for (const o of G.cars) { if (o !== c && d2(o.x, o.y, px, py) < 30 * 30) { obstacle = true; break; } }
  const ad = angDiff(c.a, steerA);
  const spd = Math.hypot(c.vx, c.vy);
  c.stuck = (Math.abs(ad) > 2.3 || (obstacle && spd < 25)) ? c.stuck + dt : Math.max(0, c.stuck - dt * 0.5);
  c.a += clamp(ad, -2.7 * dt, 2.7 * dt) * clamp(spd / 90, 0.3, 1.6);
  const target = obstacle ? 0 : want;
  const nf = spd + clamp(target - spd, -430 * dt, 200 * dt);
  c.vx = Math.cos(c.a) * nf; c.vy = Math.sin(c.a) * nf;
  carMove(c, dt, false);
}
function nextWaypoint(c) {
  const n = c.ai;
  const opts = [];
  const back = (c.ai.dir + 2) % 4;
  for (let d = 0; d < 4; d++) if (d !== back && okNode(nodeStep(n.vi, n.hi, d))) opts.push(d);
  if (!opts.length) opts.push(back);
  c.ai.dir = (opts.includes(n.dir) && Math.random() < 0.62) ? n.dir : pick(opts);
  const ns = nodeStep(n.vi, n.hi, c.ai.dir);
  const pos = nodePos(ns.vi, ns.hi);
  c.ai.vi = ns.vi; c.ai.hi = ns.hi;
  c.wp = { x: pos.x + LANE[c.ai.dir][0], y: pos.y + LANE[c.ai.dir][1] };
}

/* ---------------- Passanten ---------------- */
function updatePeds(dt) {
  for (const p of G.peds) {
    if (p.state === 'dead') continue;
    p.chat -= dt;
    if (p.type === 'cop') {
      if (P.wanted > 0 && !P.dead) {
        const dp = dist(p.x, p.y, P.x, P.y);
        let a = Math.atan2(P.y - p.y, P.x - p.x);
        if (P.wanted >= 3 && dp < 240 && dp > 34) {
          p.shootCd -= dt;
          if (p.shootCd <= 0) {
            p.shootCd = rnd(0.55, 1.1);
            const aa = a + rnd(-0.14, 0.14);
            bullet(p.x + Math.cos(aa) * 14, p.y + Math.sin(aa) * 14, aa, 800, false);
            sShot();
          }
          p.a = a;
        } else {
          // seitwausweichen wenn Wand
          if (blocked(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14)) {
            if (blocked(p.x + Math.cos(a + 0.95) * 14, p.y + Math.sin(a + 0.95) * 14)) a += dt * 4 * (p.steer === 1 ? -1 : 1);
            else p.steer = 1;
            a += 0.95;
          } else p.steer = 0;
          p.x += Math.cos(a) * p.spd * dt; p.y += Math.sin(a) * p.spd * dt;
          p.a = a;
          if (dp < 17 && (!P.car || Math.hypot(P.car.vx, P.car.vy) < 60)) { busted(); P.wanted = 0; }
        }
      }
      continue;
    }
    if (p.type === 'taxiped') {
      if (p.state === 'wait') {
        p.waitT -= dt;
        if (p.waitT <= 0) {
          if (p.taxiJobId === JOB.taxiId) { msg('Fahrgast ist weggetrottet…', '#8fa3c8'); JOB.taxi = 'cd'; JOB.cd = 1.5; JOB.taxiId = null; }
          p.state = 'flee'; p.flee = 4; p.fx = P.x; p.fy = P.y;
        }
        continue;
      }
    }
    if (p.flee > 0) {
      p.flee -= dt;
      let a = Math.atan2(p.y - p.fy, p.x - p.fx);
      if (blocked(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14)) a += 0.9;
      p.x += Math.cos(a) * 88 * dt; p.y += Math.sin(a) * 88 * dt; p.a = a;
      if (Math.random() < 0.02) p.fx = P.x, p.fy = P.y;
    } else {
      if (p.state !== 'walk') { p.state = 'walk'; p.st = randWalkable(p.x, p.y, 60, 180, { x: p.x, y: p.y }); }
      const a = Math.atan2(p.st.y - p.y, p.st.x - p.x);
      if (!blocked(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12)) {
        p.x += Math.cos(a) * p.spd * dt; p.y += Math.sin(a) * p.spd * dt; p.a = a;
      } else p.st = randWalkable(p.x, p.y, 80, 240, p.st);
      if (d2(p.x, p.y, p.st.x, p.st.y) < 15 * 15 || Math.random() < 0.004) p.st = randWalkable(p.x, p.y, 80, 240, p.st);
    }
    if (p.chat <= 0 && d2(p.x, p.y, P.x, P.y) < 160 * 160) { p.chat = rnd(16, 42); if (Math.random() < 0.6) pedSays(pick(PED_LINES)); }
  }
  // Ueberfahren
  for (const c of G.cars) {
    const spd = Math.hypot(c.vx, c.vy);
    if (spd < 55) continue;
    for (const pe of G.peds) {
      if (pe.state === 'dead') continue;
      if (d2(pe.x, pe.y, c.x, c.y) < 21 * 21) {
        killPed(pe, c.driver === 'player');
        if (c.driver === 'player') { G.shake = 4; damageCar(c, 2, true); }
        c.vx *= 0.8; c.vy *= 0.8;
      }
    }
  }
}

/* ---------------- Kugeln ---------------- */
function updateBullets(dt) {
  for (const b of G.bullets) {
    const ox = b.x, oy = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (blocked(b.x, b.y)) { b.life = 0; for (let i = 0; i < 3; i++) part(ox, oy, rnd(-80, 80), rnd(-80, 80), 0.2, '#ffd77b', 2); continue; }
    let hit = false;
    for (const pe of G.peds) {
      if (pe.state === 'dead' || hit) continue;
      if (pe.type === 'cop' && !b.pl) continue;
      if (d2(pe.x, pe.y, b.x, b.y) < 11 * 11) { damagePed(pe, b.pl ? 30 : 14, b.pl); hit = true; b.life = 0; }
    }
    if (!hit && !b.pl && !P.dead && d2(P.x, P.y, b.x, b.y) < 11 * 11) { damagePlayer(rnd(10, 16)); hit = true; b.life = 0; }
    if (!hit) for (const c of G.cars) {
      if (hit) break;
      if (c === P.car && b.pl) continue;
      if (d2(c.x, c.y, b.x, b.y) < (c.w * c.h) * 0.18) {
        if (c.driver === 'ai') c.panic = 7;
        damageCar(c, b.pl ? 14 : 8, b.pl);
        hit = true; b.life = 0;
        for (let i = 0; i < 4; i++) part(b.x, b.y, rnd(-120, 120), rnd(-120, 120), 0.25, '#ffe08a', 2);
      }
    }
  }
  G.bullets = G.bullets.filter(b => b.life > 0);
}
function updateParts(dt) {
  for (const p of G.parts) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.exp(-dt * 3); p.vy *= Math.exp(-dt * 3);
    p.vy += p.grav * dt;
  }
  G.parts = G.parts.filter(p => p.life > 0);
  for (let i = G.cars.length - 1; i >= 0; i--) {
    const c = G.cars[i];
    if (c.fire > 0) {
      c.fire += dt;
      if (Math.random() < 0.7) part(c.x + rnd(-8, 8), c.y + rnd(-8, 8), rnd(-20, 20), rnd(-35, -5), rnd(0.4, 0.9), Math.random() < 0.5 ? '#ff8429' : '#333', rnd(3, 6), -25);
      if (c.fire > 1.7) {
        explode(c.x, c.y, c.hitByPlayer);
        if (c === P.car) { P.car = null; damagePlayer(110); }
        G.cars.splice(i, 1);
      }
    }
    c.panic = Math.max(0, c.panic - dt);
  }
}

/* ---------------- Haupt-Update ---------------- */
let spawnT = 0, copT = 0;
function update(dt) {
  dt = Math.min(dt, 0.05);
  G.time += dt / DAY_LEN; if (G.time >= 1) { G.time -= 1; G.day++; }
  if (BANK_CD.t > 0) BANK_CD.t -= dt;
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 24);

  updatePlayer(dt);
  for (const c of G.cars) if (c !== P.car) aiCar(c, dt);
  updatePeds(dt);
  updateBullets(dt);
  updateParts(dt);
  tickPickups(dt);
  tickJobs(dt);
  sprayZone();

  // Fahndung & Cops
  if (P.wanted > 0 && !P.dead) {
    P.hidden = copNear(P.x, P.y, 470) ? 0 : P.hidden + dt;
    if (P.hidden > 11) {
      P.wanted = Math.max(0, P.wanted - dt / 10);
      if (P.wanted === 0) msg('Fahndung aufgehoben – ruhig weiteratmen.', '#7dffb0');
    }
    copT -= dt;
    if (copT <= 0) { copT = 0.8; spawnPolice(); }
  }
  spawnT -= dt;
  if (spawnT <= 0) { spawnT = 0.55; spawnTraffic(); spawnPeds(); despawnEntities(); }

  // Kamera
  let cx = P.x, cy = P.y;
  if (P.car) { cx += P.car.vx * 0.3; cy += P.car.vy * 0.3; }
  const kf = Math.min(1, dt * 5);
  G.cam.x += (clamp(cx, VW / 2, WORLD - VW / 2) - G.cam.x) * kf;
  G.cam.y += (clamp(cy, VH / 2, WORLD - VH / 2) - G.cam.y) * kf;

  // Auto vs Auto
  for (let i = 0; i < G.cars.length; i++) for (let j = i + 1; j < G.cars.length; j++) {
    const a = G.cars[i], b = G.cars[j];
    const rr2 = (a.w + b.w) * 0.42, q = d2(a.x, a.y, b.x, b.y);
    if (q < rr2 * rr2 && q > 1) {
      const l = Math.sqrt(q), nx = (a.x - b.x) / l, ny = (a.y - b.y) / l, push = (rr2 - l) * 0.5;
      a.x += nx * push; a.y += ny * push; b.x -= nx * push; b.y -= ny * push;
      const rel = Math.abs(Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy));
      const pl = a === P.car || b === P.car;
      const byPl = pl && Math.hypot(a === P.car ? a.vx : b.vx, a === P.car ? a.vy : b.vy) > 140;
      if (rel > 140) {
        damageCar(a, rel * 0.06, byPl && b === P.car);
        damageCar(b, rel * 0.06, byPl && a === P.car);
        noiseHit(0.07, 0.25, 600);
        if (pl) G.shake = Math.max(G.shake, Math.min(9, rel / 20));
      }
      if (byPl) { if (a !== P.car) a.hitByPlayer = true; if (b !== P.car) b.hitByPlayer = true; }
      a.vx *= 0.95; a.vy *= 0.95; b.vx *= 0.95; b.vy *= 0.95;
    }
  }
  // Auto vs Fussgaenger (Spieler)
  for (const c of G.cars) {
    if (c === P.car || Math.hypot(c.vx, c.vy) < 65) continue;
    if (!P.car && !P.dead && d2(c.x, c.y, P.x, P.y) < 20 * 20) {
      damagePlayer(15);
      P.x -= Math.cos(c.a) * 28; P.y -= Math.sin(c.a) * 28;
    }
  }
  audioTick();
  for (const m of G.msg) m.life -= dt;
  G.msg = G.msg.filter(m => m.life > 0);
}
function audioTick() {
  if (!SND.ctx || G.muted) return;
  try {
    if (P.car && !P.dead) {
      const s = Math.hypot(P.car.vx, P.car.vy);
      SND.eng.frequency.value = 55 + s * 0.5;
      SND.engG.gain.value = 0.02 + s / 3400;
    } else SND.engG.gain.value = 0;
    let sir = false;
    for (const c of G.cars) if (c.type === 'police' && c.siren && d2(c.x, c.y, P.x, P.y) < 750 * 750) { sir = true; break; }
    SND.sirT += 1 / 60;
    if (SND.sirT > 0.42) { SND.sirT = 0; SND.sirF = 1 - SND.sirF; }
    SND.sir.frequency.value = sir ? (SND.sirF ? 730 : 560) : 300;
    SND.sirG.gain.value = sir ? 0.014 : 0;
  } catch (e) {}
}

/* ================= RENDER ================= */
let mapC, miniC;
const MINI = 190;
function drawBuilding(m, x, y, sz, col, label) {
  const r = mul32((x * 31 + y * 17) | 0);
  m.fillStyle = 'rgba(0,0,0,0.28)'; m.fillRect(x + 7, y + 9, sz - 14, sz - 14);
  m.fillStyle = col; m.fillRect(x + 5, y + 5, sz - 10, sz - 10);
  m.strokeStyle = 'rgba(0,0,0,0.4)'; m.lineWidth = 3; m.strokeRect(x + 5, y + 5, sz - 10, sz - 10);
  m.fillStyle = 'rgba(255,255,255,0.09)';
  for (let i = 0; i < 4; i++) m.fillRect(x + 24 + r() * (sz - 76), y + 24 + r() * (sz - 76), 34, 24);
  m.fillStyle = '#20242c';
  const n = 8, w = (sz - 40) / n;
  for (let i = 0; i < n; i++) {
    m.fillRect(x + 16 + i * w, y + 12, w * 0.55, 7);
    m.fillRect(x + 16 + i * w, y + sz - 19, w * 0.55, 7);
    m.fillRect(x + 12, y + 16 + i * w, 7, w * 0.55);
    m.fillRect(x + sz - 19, y + 16 + i * w, 7, w * 0.55);
  }
  if (label) {
    m.fillStyle = 'rgba(0,0,0,0.45)'; m.fillRect(x + sz * 0.1, y + sz * 0.34, sz * 0.8, sz * 0.18);
    m.fillStyle = '#eee'; m.font = 'bold ' + Math.floor(sz * 0.085) + 'px system-ui';
    m.textAlign = 'center'; m.textBaseline = 'middle';
    m.fillText(label, x + sz / 2, y + sz * 0.43);
  }
}
function prerenderMap() {
  mapC = document.createElement('canvas'); mapC.width = WORLD; mapC.height = WORLD;
  const m = mapC.getContext('2d');
  for (let ty = 0; ty < MAPT; ty++) for (let tx = 0; tx < MAPT; tx++) {
    const c = tileAt(tx, ty);
    m.fillStyle = c === 'r' ? '#3a3d44' : c === 'w' ? '#8f9088' : c === 'g' ? 'transparent' : c === 'p' ? '#4a4b50' : '#2b2d33';
    if (c === 'g') continue;
    m.fillRect(tx * T, ty * T, T, T);
  }
  m.strokeStyle = 'rgba(0,0,0,0.13)'; m.lineWidth = 1;
  for (let ty = 0; ty < MAPT; ty++) for (let tx = 0; tx < MAPT; tx++) if (tileAt(tx, ty) === 'w') m.strokeRect(tx * T + 0.5, ty * T + 0.5, T, T);
  // Mittellinien
  m.strokeStyle = '#d3c23c'; m.lineWidth = 3; m.setLineDash([20, 18]);
  for (let k = 0; k < ROADS; k++) {
    const c = k * SEG * T + T;
    for (let b = 0; b < NB; b++) {
      const s = (b * SEG + 2) * T, e = (b * SEG + 12) * T;
      m.beginPath(); m.moveTo(c, s); m.lineTo(c, e); m.stroke();
      m.beginPath(); m.moveTo(s, c); m.lineTo(e, c); m.stroke();
    }
  }
  m.setLineDash([]);
  // Zebrastreifen
  m.fillStyle = 'rgba(235,235,235,0.6)';
  for (let i = 0; i < ROADS; i++) for (let j = 0; j < ROADS; j++) {
    const cx = i * SEG * T + T, cy = j * SEG * T + T, R2 = T;
    for (let s = 0; s < 5; s++) {
      const off = -R2 + 8 + s * 15;
      m.fillRect(cx + off, cy - R2 - 9, 8, 7);
      m.fillRect(cx + off, cy + R2 + 2, 8, 7);
      m.fillRect(cx - R2 - 9, cy + off, 7, 8);
      m.fillRect(cx + R2 + 2, cy + off, 7, 8);
    }
  }
  // Blocks
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    const B = blocks[by][bx];
    const x0 = (bx * SEG + 3) * T, y0 = (by * SEG + 3) * T, sz = 8 * T;
    if (B.kind === 'bld') {
      drawBuilding(m, x0, y0, sz, BLD_COL[ri(0, BLD_COL.length - 1)], null);
    } else if (B.kind === 'park') {
      m.fillStyle = '#40672f'; m.fillRect(x0 + 6, y0 + 6, sz - 12, sz - 12);
      const r = mul32(901 + bx * 7 + by * 131);
      for (let i = 0; i < 12; i++) {
        const tx = x0 + 26 + r() * (sz - 52), ty = y0 + 26 + r() * (sz - 52), tr = 9 + r() * 9;
        m.fillStyle = 'rgba(0,0,0,0.3)'; m.beginPath(); m.arc(tx + 4, ty + 5, tr, 0, TAU); m.fill();
        m.fillStyle = '#2e5c22'; m.beginPath(); m.arc(tx, ty, tr, 0, TAU); m.fill();
        m.fillStyle = '#3f7a2e'; m.beginPath(); m.arc(tx - tr * 0.25, ty - tr * 0.25, tr * 0.62, 0, TAU); m.fill();
      }
      m.fillStyle = 'rgba(240,240,235,0.45)'; m.fillRect(x0 + sz / 2 - 5, y0 + 12, 10, sz - 24);
    } else if (B.kind === 'lot') {
      m.fillStyle = 'rgba(255,255,255,0.15)';
      for (let i = 0; i < 8; i++) m.fillRect(x0 + 8, y0 + 12 + i * 38, 2, 30);
      drawBuilding(m, x0 + sz * 0.55, y0 + sz * 0.55, sz * 0.44, '#5c5668', null);
    } else if (B.kind === 'spray') {
      drawBuilding(m, x0 + sz * 0.46, y0, sz * 0.54, '#c96a1e', "PAY'N'SPRAY");
      m.fillStyle = 'rgba(0,0,0,0.4)'; m.fillRect(x0 + 14, y0 + sz * 0.1, sz * 0.28, sz * 0.26);
      m.fillStyle = 'rgba(255,255,255,0.65)'; m.fillRect(x0 + 20, y0 + sz * 0.14, sz * 0.25, 5);
    } else {
      const st = {
        police: ['#26355c', 'POLICE'], hospital: ['#c8ccd2', 'HOSPITAL'],
        ammu: ['#6e2626', 'AMMU-NATION'], rest: ['#b98a1e', "CLUCKIN'BELL"],
        bank: ['#1e5c40', 'BANK'], depot: ['#1e5468', 'COURIER DEPOT'],
      }[B.kind];
      drawBuilding(m, x0, y0, sz, st[0], st[1]);
      if (B.kind === 'hospital') {
        m.fillStyle = '#d33';
        m.fillRect(x0 + sz * 0.44, y0 + sz * 0.62, sz * 0.12, sz * 0.3);
        m.fillRect(x0 + sz * 0.36, y0 + sz * 0.68, sz * 0.28, sz * 0.12);
      }
    }
  }
  // Laternen
  for (let i = 0; i < ROADS; i++) for (let j = 0; j < ROADS; j++) {
    const cx = i * SEG * T + T, cy = j * SEG * T + T, R2 = T + 9;
    for (const [ox, oy] of [[-R2, -R2], [R2, -R2], [-R2, R2], [R2, R2]]) {
      const lx = cx + ox, ly = cy + oy;
      if (lx < 0 || ly < 0 || lx >= WORLD || ly >= WORLD) continue;
      G.lamps.push({ x: lx, y: ly });
      m.fillStyle = 'rgba(30,30,34,0.9)'; m.beginPath(); m.arc(lx, ly, 3, 0, TAU); m.fill();
    }
  }
  miniC = document.createElement('canvas'); miniC.width = MINI; miniC.height = MINI;
  miniC.getContext('2d').drawImage(mapC, 0, 0, MINI, MINI);
}

/* ---------------- Zeichen ---------------- */
const darkness = () => { const t = G.time; if (t < 0.25) return 1; if (t < 0.3) return 1 - (t - 0.25) / 0.05; if (t < 0.78) return 0; if (t < 0.84) return (t - 0.78) / 0.06; return 1; };
function clockStr() { const h24 = G.time * 24, h = h24 | 0, mi = ((h24 - h) * 60) | 0; return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }
const sxp = wx => wx - G.cam.x + VW / 2, syp = wy => wy - G.cam.y + VH / 2;
const inView = (x, y, r) => Math.abs(x - G.cam.x) < VW / 2 + r && Math.abs(y - G.cam.y) < VH / 2 + r;
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawCar(c) {
  if (!inView(c.x, c.y, 70)) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  rr(-c.w / 2 + 2, -c.h / 2 + 3, c.w, c.h, 5); ctx.fill();
  ctx.fillStyle = c.color; rr(-c.w / 2, -c.h / 2, c.w, c.h, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; rr(-c.w / 2, -c.h / 2, c.w, c.h, 5); ctx.stroke();
  ctx.fillStyle = 'rgba(20,26,38,0.85)';
  rr(-c.w * 0.13, -c.h * 0.32, c.w * 0.42, c.h * 0.64, 3); ctx.fill();
  ctx.fillStyle = 'rgba(120,170,220,0.3)';
  rr(c.w * 0.13, -c.h * 0.27, c.w * 0.09, c.h * 0.54, 2); ctx.fill();
  rr(-c.w * 0.27, -c.h * 0.27, c.w * 0.08, c.h * 0.54, 2); ctx.fill();
  if (darkness() > 0.12 || c.siren) {
    ctx.fillStyle = '#fff7c8'; ctx.fillRect(c.w / 2 - 3, -c.h / 2 + 2, 3, 4); ctx.fillRect(c.w / 2 - 3, c.h / 2 - 6, 3, 4);
  }
  if (c.type === 'police' && c.siren) {
    ctx.fillStyle = ((performance.now() / 180) | 0) % 2 ? '#2f7cff' : '#ff2f2f';
    ctx.fillRect(-5, -c.h / 2 + 1, 10, 5);
    ctx.fillStyle = 'rgba(190,205,220,0.9)'; ctx.fillRect(c.w * 0.1, -c.h / 2, 6, c.h);
  }
  if (c.type === 'taxi') { ctx.fillStyle = '#111'; ctx.fillRect(-4, -5, 8, 10); ctx.fillStyle = '#ffd24a'; ctx.fillRect(-3, -3, 6, 6); }
  if (c.hp < 55) { ctx.fillStyle = 'rgba(25,25,25,0.55)'; ctx.fillRect(c.w * 0.22, -c.h / 2, 6, c.h); }
  ctx.restore();
}
function drawPed(p, isPlayer) {
  if (!inView(p.x, p.y, 30)) return;
  const x = p.x, y = p.y;
  if (p.state === 'dead') {
    ctx.fillStyle = 'rgba(120,10,25,0.45)'; ctx.beginPath(); ctx.ellipse(x, y, 13, 9, p.a, 0, TAU); ctx.fill();
    ctx.fillStyle = isPlayer ? '#2f5a8a' : p.shirt;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9a68a'; ctx.beginPath(); ctx.arc(x + Math.cos(p.a) * 6, y + Math.sin(p.a) * 6, 3.4, 0, TAU); ctx.fill();
    return;
  }
  const aim = isPlayer ? P.aim : p.a;
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 8, 6, 0, 0, TAU); ctx.fill();
  if (isPlayer && !P.car) {
    const st = Math.sin(P.walkPh) * 3;
    ctx.fillStyle = '#222';
    ctx.fillRect(x - 4, y - 3 + st, 3, 3); ctx.fillRect(x + 1, y - 3 - st, 3, 3);
  }
  if (isPlayer) { ctx.fillStyle = 'rgba(255,240,150,0.12)'; ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill(); }
  ctx.fillStyle = isPlayer ? '#2f5a8a' : p.shirt;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  if (isPlayer && !WEAPONS[P.wi].melee) {
    ctx.strokeStyle = '#181818'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(aim) * 13, y + Math.sin(aim) * 13); ctx.stroke();
  }
  if (isPlayer && WEAPONS[P.wi].melee && P.wi === 1) {
    ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(aim) * 6, y + Math.sin(aim) * 6); ctx.lineTo(x + Math.cos(aim) * 20, y + Math.sin(aim) * 20); ctx.stroke();
  }
  ctx.fillStyle = p.type === 'cop' ? '#16233f' : '#c9a68a';
  if (p.type === 'cop') { ctx.fillStyle = '#dfe6f2'; ctx.fillRect(x - Math.sin(aim) * 8 - 2.5, y + Math.cos(aim) * 8 - 2.5, 5, 5); ctx.fillStyle = '#16233f'; }
  ctx.beginPath(); ctx.arc(x + Math.cos(aim) * 2.5, y + Math.sin(aim) * 2.5, 3.6, 0, TAU); ctx.fill();
}
function objective() {
  if (JOB.taxi === 'pickup') { const ped = G.peds.find(p => p.taxiJobId === JOB.taxiId && p.state === 'wait'); if (ped) return { o: ped, col: '#ffd24a' }; }
  if (JOB.taxi === 'drop' && JOB.dest) return { o: JOB.dest, col: '#ffd24a' };
  if (JOB.courier === 'go' && JOB.courierTo) return { o: (JOB.taxi !== 'off' && JOB.dest) ? null : JOB.courierTo, col: '#4fc9e1' };
  return null;
}
function draw() {
  const dark = darkness();
  ctx.fillStyle = '#0a0c12'; ctx.fillRect(0, 0, VW, VH);
  const shx = G.shake ? rnd(-G.shake, G.shake) : 0, shy = G.shake ? rnd(-G.shake, G.shake) : 0;
  ctx.save(); ctx.translate(shx, shy);
  const vx = clamp(G.cam.x - VW / 2, 0, Math.max(0, WORLD - VW)), vy = clamp(G.cam.y - VH / 2, 0, Math.max(0, WORLD - VH));
  const cw = Math.min(VW, WORLD - vx), ch = Math.min(VH, WORLD - vy);
  ctx.drawImage(mapC, vx, vy, cw, ch, vx - G.cam.x + VW / 2, vy - G.cam.y + VH / 2, cw, ch);
  ctx.save(); ctx.translate(VW / 2 - G.cam.x, VH / 2 - G.cam.y);
  for (const d of G.decals) if (inView(d.x, d.y, 40)) { ctx.fillStyle = d.c; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill(); }
  const tAnim = performance.now();
  for (const mk of markers) {
    if (!inView(mk.x, mk.y, 60)) continue;
    const pu = 1 + Math.sin(tAnim / 300 + mk.x) * 0.13;
    ctx.strokeStyle = mk.col; ctx.lineWidth = 3; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(mk.x, mk.y, mk.r * pu, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.2; ctx.fillStyle = mk.col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(mk.label, mk.x, mk.y - mk.r - 6);
  }
  const objv = objective();
  if (objv && objv.o) {
    const b = 1 + Math.sin(tAnim / 220) * 0.25, s = 13 * b;
    ctx.strokeStyle = objv.col; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
    ctx.strokeRect(objv.o.x - s, objv.o.y - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
  }
  for (const k of G.pickups) {
    if (k.cd > 0 || !inView(k.x, k.y, 30)) continue;
    const b = 1 + Math.sin(tAnim / 260 + k.x) * 0.25;
    ctx.fillStyle = k.kind === 'cash' ? '#7dffb0' : k.kind === 'health' ? '#ff6b6b' : '#ffd24a';
    ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-5 * b, -5 * b, 10 * b, 10 * b); ctx.restore();
  }
  for (const c of G.cars) drawCar(c);
  for (const p of G.peds) drawPed(p, false);
  if (!P.car) drawPed({ x: P.x, y: P.y, a: P.a, shirt: '#2f5a8a', state: P.dead ? 'dead' : 'walk', type: 'pl' }, true);
  ctx.strokeStyle = '#ffe9a3'; ctx.lineWidth = 2;
  for (const b of G.bullets) {
    if (!inView(b.x, b.y, 20)) continue;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.013, b.y - b.vy * 0.013); ctx.stroke();
  }
  for (const p of G.parts) {
    if (!inView(p.x, p.y, 20)) continue;
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (dark > 0.1) {
    ctx.fillStyle = 'rgba(9,12,34,' + (dark * 0.5).toFixed(3) + ')';
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of G.lamps) {
      const x = sxp(l.x), y = syp(l.y);
      if (x < -100 || y < -100 || x > VW + 100 || y > VH + 100) continue;
      const g = ctx.createRadialGradient(x, y, 4, x, y, 95);
      g.addColorStop(0, 'rgba(255,220,130,' + (0.45 * dark).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,220,130,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 95, y - 95, 190, 190);
    }
    for (const c of G.cars) {
      if (!inView(c.x, c.y, 190) || c.driver === null && c.parked === true) continue;
      const hx = sxp(c.x + Math.cos(c.a) * c.w / 2), hy = syp(c.y + Math.sin(c.a) * c.w / 2);
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(c.a);
      const g = ctx.createLinearGradient(0, 0, 150, 0);
      g.addColorStop(0, 'rgba(255,240,190,' + (0.26 * dark).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(150, -46); ctx.lineTo(150, 46); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  drawHUD();
  drawMinimap();
}

/* ---------------- HUD ---------------- */
function star(c, lit) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.6 : 10, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath();
  c.fillStyle = lit ? '#ffd24a' : 'rgba(60,66,84,0.7)'; c.fill();
  c.strokeStyle = lit ? '#a86f00' : 'rgba(90,98,120,0.5)'; c.lineWidth = 1.5; c.stroke();
}
function drawHUD() {
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 30px "Segoe UI", system-ui';
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(clockStr(), VW - 21, 45);
  ctx.fillStyle = '#7fd0ff'; ctx.fillText(clockStr(), VW - 22, 44);
  ctx.font = 'bold 34px "Segoe UI", system-ui';
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText('$' + P.money, VW - 21, 83);
  ctx.fillStyle = '#7dffb0'; ctx.fillText('$' + P.money, VW - 22, 82);
  for (let i = 0; i < 6; i++) { ctx.save(); ctx.translate(VW - 30 - i * 24, 104); star(ctx, i < Math.floor(P.wanted)); ctx.restore(); }
  ctx.textAlign = 'left';
  const w = WEAPONS[P.wi];
  ctx.font = 'bold 17px system-ui'; ctx.fillStyle = '#dfe6f2';
  ctx.fillText(w.name + (w.melee ? '' : '   Mun: ' + P.ammo[P.wi]), 20, VH - 18);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(20, VH - 56, 150, 12);
  ctx.fillStyle = '#4fd06a'; ctx.fillRect(20, VH - 56, 150 * clamp(P.hp / 100, 0, 1), 12);
  if (P.ar > 0) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(20, VH - 72, 150, 10); ctx.fillStyle = '#6c9bff'; ctx.fillRect(20, VH - 72, 150 * clamp(P.ar / 100, 0, 1), 10); }
  if (P.car) {
    ctx.font = 'bold 15px system-ui'; ctx.fillStyle = '#ffd24a';
    ctx.fillText(Math.round(Math.hypot(P.car.vx, P.car.vy) * 0.4) + ' km/h' + '   Zustand ' + Math.max(0, Math.round(P.car.hp)) + '%', 20, VH - 84);
  }
  ctx.font = '14px system-ui';
  let ytl = VH - 106;
  if (JOB.taxi !== 'off') {
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('TAXI-DUTY: ' + (JOB.paused ? 'pausiert (ins Taxi!)' : JOB.taxi === 'pickup' ? 'Fahrgast einsammeln' : JOB.taxi === 'drop' ? 'Zum Ziel bringen' : 'Fahrgast kommt…'), 20, ytl); ytl -= 18;
  }
  if (JOB.courier === 'go') { ctx.fillStyle = '#4fc9e1'; ctx.fillText('COURIER: Paket zum Marker', 20, ytl); ytl -= 18; }
  if (P.wanted >= 1) {
    ctx.fillStyle = '#ff8a7a';
    ctx.fillText(P.hidden > 6 ? 'Versteckt… Sterne verblassen.' : 'POLIZEI-JAGD! Entkommen oder Pay\'n\'Spray ($200).', 20, ytl);
  }
  // Feed
  ctx.font = '13.5px "Segoe UI", system-ui'; ctx.textAlign = 'left';
  for (let i = G.msg.length - 1; i >= 0; i--) {
    const mk = G.msg[i], a = clamp(mk.life / 1.5, 0, 1);
    const row = G.msg.length - 1 - i;
    const ty = VH - 136 - row * 19;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5,8,14,0.62)';
    const tw = ctx.measureText(mk.t).width;
    ctx.fillRect(10, ty - 13, tw + 12, 17);
    ctx.fillStyle = mk.c; ctx.fillText(mk.t, 16, ty);
  }
  ctx.globalAlpha = 1;
  // Zielpfeil
  const ov = objective();
  if (ov && ov.o) {
    const dx = ov.o.x - P.x, dy = ov.o.y - P.y, dd = Math.hypot(dx, dy);
    if (dd > 260) {
      const a = Math.atan2(dy, dx), rad = Math.min(VW, VH) / 2 - 46;
      ctx.save(); ctx.translate(VW / 2 + Math.cos(a) * rad, VH / 2 + Math.sin(a) * rad); ctx.rotate(a);
      ctx.fillStyle = ov.col;
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
      ctx.fillText(''); ctx.restore();
    }
  }
  if (G.overlay.t === 'busted' || G.overlay.t === 'wasted') {
    ctx.textAlign = 'center';
    const isB = G.overlay.t === 'busted';
    ctx.font = 'bold 72px "Segoe UI", system-ui';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(isB ? 'BUSTED!' : 'WASTED!', VW / 2 + 3, VH / 2 + 3);
    ctx.fillStyle = isB ? '#6c9bff' : '#ff5a4e'; ctx.fillText(isB ? 'BUSTED!' : 'WASTED!', VW / 2, VH / 2);
    ctx.font = '16px system-ui'; ctx.fillStyle = '#dfe6f2';
    ctx.fillText(isB ? 'Kaution $300 – Rueckkehr zum Police Department…' : 'Behandlung $250 – Rueckkehr zum Krankenhaus…', VW / 2, VH / 2 + 34);
  }
}
function drawMinimap() {
  const x = 12, y = 12, w = MINI, k = MINI / WORLD;
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,14,0.72)'; ctx.fillRect(x - 3, y - 3, w + 6, w + 6);
  ctx.drawImage(miniC, x, y);
  const dot = (wx, wy, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + wx * k, y + wy * k, r || 2.4, 0, TAU); ctx.fill(); };
  for (const c of G.cars) if (c.type === 'police') dot(c.x, c.y, '#4f8bff', 3);
  for (const p of G.peds) if (p.type === 'cop' && p.state !== 'dead') dot(p.x, p.y, '#2f5a8a', 2);
  for (const mk of markers) dot(mk.x, mk.y, mk.col, 2.2);
  const ov = objective();
  if (ov && ov.o) dot(ov.o.x, ov.o.y, ov.col, 3.6);
  dot(P.x, P.y, '#fff', 3.6);
  ctx.strokeStyle = '#333c52'; ctx.lineWidth = 1; ctx.strokeRect(x - 3.5, y - 3.5, w + 7, w + 7);
  ctx.restore();
}

/* ---------------- Boot ---------------- */
prerenderMap(); buildMarkers(); initPickups();
G.cam.x = P.x; G.cam.y = P.y;
for (let i = 0; i < 18; i++) spawnTraffic();
for (let i = 0; i < 32; i++) spawnPeds();
for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
  if (blocks[by][bx].kind !== 'lot') continue;
  const x0 = (bx * SEG + 3) * T, y0 = (by * SEG + 3) * T;
  for (let i = 0; i < 3; i++) {
    const pc = mkCar(x0 + 34 + i * 46, y0 + 44, -Math.PI / 2, pick(['sedan', 'van', 'sport']));
    pc.parked = true; G.cars.push(pc);
  }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (G.playing) update(dt);
  draw();
}
if (/[?&]tick=/.test(location.href)) {   // Headless-Testschleife: dt-treu ohne RAF
  let vNow = performance.now();
  setInterval(() => { vNow += 33.333; frame(vNow); }, 25);
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(function loop(now) { frame(now); requestAnimationFrame(loop); });
}
window.onerror = e => console.log('GAME-ERR:', e);
requestAnimationFrame(frame);
