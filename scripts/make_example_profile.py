#!/usr/bin/env python3
"""Builds profiles/system-d-group10/profile.json and fixtures/boxfit_reference.json from the
34870 labs repo (Group 10, System D). Run once; the output is committed.

    python3 scripts/make_example_profile.py [path/to/34870-electroacoustics-labs]
"""
import json, math, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv) < 2:
    sys.exit(__doc__)
LABS = pathlib.Path(sys.argv[1])
CSV = HERE / "fixtures" / "csv"


def series(name, file, note=None):
    rows = [l.split(",") for l in (CSV / f"{name}.csv").read_text().splitlines()[1:] if l.strip()]
    s = {"f": [float(r[0]) for r in rows], "re": [float(r[1]) for r in rows], "im": [float(r[2]) for r in rows],
         "source": {"file": file, "format": "mat"}}
    if note:
        s["source"]["note"] = note
    return s


def main():
    tf = {"0": {}, "30": {}}
    for u, n in (("woof", "woofer"), ("mid", "midrange"), ("tw", "tweeter")):
        col = {"woof": 0, "mid": 1, "tw": 2}[u]
        for a, tag in (("0", "on"), ("30", "off30")):
            s = series(f"TF_{tag}_{n}", f"labE_system_{a}.mat")
            s["source"].update(freqVar="fn", dataVar="H", column=col, note="vent plugged")
            tf[a][u] = s
    vented = []
    for L in (160, 200, 240):
        vented.append({"vents": [{"id": "A", "length_m": L / 1000}],
                       "z": series(f"Z_vent_L{L}", f"labD_vent_L{L}.mat"),
                       "nf_cone": series(f"NF_cone_L{L}", f"labD_nf_cone_L{L}.mat"),
                       "nf_vent": series(f"NF_vent_L{L}", f"labD_nf_vent_L{L}.mat")})
    profile = {
        "version": 1, "id": "system-d-group10", "name": "System D · Group 10", "group": "Group 10", "system": "D",
        "notes": "34870 Electroacoustics 2026. Lab D (6 Oct) impedances and near field, Lab E (20 Oct) anechoic p/V, "
                 "vent plugged. Z uses R = 32.9 ohm and V_amp = 2*AI0. Vent B was never measured: its diameter is a guess.",
        "conditions": {"T_C": 20.0, "phase_ref_distance_m": -1.15, "mic_distance_m": 2.44},
        "units": {
            "woof": {"label": "Scan-Speak 26W/8534G00", "role": "woofer", "kind": "cone", "diameter_m": 0.211,
                     "frame_diameter_m": 0.256, "Re_ohm": 5.7},
            "mid": {"label": "DALI Spektor 2, 5¼″ low/mid", "role": "midrange", "kind": "cone", "diameter_m": 0.105,
                    "frame_diameter_m": 0.136, "Re_ohm": 4.6},
            "tw": {"label": "DALI Spektor 2, 25 mm soft dome", "role": "tweeter", "kind": "dome", "diameter_m": 0.025,
                   "frame_diameter_m": 0.072, "Re_ohm": 3.4},
        },
        "woofer_box": {"inner_m": [0.435, 0.45, 0.45], "wall_m": 0.018,
                       "vents": [{"id": "A", "diameter_m": 0.065, "length_range_m": [0.10, 0.30]},
                                 {"id": "B", "diameter_m": 0.050, "estimated": True, "length_range_m": [0.08, 0.30]}],
                       "driver_pos_m": [0.0, 0.29], "vent_pos_m": [[-0.13, 0.075], [0.13, 0.075]]},
        # Lab E layout: midrange 0.12 m left of and 0.29 m above the woofer centre
        "top_box": {"outer_m": [0.170, 0.290, 0.238], "offset_x_m": -0.12,
                    "mid_pos_m": [0.0, 0.29 + 0.29 - 0.486], "tw_pos_m": [0.0, 0.29 + 0.29 - 0.486 + 0.117]},
        "measurements": {
            "tf": tf,
            "zi": {"mid": series("Z_midrange", "labD_midrange.mat"), "tw": series("Z_tweeter", "labD_tweeter.mat")},
            "woofer": {"free": series("Z_woofer_free", "labD_woofer_free.mat"),
                       "closed": series("Z_woofer_closed", "labD_woofer_closed.mat"), "vented": vented},
        },
        "components": {
            "L": [0.15e-3, 0.18e-3, 0.22e-3, 0.33e-3, 0.39e-3, 0.47e-3, 0.56e-3, 0.68e-3, 0.82e-3, 1.0e-3, 1.2e-3,
                  1.5e-3, 1.8e-3, 2.2e-3],
            "C": [1.5e-6, 2.2e-6, 2.7e-6, 3.3e-6, 3.9e-6, 4.7e-6, 5.6e-6, 6.8e-6, 8.2e-6, 10e-6, 12e-6, 15e-6,
                  22e-6, 33e-6, 47e-6, 68e-6, 100e-6],
            "R": [1.0, 1.5, 2.2, 3.3, 4.7, 5.6, 6.8, 8.2, 10, 15, 22, 33, 47]},
        "limits": {"wm": [250, 600], "mt": [2200, 4000], "tw_fs_hz": 1450},
    }
    out = HERE / "profiles" / "system-d-group10" / "profile.json"
    out.write_text(json.dumps(profile, indent=1, ensure_ascii=False))
    print("wrote", out.relative_to(HERE), f"{out.stat().st_size / 1024:.0f} kB")

    # reference numbers from box_model.py, for the TypeScript box-fit port
    sys.path.insert(0, str(LABS / "Project" / "ltspice" / "task1"))
    import box_model as bm
    drv, RAB, QL, QP, MAP, err = bm.fit()
    t = bm.ts(drv, RAB)
    ref = {"T": bm.T, "c": bm.C0, "rho": bm.RHO, "RE": bm.RE, "SD": bm.SD, "AD": bm.AD, "VB": bm.VB, "AP": bm.AP,
           "drv": drv, "RAB": RAB, "QL": QL, "QP": QP, "MAP": [[L, m] for L, m in MAP.items()],
           "ts": {"fs": t["fs"], "Qms": t["Qms"], "Qes": t["Qes"], "Qts": 1 / (1 / t["Qms"] + 1 / t["Qes"]),
                  "Vas_L": t["Vas"] * 1e3, "Mms": t["Mms"]},
           "quality": {"driver": err["free"], "vents": err["vents"]},
           "note": "box_model.py fit(): driver from free+closed (8-150 Hz), vents from vent_L160/200/240 (5-150 Hz)."}
    (HERE / "fixtures" / "boxfit_reference.json").write_text(json.dumps(ref, indent=1))
    print("wrote fixtures/boxfit_reference.json")


if __name__ == "__main__":
    main()
