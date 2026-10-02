/**
 * Agent Town — the animated scene next to the hero copy.
 *
 * A small isometric island where AI agents shop, book, buy data and hire each
 * other. Trust runs both ways: merchants check a buyer's passport (does it pay
 * on time, does it keep bookings), and buyers check a seller's (does it honor
 * the quote, does it deliver). Kept promises earn stamps; broken ones (a late
 * cancel) stay on the record. Strangers (grey, just an address) are turned
 * away until they get a passport at the office, which issues them by
 * invitation — the same rule the site states.
 *
 * Everything here is illustrative: names and numbers are made up, and escrow
 * and stamps are drawn the way they are designed to work, not as live data.
 * The canvas says "Simulation" in its corner for that reason.
 *
 * Plain canvas 2D, no libraries. Honors prefers-reduced-motion (draws one
 * still frame), pauses when off screen or when the tab is hidden, and cleans
 * up everything it starts. `startAgentTown` returns the cleanup function.
 */

type Kind = 'service' | 'buy' | 'quote' | 'book' | 'reserve' | 'api';

type Building = {
  key: string;
  kind: Kind | 'office';
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number;
  col: string;
  roof: string;
  label: string;
  sub?: string;
  office?: boolean;
  keeper?: string;
  busy: boolean;
};

type Agent = {
  name: string;
  passport: boolean;
  color: string;
  gx: number;
  gy: number;
  tx: number;
  ty: number;
  speed: number;
  stats: { paid: number; kept: number; cancels: number; quotes: number; delivered: number; api: number };
  keeper: Building | null;
  goal: Building | null;
  state: 'idle' | 'walk' | 'tending' | 'trade' | 'toOffice';
  timer: number;
  bob: number;
  glow: number;
  hover: boolean;
  trail: { gx: number; gy: number; life: number }[];
  sx: number;
  sy: number;
  r: number;
};

type Trade = { buyer: Agent; seller: Agent | null; stall: Building; t: number; ph: number; cancel: boolean };
type Pop =
  | { k: 'card'; who: Agent; head: string; name: string; line: string; line2?: string; life: number; max: number }
  | { k: 'bubble'; who: Agent; text: string; life: number; max: number }
  | { k: 'lock'; b: Building; life: number; max: number }
  | { k: 'stamp'; who: Agent; text: string; bad: boolean; life: number; max: number }
  | { k: 'tag'; b: Building; text: string; life: number; max: number }
  | { k: 'claim'; who: Agent; text: string; life: number; max: number };
type Coin = { from?: Agent; fromB?: Building; to?: Agent; toB?: Building; t: number; dur: number };
type Beam = { a: Agent; b: Agent; t: number; dur: number };
type Ring = { gx: number; gy: number; t: number; max: number; col: string; size: number };
type Mote = { x: number; y: number; z: number; s: number; p: number };

const GOLD = '#D8C48F';
const GOLD_LIGHT = '#F1DFA8';
const CREAM = '#F4EFE0';
const DEEP = '#123E34';
const OK = '#62D69A';
const BAD = '#F08A72';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';

const PALETTE = ['#7FE0B0', '#FFAE94', '#A6C8FF', '#F2D68C', '#CDB2FF', '#8FE3DC', '#FFC0D8', '#C3E68F'];
const RESIDENTS = ['atlas', 'nova', 'orbit', 'juno', 'sage', 'pixel', 'ember', 'quill', 'tide'];
const NEWCOMERS = ['lumen', 'vega', 'kai', 'mira', 'zeno', 'luna', 'arlo', 'iris'];

const N = 16;
const TW = 72;
const TH = 36;
const CX = 8;
const CY = 8;
const R = 6.7;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

