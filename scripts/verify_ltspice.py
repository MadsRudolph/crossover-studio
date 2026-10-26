#!/usr/bin/env python3
"""Run an exported Crossover Studio LTspice folder in LTspice and compare V(Psum) with the app's engine.

    python3 scripts/verify_ltspice.py [FOLDER]        # default <system temp>/xs-ltspice

FOLDER is what the LTspice tab of the Export sheet writes (System_<profile>.asc, the .txt tables) plus an
expected.json with the engine's complex sum per angle. `npx vitest run src/export` writes such a folder
for the bundled System D profile. Needs LTspice under wine (WINEPREFIX ~/.local/share/wineprefixes/ltspice,
/usr/share/ltspice/LTspice.exe), the same setup as the course's Lab A scripts.

The .ac sweep is replaced by `.ac list` at exactly the measured frequencies, so LTspice reads every table
at its own points and the comparison measures the circuit, not the interpolation. Pass: median error
below 0.05 dB and 95th percentile below 0.3 dB over 100 Hz-18 kHz, for every angle.
"""
import json, math, os, pathlib, shutil, struct, subprocess, sys, tempfile

EXE = "/usr/share/ltspice/LTspice.exe"
PREFIX = os.path.expanduser("~/.local/share/wineprefixes/ltspice")
BAND = (100.0, 18000.0)


def read_raw(path):
    """Binary LTspice .raw (UTF-16 header, complex double data) -> {name: [complex]}."""
    b = path.read_bytes()
    key = "Binary:\n".encode("utf-16le")
    i = b.find(key)
    head, data = b[:i].decode("utf-16le"), b[i + len(key):]
    names, invars, npts = [], False, 0
    for ln in head.splitlines():
        if ln.startswith("No. Points:"):
            npts = int(ln.split(":")[1])
        if ln.startswith("Variables:"):
            invars = True
            continue
        if invars and ln.strip():
            names.append(ln.split()[1].lower())
    nv = len(names)
    vals = struct.unpack(f"<{npts * nv * 2}d", data[:npts * nv * 16])
    cols = {n: [] for n in names}
    for p in range(npts):
        for v, n in enumerate(names):
            k = 2 * (p * nv + v)
            cols[n].append(complex(vals[k], vals[k + 1]))
    return cols


def log_text(log):
    b = log.read_bytes()
    return b.decode("utf-16le", "ignore") if b[1:2] == b"\x00" else b.decode("utf-8", "ignore")


def run_ltspice(folder, asc_name, freqs):
    """LTspice's command line chokes on spaces, so run a copy in a space-free temp dir."""
    if not os.path.exists(EXE):
        raise SystemExit(f"LTspice not found at {EXE}")
    env = dict(os.environ, WINEARCH="win64", WINEPREFIX=PREFIX, WINEDEBUG="-all")
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="xsverify_"))
    try:
        for f in folder.iterdir():
            if f.suffix.lower() in (".asc", ".txt", ".plt"):
                shutil.copy(f, tmp / f.name)
        work = tmp / asc_name
        txt = work.read_text()
        sweep = "!.ac dec 200 20 20000"
        if sweep not in txt:
            raise SystemExit(f"{asc_name}: no '{sweep[1:]}' directive to replace")
        work.write_text(txt.replace(sweep, "!.ac list " + " ".join(f"{f:.10g}" for f in freqs)))
        wp = lambda q: subprocess.run(["winepath", "-w", str(q)], env=env, capture_output=True, text=True).stdout.strip()
        subprocess.run(["wine", EXE, "-netlist", wp(work)], env=env, capture_output=True, timeout=180, cwd=tmp)
        net = work.with_suffix(".net")
        if not net.exists():
            raise SystemExit(f"netlisting failed for {asc_name}")
        subprocess.run(["wine", EXE, "-b", wp(net)], env=env, capture_output=True, timeout=600, cwd=tmp)
        raw = work.with_suffix(".raw")
        if not raw.exists():
            log = work.with_suffix(".log")
            raise SystemExit(f"simulation failed for {asc_name}:\n" + (log_text(log) if log.exists() else "no log"))
        return read_raw(raw)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pct(v, q):
    s = sorted(v)
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main():
    folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(tempfile.gettempdir()) / "xs-ltspice").resolve()
    exp = json.loads((folder / "expected.json").read_text())
    f = exp["f"]
    print(f"running {exp['schematic']} at {len(f)} frequencies ...")
    cols = run_ltspice(folder, exp["schematic"], f)
    fl = [z.real for z in cols["frequency"]]
    if len(fl) != len(f) or any(abs(a - b) > 1e-6 * b for a, b in zip(fl, f)):
        raise SystemExit("LTspice returned a different frequency list")
    ok = True
    for ang, s in exp["sums"].items():
        node = s["node"].lower()
        got = cols.get(node)
        if got is None:
            print(f"  BAD {s['node']}: not in the LTspice output")
            ok = False
            continue
        want = [complex(r, i) for r, i in zip(s["re"], s["im"])]
        k = [j for j, x in enumerate(f) if BAND[0] <= x <= BAND[1]]
        e_db = [abs(20 * math.log10(abs(got[j]) / abs(want[j]))) for j in k]
        e_ph = [abs(math.degrees(math.atan2((got[j] / want[j]).imag, (got[j] / want[j]).real))) for j in k]
        med, p95, worst = pct(e_db, 0.5), pct(e_db, 0.95), max(e_db)
        good = med < 0.05 and p95 < 0.3
        ok &= good
        print(f"  {'OK ' if good else 'BAD'} {s['node']:10s} ({ang} deg) vs engine, 100 Hz-18 kHz: median {med:.4f} dB, "
              f"95 % {p95:.4f} dB, worst {worst:.4f} dB; phase median {pct(e_ph, 0.5):.3f} deg")
    print("ALL OK" if ok else "MISMATCH")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
