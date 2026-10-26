#!/usr/bin/env python3
"""Compile an exported Crossover Studio report folder with tectonic, to prove the LaTeX section builds.

    python3 scripts/verify_report.py [FOLDER]        # default <system temp>/xs-report

FOLDER is what the Report tab of the Export sheet writes (report_<profile>.tex, fig_*.csv,
preamble_snippet.tex, main_preview.tex). `npx vitest run src/export/report` writes such a folder for the
bundled System D profile. Needs tectonic (default ~/.local/bin/tectonic, or $TECTONIC); without it the
check is skipped (exit 0) so CI machines without TeX still pass.

Checks, in a temp copy of the folder: every fig_*.csv the .tex reads exists and has equal-length rows of
numbers or nan; main_preview.tex compiles to a PDF; the log has no LaTeX errors, undefined references or
missing files. Exit 1 on any failure.
"""
import os, pathlib, re, shutil, subprocess, sys, tempfile

TECTONIC = os.environ.get("TECTONIC", os.path.expanduser("~/.local/bin/tectonic"))


def check_csv(path):
    rows = path.read_text().strip().split("\n")
    head = rows[0].split(",")
    if head[0] != "f":
        return f"{path.name}: first column is {head[0]!r}, expected 'f'"
    for n, line in enumerate(rows[1:], 2):
        cells = line.split(",")
        if len(cells) != len(head):
            return f"{path.name}:{n}: {len(cells)} cells, header has {len(head)}"
        for c in cells:
            if c != "nan":
                try:
                    v = float(c)
                except ValueError:
                    return f"{path.name}:{n}: {c!r} is not a number"
                if v in (float("inf"), float("-inf")):
                    return f"{path.name}:{n}: infinite value"
    return None


def main():
    folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "xs-report"))
    if not (folder / "main_preview.tex").exists():
        sys.exit(f"{folder}/main_preview.tex not found: run `npx vitest run src/export/report` or export the report first")
    texs = sorted(folder.glob("report_*.tex"))
    if len(texs) != 1:
        sys.exit(f"expected one report_*.tex in {folder}, found {len(texs)}")
    problems = []
    tex = texs[0].read_text()
    for name in sorted(set(re.findall(r"\{\\xsdatapath ([^}]+)\}", tex))):
        p = folder / name
        if not p.exists():
            problems.append(f"{texs[0].name} reads {name}, which is not in the folder")
        else:
            err = check_csv(p)
            if err:
                problems.append(err)
    if not os.path.exists(TECTONIC):
        print(f"SKIP compile: tectonic not found at {TECTONIC}")
        for p in problems:
            print("FAIL", p)
        sys.exit(1 if problems else 0)

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="xsreport_"))
    try:
        for f in folder.iterdir():
            if f.suffix in (".tex", ".csv"):
                shutil.copy(f, tmp / f.name)
        r = subprocess.run([TECTONIC, "--keep-logs", "--chatter", "minimal", "main_preview.tex"], cwd=tmp,
                           capture_output=True, text=True, timeout=600)
        log = (tmp / "main_preview.log").read_text(errors="ignore") if (tmp / "main_preview.log").exists() else ""
        if r.returncode != 0 or not (tmp / "main_preview.pdf").exists():
            problems.append("tectonic failed:\n" + "\n".join((r.stdout + r.stderr).splitlines()[-25:]))
        for pat, what in [(r"^! ", "LaTeX error"), (r"undefined", "undefined reference or control sequence"),
                          (r"File `[^']+' not found", "missing file"), (r"Package siunitx Error", "siunitx error")]:
            for m in re.finditer(pat, log, re.M | re.I):
                problems.append(f"{what}: {log[m.start():m.start() + 120].splitlines()[0]}")
        if not problems:
            size = (tmp / "main_preview.pdf").stat().st_size
            print(f"PASS {texs[0].name}: main_preview.pdf compiled ({size / 1024:.0f} kB)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for p in problems:
        print("FAIL", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