/** Removes, in place, every item `keep` rejects. */
function prune<T>(items: T[], keep: (item: T) => boolean): void {
  let w = 0;
  for (const item of items) if (keep(item)) items[w++] = item;
  items.length = w;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function startAgentTown(canvas: HTMLCanvasElement): () => void {
  const maybeCtx = canvas.getContext('2d');
  if (!maybeCtx) return () => {};
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- world ----------
  const tiles: { gx: number; gy: number; h: number; d: number; tone: number }[] = [];
  for (let gx = 0; gx < N; gx++) {
    for (let gy = 0; gy < N; gy++) {
      const d = Math.hypot(gx - CX, gy - CY);
      const wob = Math.sin(gx * 1.7) * 0.5 + Math.cos(gy * 1.3) * 0.5;
      if (d < R + wob * 0.5) tiles.push({ gx, gy, h: lift(gx, gy), d, tone: Math.sin(gx * 3.1) * Math.cos(gy * 2.3) * 6 });
    }
  }
  tiles.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));

  const office: Building = { key: 'office', kind: 'office', gx: 7.0, gy: 3.4, w: 1.9, d: 1.6, h: 86, col: DEEP, roof: GOLD, label: 'PASSPORT OFFICE', sub: 'by invitation', office: true, busy: false };
  const stalls: Building[] = [
    { key: 'studio', kind: 'service', gx: 3.4, gy: 6.3, w: 1.4, d: 1.25, h: 54, col: '#1F5C4A', roof: '#5FC08C', label: 'STUDIO', keeper: 'atlas', busy: false },
    { key: 'shop', kind: 'buy', gx: 11.2, gy: 6.3, w: 1.4, d: 1.25, h: 54, col: '#5C2F27', roof: '#E2846C', label: 'SHOP', keeper: 'nova', busy: false },
    { key: 'travel', kind: 'reserve', gx: 4.1, gy: 10.2, w: 1.4, d: 1.25, h: 60, col: '#22385C', roof: '#8CB4F0', label: 'TRAVEL DESK', keeper: 'orbit', busy: false },
    { key: 'market', kind: 'quote', gx: 10.6, gy: 10.4, w: 1.4, d: 1.25, h: 48, col: '#5A4A22', roof: '#E8CF86', label: 'MARKET', keeper: 'juno', busy: false },
    { key: 'cafe', kind: 'book', gx: 7.6, gy: 12.1, w: 1.3, d: 1.15, h: 46, col: '#3D2F5C', roof: '#C6A8F0', label: 'CAFE', keeper: 'sage', busy: false },
    { key: 'data', kind: 'api', gx: 7.7, gy: 7.6, w: 0.9, d: 0.8, h: 34, col: '#16424A', roof: '#7FD6E0', label: 'DATA', sub: 'pay per call', busy: false },
  ];
  const buildings: Building[] = [office, ...stalls];
  const door = (b: Building) => ({ gx: b.gx + b.w / 2 + 0.5, gy: b.gy + b.d / 2 + 0.5 });
  const onLand = (gx: number, gy: number) => Math.hypot(gx - CX, gy - CY) < R - 1.1;

  function lift(gx: number, gy: number): number {
    const d = Math.hypot(gx - CX, gy - CY);
    return 10 + Math.max(0, 5 - d) * 1.4 + (Math.sin(gx * 0.9 + gy * 0.6) + 1) * 2;
  }

  const agents: Agent[] = [];
  let newcomer = 0;
  const emptyStats = () => ({ paid: 0, kept: 0, cancels: 0, quotes: 0, delivered: 0, api: 0 });
  const residentStats = () => ({
    paid: 6 + Math.floor(Math.random() * 30),
    kept: 2 + Math.floor(Math.random() * 12),
    cancels: Math.random() < 0.35 ? 1 : 0,
    quotes: 3 + Math.floor(Math.random() * 20),
    delivered: 3 + Math.floor(Math.random() * 20),
    api: 10 + Math.floor(Math.random() * 90),
  });
  function makeAgent(name: string, passport: boolean): Agent {
    let gx = CX;
    let gy = CY;
    for (let i = 0; i < 40; i++) {
      gx = CX + (Math.random() * 2 - 1) * 4.6;
      gy = CY + (Math.random() * 2 - 1) * 4.6;
      if (onLand(gx, gy)) break;
    }
    const keeper = stalls.find((s) => s.keeper === name) ?? null;
    if (keeper) {
      const dd = door(keeper);
      gx = dd.gx;
      gy = dd.gy;
    }
    return {
      name, passport, color: passport ? (PALETTE[agents.length % PALETTE.length] ?? '#7FE0B0') : '#7D8A84',
      gx, gy, tx: gx, ty: gy, speed: 1.0 + Math.random() * 0.45,
      stats: passport ? residentStats() : emptyStats(), keeper, goal: null,
      state: 'idle', timer: Math.random() * 2, bob: Math.random() * 6, glow: 0, hover: false, trail: [],
      sx: -1000, sy: -1000, r: 10,
    };
  }
  RESIDENTS.forEach((n) => agents.push(makeAgent(n, true)));
  function addStranger(): void {
    const hex = () => Math.random().toString(16).slice(2, 6);
    const a = makeAgent(`0x${hex()}…${hex().slice(0, 3)}`, false);
    const edge = Math.random() * Math.PI * 2;
    a.gx = CX + Math.cos(edge) * (R - 1.3);
    a.gy = CY + Math.sin(edge) * (R - 1.3);
    agents.push(a);
  }
  addStranger();

  const pops: Pop[] = [];
  const coins: Coin[] = [];
  const beams: Beam[] = [];
  const rings: Ring[] = [];
  const trades: Trade[] = [];
  const motes: Mote[] = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: Math.random() * 1.6 + 0.6, p: Math.random() * 6 }));
  const timers: number[] = [];
  let pinned: Agent | null = null;

  // ---------- layout ----------
  let VW = 0;
  let VH = 0;
  let DPR = 1;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let camX = 0;
  let camY = 0;
  let tCamX = 0;
  let tCamY = 0;
  const iso = (gx: number, gy: number): [number, number] => [((gx - gy) * TW) / 2, ((gx + gy) * TH) / 2];

  function layout(): void {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    VW = canvas.clientWidth;
    VH = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(VW * DPR));
    canvas.height = Math.max(1, Math.round(VH * DPR));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      const [x, y] = iso(t.gx, t.gy);
      minX = Math.min(minX, x - TW / 2);
      maxX = Math.max(maxX, x + TW / 2);
      minY = Math.min(minY, y - t.h);
      maxY = Math.max(maxY, y + TH + 18);
    }
    for (const b of buildings) {
      const [, y] = iso(b.gx, b.gy);
      minY = Math.min(minY, y - lift(b.gx, b.gy) - b.h - (b.office ? 90 : 50));
    }
    scale = Math.min((VW * 0.94) / (maxX - minX), (VH * 0.92) / (maxY - minY));
    ox = VW / 2 - ((minX + maxX) / 2) * scale;
    oy = VH / 2 - ((minY + maxY) / 2) * scale + 6;
  }

  const screen = (gx: number, gy: number, up = 0): [number, number] => {
    const [x, y] = iso(gx, gy);
    return [ox + (x + camX) * scale, oy + (y + camY - up) * scale];
  };
  const agentScreen = (a: Agent): [number, number] => screen(a.gx, a.gy, lift(a.gx, a.gy) + 18 + Math.sin(a.bob) * 2.2);
  const roofScreen = (b: Building): [number, number] => screen(b.gx + b.w / 2, b.gy + b.d / 2, lift(b.gx + b.w / 2, b.gy + b.d / 2) + b.h + 28);

  // ---------- behaviour ----------
  const keeperAgent = (s: Building) => agents.find((a) => a.name === s.keeper);

  function pickNext(a: Agent): void {
    if (a.keeper) {
      const d = door(a.keeper);
      a.tx = d.gx + (Math.random() - 0.5) * 0.8;
      a.ty = d.gy + (Math.random() - 0.5) * 0.6;
      a.state = 'tending';
      a.timer = 2 + Math.random() * 3;
      return;
    }
    const s = a.passport ? pick(stalls) : pick(stalls.filter((b) => b.keeper));
    if (!a.passport || Math.random() < 0.72) {
      if (a.passport && (s.busy || s.keeper === a.name)) {
        a.state = 'idle';
        a.timer = 0.6;
        return;
      }
      const d = door(s);
      a.goal = s;
      a.tx = d.gx + 0.65;
      a.ty = d.gy + 0.2;
      a.state = 'walk';
      return;
    }
    let gx = CX;
    let gy = CY;
    for (let i = 0; i < 40; i++) {
      gx = CX + (Math.random() * 2 - 1) * 4.6;
      gy = CY + (Math.random() * 2 - 1) * 4.6;
      if (onLand(gx, gy)) break;
    }
    a.goal = null;
    a.tx = gx;
    a.ty = gy;
    a.state = 'walk';
  }

  function startTrade(buyer: Agent, stall: Building): void {
    const seller = keeperAgent(stall) ?? null;
    if (!seller && stall.kind !== 'api') {
      buyer.state = 'idle';
      buyer.timer = 0.4;
      return;
    }
    stall.busy = true;
    buyer.state = 'trade';
    trades.push({ buyer, seller, stall, t: 0, ph: 0, cancel: stall.kind === 'reserve' && Math.random() < 0.2 });
  }

  function refuse(a: Agent, stall: Building): void {
    const s = keeperAgent(stall) ?? a;
    pops.push({ k: 'bubble', who: s, text: 'Who are you?', life: 2.2, max: 2.2 });
    const d = door(office);
    a.tx = d.gx;
    a.ty = d.gy;
    a.state = 'toOffice';
    a.timer = 0;
  }

  function issuePassport(a: Agent): void {
    a.name = NEWCOMERS[newcomer++ % NEWCOMERS.length] ?? 'newcomer';
    a.passport = true;
    a.stats = emptyStats();
    a.color = pick(PALETTE);
    rings.push({ gx: a.gx, gy: a.gy, t: 0, max: 1.1, col: GOLD, size: 80 });
    pops.push({ k: 'claim', who: a, text: a.name, life: 2.6, max: 2.6 });
    a.state = 'idle';
    a.timer = 1;
    timers.push(window.setTimeout(addStranger, 4000 + Math.random() * 3000));
  }

  function stamp(who: Agent, text: string, bad = false): void {
    rings.push({ gx: who.gx, gy: who.gy, t: 0, max: 0.9, col: bad ? BAD : OK, size: 64 });
    pops.push({ k: 'stamp', who, text, bad, life: 1.9, max: 1.9 });
  }

  function finish(T: Trade): void {
    T.stall.busy = false;
    T.buyer.state = 'idle';
    T.buyer.timer = 0.8;
    trades.splice(trades.indexOf(T), 1);
  }

  /** One scripted exchange per kind of place. Phases advance on time. */
  function stepTrades(dt: number): void {
    for (const T of [...trades]) {
      T.t += dt;
      const { buyer, seller, stall } = T;
      const b = buyer.stats;
      switch (stall.kind) {
        case 'service': // buyer checks the seller, pays into escrow, seller earns a stamp
          if (!seller) break;
          if (T.ph === 0) {
            beams.push({ a: buyer, b: seller, t: 0, dur: 1.3 });
            pops.push({ k: 'card', who: buyer, head: 'PASSPORT CHECK', name: seller.name, line: `✓ ${seller.stats.delivered} jobs delivered`, life: 2.0, max: 2.0 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 1.35) {
            coins.push({ from: buyer, toB: stall, t: 0, dur: 0.75 });
            T.ph = 2;
          } else if (T.ph === 2 && T.t > 2.1) {
            pops.push({ k: 'lock', b: stall, life: 1.7, max: 1.7 });
            T.ph = 3;
          } else if (T.ph === 3 && T.t > 3.6) {
            coins.push({ fromB: stall, to: seller, t: 0, dur: 0.65 });
            T.ph = 4;
          } else if (T.ph === 4 && T.t > 4.3) {
            seller.stats.delivered += 1;
            stamp(seller, '+ DELIVERED');
            finish(T);
          }
          break;
        case 'buy': // the merchant checks the buyer
          if (!seller) break;
          if (T.ph === 0) {
            beams.push({ a: seller, b: buyer, t: 0, dur: 1.3 });
            pops.push({ k: 'card', who: seller, head: 'SHOP CHECKS BUYER', name: buyer.name, line: `✓ paid on time ${b.paid} of ${b.paid}`, line2: 'Owner-approved · limit $50', life: 2.2, max: 2.2 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 1.5) {
            coins.push({ from: buyer, to: seller, t: 0, dur: 0.7 });
            T.ph = 2;
          } else if (T.ph === 2 && T.t > 2.35) {
            b.paid += 1;
            stamp(buyer, '+ PAID ON TIME');
            finish(T);
          }
          break;
        case 'quote': // the buyer checks the seller's quotes
          if (!seller) break;
          if (T.ph === 0) {
            beams.push({ a: buyer, b: seller, t: 0, dur: 1.3 });
            pops.push({ k: 'card', who: buyer, head: 'PASSPORT CHECK', name: seller.name, line: `✓ ${seller.stats.quotes} quotes honored`, line2: 'Quoted $20 · charged $20', life: 2.2, max: 2.2 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 1.5) {
            coins.push({ from: buyer, to: seller, t: 0, dur: 0.7 });
            T.ph = 2;
          } else if (T.ph === 2 && T.t > 2.35) {
            seller.stats.quotes += 1;
            stamp(seller, '+ QUOTE HONORED');
            finish(T);
          }
          break;
        case 'book': // the cafe checks whether the buyer keeps bookings
          if (!seller) break;
          if (T.ph === 0) {
            beams.push({ a: seller, b: buyer, t: 0, dur: 1.3 });
            pops.push({ k: 'card', who: seller, head: 'BOOKING CHECK', name: buyer.name, line: `✓ ${b.kept} bookings kept`, line2: `${b.cancels} late cancels`, life: 2.2, max: 2.2 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 2.8) {
            b.kept += 1;
            stamp(buyer, '+ BOOKING KEPT');
            finish(T);
          }
          break;
        case 'reserve': // a deposit is held; the booking is kept, or cancelled late and recorded
          if (!seller) break;
          if (T.ph === 0) {
            beams.push({ a: seller, b: buyer, t: 0, dur: 1.3 });
            pops.push({ k: 'card', who: seller, head: 'BOOKING CHECK', name: buyer.name, line: `✓ ${b.kept} bookings kept`, line2: `${b.cancels} late cancels`, life: 2.2, max: 2.2 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 1.5) {
            coins.push({ from: buyer, toB: stall, t: 0, dur: 0.7 });
            T.ph = 2;
          } else if (T.ph === 2 && T.t > 2.25) {
            pops.push({ k: 'lock', b: stall, life: 1.4, max: 1.4 });
            T.ph = 3;
          } else if (T.ph === 3 && T.t > 3.6) {
            if (T.cancel) {
              b.cancels += 1;
              stamp(buyer, 'LATE CANCEL · RECORDED', true);
            } else {
              b.kept += 1;
              stamp(buyer, '+ BOOKING KEPT');
            }
            finish(T);
          }
          break;
        case 'api': // pay per call, settled on the spot
          if (T.ph === 0) {
            coins.push({ from: buyer, toB: stall, t: 0, dur: 0.6 });
            T.ph = 1;
          } else if (T.ph === 1 && T.t > 0.65) {
            pops.push({ k: 'tag', b: stall, text: 'PAID PER CALL · x402', life: 1.6, max: 1.6 });
            T.ph = 2;
          } else if (T.ph === 2 && T.t > 1.3) {
            b.api += 1;
            stamp(buyer, '+ DATA PAID');
            finish(T);
          }
          break;
      }
    }
  }

  let time = 0;
  function step(dt: number): void {
    time += dt;
    camX += (tCamX - camX) * Math.min(1, dt * 3);
    camY += (tCamY - camY) * Math.min(1, dt * 3);
    for (const a of agents) {
      a.bob += dt * 6;
      a.glow += ((a.hover || a === pinned ? 1 : 0) - a.glow) * Math.min(1, dt * 8);
      if (a.state === 'idle' || a.state === 'tending') {
        a.timer -= dt;
        if (a.timer <= 0) {
          if (a.state === 'tending' && a.keeper) {
            a.timer = 2 + Math.random() * 3;
            const d = door(a.keeper);
            a.tx = d.gx + (Math.random() - 0.5) * 1.0;
            a.ty = d.gy + (Math.random() - 0.5) * 0.7;
          } else pickNext(a);
        }
      }
      if (a.state === 'walk' || a.state === 'toOffice' || a.state === 'tending') {
        const dx = a.tx - a.gx;
        const dy = a.ty - a.gy;
        const d = Math.hypot(dx, dy);
        if (d > 0.04) {
          const v = Math.min(d, a.speed * dt);
          a.gx += (dx / d) * v;
          a.gy += (dy / d) * v;
          if (a.passport && Math.random() < 0.5) a.trail.push({ gx: a.gx, gy: a.gy, life: 0.6 });
        } else if (a.state === 'walk') {
          if (a.goal) {
            if (!a.passport) refuse(a, a.goal);
            else if (a.goal.busy) {
              a.state = 'idle';
              a.timer = 0.5;
            } else startTrade(a, a.goal);
          } else {
            a.state = 'idle';
            a.timer = 0.5 + Math.random() * 1.5;
          }
        } else if (a.state === 'toOffice') {
          a.timer += dt;
          if (a.timer > 1.0) issuePassport(a);
        }
      }
      for (const t of a.trail) t.life -= dt;
      prune(a.trail, (t) => t.life > 0);
    }
    stepTrades(dt);
    for (const p of pops) p.life -= dt;
    for (const c of coins) c.t += dt;
    for (const b of beams) b.t += dt;
    for (const r of rings) r.t += dt;
    prune(pops, (p) => p.life > 0);
    prune(coins, (c) => c.t < c.dur);
    prune(beams, (b) => b.t < b.dur);
    prune(rings, (r) => r.t < r.max);
    for (const m of motes) {
      m.y -= dt * (0.004 + m.z * 0.01);
      m.p += dt;
      if (m.y < -0.02) {
        m.y = 1.02;
        m.x = Math.random();
      }
    }
  }

  // ---------- drawing ----------
  function rr(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

  function drawBackdrop(): void {
    const [wx, wy] = screen(CX, CY);
    const g = ctx.createRadialGradient(wx, wy, 10, wx, wy, Math.max(VW, VH) * 0.8);
    g.addColorStop(0, '#163E33');
    g.addColorStop(0.5, '#0C231C');
    g.addColorStop(1, '#07130F');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 4; i++) {
      const k = (time * 0.12 + i / 4) % 1;
      ctx.strokeStyle = `rgba(143,209,176,${(1 - k) * 0.12})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(wx, wy + 18 * scale, (R * TW * 0.78 + k * 140) * scale, (R * TH * 0.78 + k * 70) * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawTile(t: { gx: number; gy: number; h: number; d: number; tone: number }): void {
    const [x, y] = iso(t.gx, t.gy);
    const sx = ox + (x + camX) * scale;
    const sy = oy + (y + camY) * scale;
    const w = (TW / 2) * scale;
    const h = (TH / 2) * scale;
    const hh = t.h * scale;
    const base = 52 + t.tone;
    ctx.fillStyle = `rgb(${(18 + base * 0.18) | 0},${(62 + base * 0.5) | 0},${(48 + base * 0.3) | 0})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + w, sy + h - hh);
    ctx.lineTo(sx, sy + 2 * h - hh);
    ctx.lineTo(sx - w, sy + h - hh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,196,143,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (t.d > R - 2.1) {
      const drop = 16 * scale;
      ctx.fillStyle = '#0D2A22';
      ctx.beginPath();
      ctx.moveTo(sx - w, sy + h - hh);
      ctx.lineTo(sx, sy + 2 * h - hh);
      ctx.lineTo(sx, sy + 2 * h + drop);
      ctx.lineTo(sx - w, sy + h + drop);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#123629';
      ctx.beginPath();
      ctx.moveTo(sx + w, sy + h - hh);
      ctx.lineTo(sx, sy + 2 * h - hh);
      ctx.lineTo(sx, sy + 2 * h + drop);
      ctx.lineTo(sx + w, sy + h + drop);
      ctx.closePath();
      ctx.fill();
    }
  }

  function label(text: string, x: number, y: number, border: string, size = 10.5, sub?: string): void {
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(6,16,12,.8)';
    rr(x - tw / 2, y - 14, tw, 20, 10);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    rr(x - tw / 2, y - 14, tw, 20, 10);
    ctx.stroke();
    ctx.fillStyle = CREAM;
    ctx.fillText(text, x, y + 0.5);
    if (sub) {
      ctx.fillStyle = GOLD;
      ctx.font = `600 ${size - 1}px ${MONO}`;
      ctx.fillText(sub, x, y + 16);
    }
  }

  function drawBuilding(b: Building): void {
    const z0 = lift(b.gx + b.w / 2, b.gy + b.d / 2);
    const z1 = z0 + b.h;
    const P = (gx: number, gy: number, z: number): [number, number] => screen(gx, gy, z);
    const x0 = b.gx;
    const y0 = b.gy;
    const x1 = b.gx + b.w;
    const y1 = b.gy + b.d;
    const poly = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    poly([P(x0 + 0.3, y1 + 0.3, z0), P(x1 + 0.3, y1 + 0.3, z0), P(x1 + 0.3, y0 + 0.3, z0)]);
    ctx.fillStyle = shade(b.col, 0.78);
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
    ctx.fillStyle = shade(b.col, 1.08);
    poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]);
    const glow = 0.55 + 0.25 * Math.sin(time * 2 + b.gx);
    ctx.fillStyle = `rgba(241,223,168,${glow})`;
    const win = Math.max(3, 8 * scale);
    for (let i = 0; i < 3; i++) {
      const [wx, wy] = P(x0 + b.w * (0.2 + i * 0.27), y1, z0 + b.h * 0.45);
      ctx.fillRect(wx - win / 2, wy - win * 0.7, win, win * 1.3);
    }
    for (let i = 0; i < 2; i++) {
      const [wx, wy] = P(x1, y0 + b.d * (0.3 + i * 0.38), z0 + b.h * 0.45);
      ctx.fillRect(wx - win / 2, wy - win * 0.7, win * 0.9, win * 1.3);
    }
    ctx.fillStyle = b.roof;
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    poly([P(x0, y0, z1), P(x1, y0, z1), P((x0 + x1) / 2, (y0 + y1) / 2, z1)]);
    if (b.office) {
      const [bx, by] = P((x0 + x1) / 2, (y0 + y1) / 2, z1 + 6);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
      const rad = Math.max(30, 80 * scale);
      const g = ctx.createRadialGradient(bx, by, 2, bx, by, rad);
      g.addColorStop(0, `rgba(241,223,168,${0.5 + 0.3 * pulse})`);
      g.addColorStop(1, 'rgba(241,223,168,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    const [sx, sy] = P(x0 + b.w * 0.5, y1, z1 + (b.office ? 46 : 18));
    label(b.label, sx, sy, b.office ? GOLD : b.roof, 10.5, b.sub);
    if (b.busy) {
      const [dx, dy] = P(x1, y1, z1 + 8);
      ctx.fillStyle = b.roof;
      ctx.beginPath();
      ctx.arc(dx, dy, 4 + Math.sin(time * 8) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAgent(a: Agent): void {
    const [x, y] = agentScreen(a);
    const r = Math.max(8, 13 * scale * 1.25);
    const [gxS, gyS] = screen(a.gx, a.gy, lift(a.gx, a.gy));
    for (const t of a.trail) {
      const [tx, ty] = screen(t.gx, t.gy, lift(t.gx, t.gy) + 10);
      ctx.fillStyle = `rgba(241,223,168,${t.life * 0.35})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(gxS, gyS, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    if (a.passport) {
      const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * (2.1 + a.glow));
      g.addColorStop(0, `${a.color}55`);
      g.addColorStop(1, `${a.color}00`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * (2.1 + a.glow), 0, Math.PI * 2);
      ctx.fill();
    }
    const body = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.2, x, y, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.25, a.color);
    body.addColorStop(1, shade(a.color, 0.55));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = (a.passport ? 2.2 : 1.4) + a.glow * 1.4;
    ctx.strokeStyle = a.passport ? GOLD : '#55615C';
    ctx.stroke();
    ctx.fillStyle = 'rgba(6,16,12,.85)';
    rr(x - r * 0.62, y - r * 0.32, r * 1.24, r * 0.5, r * 0.25);
    ctx.fill();
    const blink = Math.sin(time * 1.3 + a.bob * 3) > 0.97 ? 0.2 : 1;
    ctx.fillStyle = a.passport ? '#8FFFC8' : '#9AA7A1';
    ctx.fillRect(x - r * 0.36, y - r * 0.17, r * 0.2, r * 0.2 * blink);
    ctx.fillRect(x + r * 0.16, y - r * 0.17, r * 0.2, r * 0.2 * blink);
    ctx.strokeStyle = a.passport ? GOLD : '#55615C';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y - r * 1.55);
    ctx.stroke();
    ctx.fillStyle = a.passport ? GOLD_LIGHT : '#7D8A84';
    ctx.beginPath();
    ctx.arc(x, y - r * 1.62, 2.4, 0, Math.PI * 2);
    ctx.fill();
    const busy = trades.some((T) => T.buyer === a || T.seller === a);
    const full = a.glow > 0.3 || busy;
    const text = a.passport ? (full ? `${a.name}.musepass.eth` : a.name) : a.name;
    ctx.font = `600 10px ${MONO}`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 12;
    const ty = y + r + 5;
    ctx.fillStyle = a.passport ? 'rgba(18,62,52,.92)' : 'rgba(30,38,34,.88)';
    rr(x - tw / 2, ty, tw, 16, 8);
    ctx.fill();
    if (a.passport) {
      ctx.strokeStyle = `rgba(216,196,143,${0.5 + a.glow * 0.5})`;
      ctx.lineWidth = 1;
      rr(x - tw / 2, ty, tw, 16, 8);
      ctx.stroke();
    }
    ctx.fillStyle = a.passport ? CREAM : '#B7C3BD';
    ctx.fillText(text, x, ty + 11.5);
    a.sx = x;
    a.sy = y;
    a.r = r;
  }

  function drawBeam(bm: Beam): void {
    const [ax, ay] = agentScreen(bm.a);
    const [bx, by] = agentScreen(bm.b);
    const k = Math.min(1, bm.t / bm.dur);
    ctx.save();
    ctx.strokeStyle = `rgba(241,223,168,${(1 - k) * 0.9})`;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -time * 50;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 46, bx, by);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = `rgba(98,214,154,${1 - k})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(bx, by, 12 + k * 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawRing(rg: Ring): void {
    const k = rg.t / rg.max;
    const [x, y] = screen(rg.gx, rg.gy, lift(rg.gx, rg.gy));
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = rg.col;
    ctx.lineWidth = 2.6 * (1 - k) + 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, rg.size * k * Math.max(0.6, scale * 1.6), rg.size * k * 0.5 * Math.max(0.6, scale * 1.6), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawCoin(c: Coin): void {
    const A: [number, number] = c.from ? agentScreen(c.from) : c.fromB ? roofScreen(c.fromB) : [0, 0];
    const B: [number, number] = c.to ? agentScreen(c.to) : c.toB ? roofScreen(c.toB) : [0, 0];
    const k = Math.min(1, c.t / c.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const x = A[0] + (B[0] - A[0]) * e;
    const y = A[1] + (B[1] - A[1]) * e - Math.sin(k * Math.PI) * 50;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 14);
    g.addColorStop(0, 'rgba(241,223,168,.9)');
    g.addColorStop(1, 'rgba(241,223,168,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = DEEP;
    ctx.font = `800 8px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('$', x, y + 3);
  }

  function card(x: number, y: number, w: number, h: number, border: string): void {
    ctx.fillStyle = 'rgba(14,44,36,.96)';
    rr(x - w / 2, y - h, w, h, 11);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.3;
    rr(x - w / 2, y - h, w, h, 11);
    ctx.stroke();
  }

  function clampX(x: number, w: number): number {
    return Math.max(w / 2 + 8, Math.min(VW - w / 2 - 8, x));
  }

  function drawPop(p: Pop): void {
    const age = p.max - p.life;
    const inK = easeOut(Math.min(1, age / 0.35));
    const outK = Math.min(1, p.life / 0.35);
    ctx.globalAlpha = Math.min(inK, outK);
    if (p.k === 'card') {
      const [x0, y0] = agentScreen(p.who);
      const w = 226;
      const h = p.line2 ? 76 : 60;
      const x = clampX(x0, w);
      const y = Math.max(h + 8, y0 - 46 - (1 - inK) * 10);
      card(x, y, w, h, GOLD);
      ctx.textAlign = 'left';
      ctx.fillStyle = GOLD;
      ctx.font = `600 9.5px ${MONO}`;
      ctx.fillText(p.head, x - w / 2 + 12, y - h + 17);
      ctx.fillStyle = CREAM;
      ctx.font = `600 11.5px ${MONO}`;
      ctx.fillText(`${p.name}.musepass.eth`, x - w / 2 + 12, y - h + 34);
      ctx.fillStyle = OK;
      ctx.font = `700 11.5px ${SANS}`;
      ctx.fillText(p.line, x - w / 2 + 12, y - h + 51);
      if (p.line2) {
        ctx.fillStyle = '#A9BDB2';
        ctx.font = `600 11px ${SANS}`;
        ctx.fillText(p.line2, x - w / 2 + 12, y - h + 67);
      }
    } else if (p.k === 'bubble') {
      const [x0, y0] = agentScreen(p.who);
      ctx.font = `700 12px ${SANS}`;
      ctx.textAlign = 'center';
      const w = ctx.measureText(p.text).width + 22;
      const x = clampX(x0, w);
      const y = y0 - 30;
      ctx.fillStyle = 'rgba(48,22,18,.95)';
      rr(x - w / 2, y - 26, w, 26, 13);
      ctx.fill();
      ctx.strokeStyle = BAD;
      ctx.lineWidth = 1.3;
      rr(x - w / 2, y - 26, w, 26, 13);
      ctx.stroke();
      ctx.fillStyle = BAD;
      ctx.fillText(p.text, x, y - 9);
    } else if (p.k === 'lock') {
      const [x, y] = roofScreen(p.b);
      const s = 1 + Math.sin(time * 10) * 0.03;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = 'rgba(14,44,36,.96)';
      rr(-44, -15, 88, 30, 9);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.3;
      rr(-44, -15, 88, 30, 9);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-26, -2, 5, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      rr(-32.5, -2, 13, 10, 2);
      ctx.fill();
      ctx.fillStyle = CREAM;
      ctx.font = `700 10.5px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText('ESCROW', -14, 4);
      ctx.restore();
    } else if (p.k === 'stamp') {
      const [x0, y0] = agentScreen(p.who);
      const sc = 1 + (1 - inK) * 0.9;
      const col = p.bad ? BAD : OK;
      ctx.font = `800 11px ${SANS}`;
      const tw = ctx.measureText(p.text).width + 22;
      ctx.save();
      ctx.translate(clampX(x0 + 20, tw + 10), y0 - 36);
      ctx.rotate(-0.16);
      ctx.scale(sc, sc);
      if (p.bad) {
        ctx.fillStyle = 'rgba(48,22,18,.92)';
        rr(-tw / 2, -13, tw, 26, 6);
        ctx.fill();
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      rr(-tw / 2, -13, tw, 26, 6);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, 0, 4);
      ctx.restore();
    } else if (p.k === 'tag') {
      const [x, y] = roofScreen(p.b);
      ctx.font = `700 10.5px ${MONO}`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(p.text).width + 20;
      ctx.fillStyle = 'rgba(14,44,36,.96)';
      rr(x - tw / 2, y - 15, tw, 28, 9);
      ctx.fill();
      ctx.strokeStyle = '#7FD6E0';
      ctx.lineWidth = 1.3;
      rr(x - tw / 2, y - 15, tw, 28, 9);
      ctx.stroke();
      ctx.fillStyle = CREAM;
      ctx.fillText(p.text, x, y + 3);
    } else if (p.k === 'claim') {
      const [x0, y0] = agentScreen(p.who);
      const w = 214;
      const h = 48;
      const x = clampX(x0, w);
      const y = Math.max(h + 8, y0 - 36 - (1 - inK) * 10);
      card(x, y, w, h, GOLD_LIGHT);
      ctx.fillStyle = GOLD;
      ctx.font = `600 9.5px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText('NEW PASSPORT · INVITED', x - w / 2 + 12, y - h + 17);
      ctx.fillStyle = CREAM;
      ctx.font = `600 12px ${MONO}`;
      ctx.fillText(`${p.text}.musepass.eth`, x - w / 2 + 12, y - h + 35);
    }
    ctx.globalAlpha = 1;
  }

  function drawPinned(a: Agent): void {
    const [x0, y0] = agentScreen(a);
    const w = 236;
    const st = a.stats;
    const lines: [string, string][] = a.passport
      ? [
          ['#A9BDB2', 'Owner-approved · limit $50'],
          [OK, `Paid on time ${st.paid} · data calls paid ${st.api}`],
          [st.cancels ? BAD : OK, `Bookings kept ${st.kept} · late cancels ${st.cancels}`],
          ...(a.keeper ? ([[OK, `Delivered ${st.delivered} · quotes honored ${st.quotes}`]] as [string, string][]) : []),
        ]
      : [[BAD, 'Shops will not trade with it yet']];
    const h = 44 + lines.length * 17;
    const x = clampX(x0, w);
    const y = Math.max(h + 8, y0 - 40);
    card(x, y, w, h, GOLD_LIGHT);
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = `600 9.5px ${MONO}`;
    ctx.fillText(a.passport ? 'MUSEPASS · EXAMPLE' : 'NO PASSPORT', x - w / 2 + 12, y - h + 17);
    ctx.fillStyle = CREAM;
    ctx.font = `600 12px ${MONO}`;
    ctx.fillText(a.passport ? `${a.name}.musepass.eth` : a.name, x - w / 2 + 12, y - h + 35);
    ctx.font = `600 11px ${SANS}`;
    lines.forEach(([col, text], i) => {
      ctx.fillStyle = col;
      ctx.fillText(text, x - w / 2 + 12, y - h + 53 + i * 17);
    });
  }

  function drawMotes(): void {
    for (const m of motes) {
      const a = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(m.p * 1.5));
      ctx.fillStyle = `rgba(241,223,168,${a * m.z})`;
      ctx.beginPath();
      ctx.arc(m.x * VW + Math.sin(m.p) * 6, m.y * VH, m.s * m.z + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(): void {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackdrop();
    tiles.forEach(drawTile);
    const objects: { d: number; fn: () => void }[] = [];
    for (const b of buildings) objects.push({ d: b.gx + b.w + b.gy + b.d, fn: () => drawBuilding(b) });
    for (const a of agents) objects.push({ d: a.gx + a.gy + 0.6, fn: () => drawAgent(a) });
    objects.sort((p, q) => p.d - q.d).forEach((o) => o.fn());
    rings.forEach(drawRing);
    beams.forEach(drawBeam);
    coins.forEach(drawCoin);
    pops.forEach(drawPop);
    if (pinned) drawPinned(pinned);
    drawMotes();
    ctx.font = `600 9.5px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(169,189,178,.8)';
    ctx.fillText('SIMULATION · EXAMPLE DATA', VW - 12, 18);
  }

  // ---------- input ----------
  function hit(mx: number, my: number): Agent | null {
    let best: Agent | null = null;
    let bd = Infinity;
    for (const a of agents) {
      const d = Math.hypot(mx - a.sx, my - a.sy);
      if (d < a.r * 2 && d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }
  function onMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const h = hit(mx, my);
    for (const a of agents) a.hover = a === h;
    canvas.style.cursor = h ? 'pointer' : 'default';
    if (!reduce) {
      tCamX = (mx / VW - 0.5) * -18;
      tCamY = (my / VH - 0.5) * -10;
    }
    if (reduce) draw();
  }
  function onLeave(): void {
    for (const a of agents) a.hover = false;
    tCamX = 0;
    tCamY = 0;
    if (reduce) draw();
  }
  function onClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const h = hit(e.clientX - rect.left, e.clientY - rect.top);
    pinned = h && h !== pinned ? h : null;
    if (reduce) draw();
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  // ---------- run ----------
  let raf = 0;
  let running = false;
  let visible = true;
  let last = 0;
  function loop(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = window.requestAnimationFrame(loop);
  }
  function play(): void {
    if (running || reduce) return;
    running = true;
    last = performance.now();
    raf = window.requestAnimationFrame(loop);
  }
  function pause(): void {
    running = false;
    window.cancelAnimationFrame(raf);
  }
  function sync(): void {
    if (visible && document.visibilityState === 'visible') play();
    else pause();
  }

  const ro = new ResizeObserver(() => {
    layout();
    draw();
  });
  ro.observe(canvas);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((en) => en.isIntersecting);
    sync();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', sync);

  layout();
  if (reduce) {
    for (let i = 0; i < 300; i++) step(1 / 30);
    draw();
  } else {
    draw();
    sync();
  }

  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('click', onClick);
    timers.forEach((t) => window.clearTimeout(t));
  };
}
