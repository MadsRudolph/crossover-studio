// Crossover Studio engine: a line-for-line port of design/xover.py and ltspice/task1/box_model.py.
// Pure functions on plain arrays; test_engine.mjs checks it against xover.py (reference.json).
// Complex arrays are {re: Float64Array, im: Float64Array}.

export function makeEngine(D) {
  const f = Float64Array.from(D.f), N = f.length, TWO_PI = 2 * Math.PI;
  const B = D.box;
  const cx = (re, im) => ({ re: Float64Array.from(re), im: Float64Array.from(im) });
  const TF = {}, ZI = {};
  for (const a of ["on", "off30"]) { TF[a] = {}; for (const u of ["woof", "mid", "tw"]) TF[a][u] = cx(...D.tf[a][u]); }
  for (const u of ["mid", "tw"]) ZI[u] = cx(...D.zi[u]);

  // ---------------------------------------------------------------- complex helpers (per element)
  const C = {
    make: n => ({ re: new Float64Array(n), im: new Float64Array(n) }),
    abs: (z, i) => Math.hypot(z.re[i], z.im[i]),
  };
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const inv = a => div([1, 0], a);
  const get = (z, i) => [z.re[i], z.im[i]];
  const db = (z, i) => 20 * Math.log10(Math.hypot(z.re[i], z.im[i]));

  // ---------------------------------------------------------------- box model (box_model.py)
  const RHO = B.rho, C0 = B.c;
  function zPiston(w, a, baffled) {
    const S = Math.PI * a * a;
    const MA1 = 8 * RHO / (3 * Math.PI ** 2 * a) * (baffled ? 1 : 0.6133 / 0.8488);
    const RA1 = 0.441 * RHO * C0 / S, RA2 = RHO * C0 / S, CA1 = 5.94 * a ** 3 / (RHO * C0 * C0);
    const y1 = inv([0, w * MA1]);
    const r1c = inv(add([1 / RA1, 0], [0, w * CA1]));
    return inv(add(y1, inv(add([RA2, 0], r1c))));
  }
  function boxDict({ fill = 1, RAB = 0, QL = 1e9, MAP = null, RAP = 0 } = {}) {
    const CAB = B.VB * fill / (RHO * C0 * C0);
    return { CAB, RAB, RAL: QL / (TWO_PI * 20 * CAB), MAP, RAP, ap: B.AP };
  }
  function ventBox(MAP, fill = 1) {
    const wb = 1 / Math.sqrt(MAP * B.VB * fill / (RHO * C0 * C0));
    return boxDict({ fill, RAB: B.RAB, QL: B.QL, MAP, RAP: wb * MAP / B.QP });
  }
  function boxSystem(freqs, bx) {
    const d = B.drv, n = freqs.length;
    const out = { ZE: C.make(n), UD: C.make(n), UP: C.make(n), p1m: C.make(n) };
    for (let i = 0; i < n; i++) {
      const w = TWO_PI * freqs[i];
      let Zfront, Zbox;
      if (!bx) { Zfront = zPiston(w, B.AD, false); Zbox = Zfront; }
      else {
        Zfront = zPiston(w, B.AD, true);
        let Yb = add(inv(add([bx.RAB, 0], inv([0, w * bx.CAB]))), [1 / bx.RAL, 0]);
        if (bx.MAP) Yb = add(Yb, inv([bx.RAP, w * bx.MAP]));
        Zbox = inv(Yb);
      }
      const ZM = add([d.Rms, w * d.Mmd - 1 / (w * d.Cms)], mul([B.SD * B.SD, 0], add(Zfront, Zbox)));
      const ZE = add([B.RE, w * d.Le], div([d.Bl * d.Bl, 0], ZM));
      const cur = inv(ZE);
      const UD = div(mul([B.SD * d.Bl, 0], cur), ZM);
      const UP = bx && bx.MAP ? div(mul(Zbox, UD), [bx.RAP, w * bx.MAP]) : [0, 0];
      const p = mul([0, w * RHO / TWO_PI], sub(UD, UP));
      for (const [k, v] of [["ZE", ZE], ["UD", UD], ["UP", UP], ["p1m", p]]) { out[k].re[i] = v[0]; out[k].im[i] = v[1]; }
    }
    return out;
  }
  // vent mass: one vent at length L interpolates the masses fitted to Lab D (linear in L, extrapolated);
  // a second tube uses the tube formula scaled by the same calibration as the first.
  const MAPfit = B.MAP.slice().sort((a, b) => a[0] - b[0]);
  function mapAt(L) {
    let k = 0;
    while (k < MAPfit.length - 2 && L > MAPfit[k + 1][0]) k++;
    const [L0, m0] = MAPfit[k], [L1, m1] = MAPfit[k + 1];
    return Math.max(5, m0 + (m1 - m0) * (L - L0) / (L1 - L0));
  }
  const tubeMass = (L, a) => RHO * (L + 1.46 * a) / (Math.PI * a * a);
  function boxConfig(box) {
    // -> {MAP|null, fill, label}
    const fill = box.fill ?? 1;
    if (box.mode === "plugged") return { MAP: null, fill, label: "vents plugged (closed box)" };
    if (box.mode === "one") return { MAP: mapAt(box.L), fill, label: `one vent, L = ${(box.L * 1e3).toFixed(0)} mm` };
    if (box.mode === "two") {
      const m1 = mapAt(box.L), cal = m1 / tubeMass(box.L, B.AP), m2 = cal * tubeMass(box.L2, box.a2);
      return { MAP: m1 * m2 / (m1 + m2), fill, label: `two vents (L ${(box.L * 1e3).toFixed(0)} + ${(box.L2 * 1e3).toFixed(0)} mm, second ⌀ ${(box.a2 * 2e3).toFixed(0)} mm)` };
    }
    return { MAP: box.MAP ?? null, fill, label: box.label || "custom" };
  }
  const closedRef = boxSystem(f, boxDict({ RAB: B.RAB })).p1m;
  function boxRatio(cfg) {
    const r = C.make(N);
    if (!cfg.MAP && (cfg.fill ?? 1) === 1) { r.re.fill(1); return r; }
    const p = boxSystem(f, cfg.MAP ? ventBox(cfg.MAP, cfg.fill) : boxDict({ RAB: B.RAB, fill: cfg.fill })).p1m;
    for (let i = 0; i < N; i++) { const q = div(get(p, i), get(closedRef, i)); r.re[i] = q[0]; r.im[i] = q[1]; }
    return r;
  }
  function f3Ripple(freqs, p, lo = 150, hi = 300) {
    const L = Array.from(freqs, (_, i) => db(p, i));
    const ks = L.filter((_, i) => freqs[i] >= lo && freqs[i] <= hi);
    const ref = ks.reduce((a, b) => a + b, 0) / ks.length;
    let last = -1, rip = -Infinity;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] < lo) { if (L[i] - ref < -3) last = i; rip = Math.max(rip, L[i] - ref); }
    }
    return { f3: last >= 0 ? freqs[last + 1] : freqs[0], ripple: rip, ref };
  }

  // ---------------------------------------------------------------- digital (DigitalCrossover.m)
  const FS = 96e3;
  function bq(f0, Q, kind) {
    const w0 = TWO_PI * f0 / FS, al = Math.sin(w0) / (2 * Q), a0 = 1 + al, c = Math.cos(w0);
    const b0 = kind === "LPF" ? (1 - c) / 2 / a0 : (1 + c) / 2 / a0;
    const b1 = kind === "LPF" ? (1 - c) / a0 : -(1 + c) / a0;
    return [b0, b1, b0, -2 * c / a0, (1 - al) / a0];
  }
  function sections(f0, kind, align) {
    const Qs = { BW2: [Math.SQRT1_2], LR4: [Math.SQRT1_2, Math.SQRT1_2],
                 BW4: [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos(3 * Math.PI / 8))] }[align];
    return Qs.map(Q => bq(f0, Q, kind));
  }
  function hDigital(f0, kind, align) {
    const H = C.make(N); H.re.fill(1);
    const secs = sections(f0, kind, align);
    for (let i = 0; i < N; i++) {
      const t = -TWO_PI * f[i] / FS, z1 = [Math.cos(t), Math.sin(t)], z2 = mul(z1, z1);
      let h = [1, 0];
      for (const [b0, b1, b2, a1, a2] of secs) {
        const num = add(add([b0, 0], mul([b1, 0], z1)), mul([b2, 0], z2));
        const den = add(add([1, 0], mul([a1, 0], z1)), mul([a2, 0], z2));
        h = mul(h, div(num, den));
      }
      H.re[i] = h[0]; H.im[i] = h[1];
    }
    return H;
  }
  function g15(x) {
    if (x === 0) return "0";
    const [m, e] = x.toExponential(14).split("e"), ex = parseInt(e, 10);
    if (ex < -4 || ex >= 15) {
      const mm = m.replace(/\.?0+$/, "");
      return `${mm}e${ex < 0 ? "-" : "+"}${String(Math.abs(ex)).padStart(2, "0")}`;
    }
    let s = x.toPrecision(15);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  function minidspText(f0, kind, align) {
    return sections(f0, kind, align).map(([b0, b1, b2, a1, a2], k) =>
      `\n biquad${k + 1}, \n b0 = ${b0.toFixed(15)}, \n b1 = ${b1.toFixed(15)}, \n b2 = ${b2.toFixed(15)}, ` +
      `\n a1 = ${(-a1).toFixed(15)}, \n a2 = ${(-a2).toFixed(15)}, `).join("");
  }
  function ltspiceText(f0, kind, align) {
    const T = g15(1 / FS);
    return sections(f0, kind, align).map(([b0, b1, b2, a1, a2]) =>
      `Laplace=(${g15(b0)}+${g15(b1)}*exp(-s*${T})+${g15(b2)}*exp(-2*s*${T}))/(1+${g15(a1)}*exp(-s*${T})+${g15(a2)}*exp(-2*s*${T}))`);
  }

  // ---------------------------------------------------------------- passive (ABCD ladder)
  const TOPOLOGIES = {
    LP1: [["series", "L", "L1"]],
    LP2: [["series", "L", "L1"], ["shunt", "C", "C1"]],
    HP2: [["series", "C", "C1"], ["shunt", "L", "L1"]],
    HP3: [["series", "C", "C1"], ["shunt", "L", "L1"], ["series", "C", "C2"]],
  };
  function passiveParts(b) {
    const parts = TOPOLOGIES[b.topo].map(([pos, kind, n]) => [pos, kind, b.vals[n]]);
    const pad = b.pad || {};
    if (pad.Rs) parts.push(["series", "R", pad.Rs]);
    if (pad.Rp) parts.push(["shunt", "R", pad.Rp]);
    return parts;
  }
  function ladder(parts, Zl, Rdcr = 0) {
    const T = C.make(N), Zin = C.make(N);
    for (let i = 0; i < N; i++) {
      const w = TWO_PI * f[i];
      let A = [1, 0], Bm = [0, 0], Cm = [0, 0], Dm = [1, 0];
      for (const [pos, kind, v] of parts) {
        let Z = kind === "L" ? [Rdcr * v * 1e3, w * v] : kind === "C" ? [0, -1 / (w * v)] : [v, 0];
        if (pos === "series") { Bm = add(mul(A, Z), Bm); Dm = add(mul(Cm, Z), Dm); }
        else { const Y = inv(Z); A = add(A, mul(Bm, Y)); Cm = add(Cm, mul(Dm, Y)); }
      }
      const zl = get(Zl, i), num = add(mul(A, zl), Bm);
      const t = div(zl, num), zi = div(num, add(mul(Cm, zl), Dm));
      T.re[i] = t[0]; T.im[i] = t[1]; Zin.re[i] = zi[0]; Zin.im[i] = zi[1];
    }
    return { T, Zin };
  }

  // ---------------------------------------------------------------- system
  function evaluate(des, angle, box, cache = {}) {
    const dg = des.digital;
    const HL = cache.HL || hDigital(dg.fc, "LPF", dg.align), HH = cache.HH || hDigital(dg.fc, "HPF", dg.align);
    const gw = 10 ** (dg.g_woof_dB / 20);
    const m = cache.m || ladder(passiveParts(des.mid), ZI.mid, des.Rdcr || 0);
    const t = cache.t || ladder(passiveParts(des.tw), ZI.tw, des.Rdcr || 0);
    const tf = TF[angle], P = des.pol;
    const out = { woof: C.make(N), mid: C.make(N), tw: C.make(N), sum: C.make(N), Zamp2: C.make(N) };
    for (let i = 0; i < N; i++) {
      const w = mul(mul(mul([P.woof * gw, 0], get(HL, i)), get(tf.woof, i)), get(box, i));
      const md = mul(mul(mul([P.mid, 0], get(HH, i)), get(m.T, i)), get(tf.mid, i));
      const tw = mul(mul(mul([P.tw, 0], get(HH, i)), get(t.T, i)), get(tf.tw, i));
      const s = add(add(w, md), tw), za = inv(add(inv(get(m.Zin, i)), inv(get(t.Zin, i))));
      for (const [k, v] of [["woof", w], ["mid", md], ["tw", tw], ["sum", s], ["Zamp2", za]]) { out[k].re[i] = v[0]; out[k].im[i] = v[1]; }
    }
    return Object.assign(out, { HL, HH, Tm: m.T, Tt: t.T });
  }

  // 1/6-octave smoothing windows, precomputed once for the fixed grid
  const lf = Array.from(f, x => Math.log2(x));
  const win = lf.map(x => { let a = 0; while (Math.abs(lf[a] - x) > 0.5 / 6) a++; let b = a; while (b + 1 < N && Math.abs(lf[b + 1] - x) <= 0.5 / 6) b++; return [a, b]; });
  function smooth(y) {
    const cs = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) cs[i + 1] = cs[i] + y[i];
    return Float64Array.from(win, ([a, b]) => (cs[b + 1] - cs[a]) / (b - a + 1));
  }
  const dbArr = z => Float64Array.from(f, (_, i) => db(z, i));
  const idx = (lo, hi) => { const k = []; for (let i = 0; i < N; i++) if (f[i] >= lo && f[i] <= hi) k.push(i); return k; };
  const median = v => { const s = Array.from(v).sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const K = idx(150, 15000), K300 = idx(300, 15000), iFs = f.reduce((b, x, i) => Math.abs(x - D.twFs) < Math.abs(f[b] - D.twFs) ? i : b, 0);

  function crossings(out, lo, hi, a, b) {
    const k = idx(lo, hi), sa = smooth(dbArr(out[a])), sb = smooth(dbArr(out[b]));
    const da = Float64Array.from(sa, (v, i) => v - sb[i]);
    const xs = k.slice(0, -1).filter(i => Math.sign(da[i]) !== Math.sign(da[i + 1]));
    if (!xs.length) return null;
    const c = Math.sqrt(lo * hi);
    return f[xs.reduce((p, i) => Math.abs(Math.log(f[i] / c)) < Math.abs(Math.log(f[p] / c)) ? i : p, xs[0])];
  }
  function penalty(des, box, out) {
    out = out || evaluate(des, "on", box);
    let pen = 0;
    for (const [key, a, b] of [["wm", "woof", "mid"], ["mt", "mid", "tw"]]) {
      const [lo, hi] = D.limits[key], fx = crossings(out, lo / 1.5, hi * 1.5, a, b);
      pen += fx === null ? 5 : 3 * Math.max(0, Math.log2(lo / fx), Math.log2(fx / hi));
    }
    const ys = smooth(dbArr(out.sum)), ref = median(K300.map(i => ys[i]));
    pen += 0.3 * Math.max(0, db(out.tw, iFs) - (ref - 12));
    return pen;
  }
  function score(des, box) {
    let s = 0, onOut = null;
    for (const [ang, wgt] of [["on", 1], ["off30", 0.5]]) {
      const out = evaluate(des, ang, box); if (ang === "on") onOut = out;
      const ys = smooth(dbArr(out.sum)), y = K.map(i => ys[i]), m = median(y);
      const dev = Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0) / y.length);
      let c2 = 0;
      for (const i of K) {
        const pw = 10 * Math.log10(["woof", "mid", "tw"].reduce((a, u) => a + out[u].re[i] ** 2 + out[u].im[i] ** 2, 0));
        c2 += Math.max(0, pw - db(out.sum, i)) ** 2;
      }
      s += wgt * (dev + 0.3 * Math.sqrt(c2 / K.length));
    }
    return s + penalty(des, box, onOut);
  }
  function metrics(des, box) {
    const res = {};
    let on;
    for (const ang of ["on", "off30"]) {
      const out = evaluate(des, ang, box); if (ang === "on") on = out;
      const ys = smooth(dbArr(out.sum)), y = K.map(i => ys[i]);
      const mean = y.reduce((a, b) => a + b, 0) / y.length;
      res[ang] = { spread: Math.max(...y) - Math.min(...y), rms: Math.sqrt(y.reduce((a, v) => a + (v - mean) ** 2, 0) / y.length), level: median(y) };
    }
    res.x_wm = crossings(on, 150, 900, "woof", "mid");
    res.x_mt = crossings(on, 1400, 6000, "mid", "tw");
    let zmin = Infinity;
    for (let i = 0; i < N; i++) if (f[i] > 200 && f[i] < 15000) zmin = Math.min(zmin, C.abs(on.Zamp2, i));
    res.Zamp2_min = zmin;
    return res;
  }

  // ---------------------------------------------------------------- optimiser (coordinate descent, as xover.optimise)
  function* optimise(des0, box, rounds = 4) {
    const des = structuredClone(des0);
    const choices = [
      [["digital", "fc"], Array.from({ length: 21 }, (_, k) => 200 + 25 * k)],
      [["digital", "align"], ["BW2", "LR4", "BW4"]],
      [["digital", "g_woof_dB"], Array.from({ length: 25 }, (_, k) => -10 + k / 2)],
    ];
    for (const [, kind, n] of TOPOLOGIES[des.mid.topo]) choices.push([["mid", "vals", n], kind === "L" ? D.std.L : D.std.C]);
    for (const [, kind, n] of TOPOLOGIES[des.tw.topo]) choices.push([["tw", "vals", n], kind === "L" ? D.std.L : D.std.C]);
    des.tw.pad = des.tw.pad || {};
    choices.push([["tw", "pad", "Rs"], [0, ...D.std.R]], [["tw", "pad", "Rp"], [null, ...D.std.R]],
                 [["pol", "tw"], [1, -1]], [["pol", "mid"], [1, -1]]);
    const getP = p => p.reduce((o, k) => o[k], des);
    const putP = (p, v) => { p.slice(0, -1).reduce((o, k) => o[k], des)[p[p.length - 1]] = v; };
    let best = score(des, box), total = rounds * choices.length, done = 0;
    for (let r = 0; r < rounds; r++) {
      let changed = false;
      for (const [path, opts] of choices) {
        let cur = getP(path);
        for (const v of opts) {
          putP(path, v); const s = score(des, box);
          if (s < best - 1e-9) { best = s; cur = v; changed = true; }
        }
        putP(path, cur); done++;
        yield { progress: done / total, score: best, des: structuredClone(des) };
      }
      if (!changed) break;
    }
    return { score: best, des };
  }

  // ---------------------------------------------------------------- tolerance (Monte Carlo)
  function tolerance(des, box, n = 120, tol = { L: 0.05, C: 0.10, R: 0.05 }) {
    const runs = [];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
    for (let r = 0; r < n; r++) {
      const t = structuredClone(des);
      for (const u of ["mid", "tw"]) {
        for (const [, kind, nm] of TOPOLOGIES[t[u].topo]) t[u].vals[nm] *= 1 + tol[kind] * rnd();
        for (const k of Object.keys(t[u].pad || {})) if (t[u].pad[k]) t[u].pad[k] *= 1 + tol.R * rnd();
      }
      runs.push(dbArr(evaluate(t, "on", box).sum));
    }
    const lo = new Float64Array(N), hi = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const col = runs.map(r => r[i]).sort((a, b) => a - b);
      lo[i] = col[Math.floor(0.025 * (n - 1))]; hi[i] = col[Math.ceil(0.975 * (n - 1))];
    }
    return { lo, hi };
  }

  return { f, N, TF, ZI, boxSystem, boxDict, ventBox, boxConfig, boxRatio, mapAt, f3Ripple, hDigital, minidspText, ltspiceText,
           TOPOLOGIES, passiveParts, ladder, evaluate, smooth, dbArr, crossings, score, metrics, optimise, tolerance, db, B };
}
