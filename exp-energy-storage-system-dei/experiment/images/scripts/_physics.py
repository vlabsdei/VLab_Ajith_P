#!/usr/bin/env python3
"""
Python port of the governing physics in simulation/js/main.js, used only to
compute exact numbers for theory.md worked examples and the diagram scripts
in this folder. This is NOT part of the simulator — it is a faithful,
line-by-line re-implementation of the same formulas/constants so the
diagrams and the worked-example tables in theory.md match the simulator's
real output rather than hand-rounded approximations.

Ported from (line numbers as of the authored main.js):
  cellOCV / cellIR                          (main.js ~236-248)
  motorRm                                   (main.js ~249)
  propAero                                  (main.js ~252-265)
  calcMotorPoint                            (main.js ~267-292)
  solveQuad                                 (main.js ~297-308)
  crateCalc / sagCalc / peukertFactor       (main.js ~389-462, ~2414-2418)
  socPoint                                  (main.js ~453-459)
  enduranceForCapacity                      (main.js ~423-440)
"""
import math

G = 9.80665
ALPHA_CU = 0.00393
T_AMB = 25.0
MU_AIR = 1.81e-5
RHO0 = 1.225


def rho_at(h):
    h = max(0.0, min(11000.0, h))
    return RHO0 * (1 - 2.25577e-5 * h) ** 4.25588


def cell_ocv(soc):
    soc = max(0.0, min(1.0, soc))
    return 3.50 + 0.70 * soc + 0.10 * soc ** 3


def cell_ir(p, soc):
    soc = max(0.02, min(1.0, 1.0 if soc is None else soc))
    base = p["cellIrBase"]
    swell = 1 + 0.25 * math.exp(5 * (0.3 - soc))
    return base * swell


def motor_rm(p, tempC):
    tempC = 20.0 if tempC is None else tempC
    return p["rm20"] * (1 + ALPHA_CU * (tempC - 20))


def prop_aero(p, omega, rho=RHO0):
    pd = max(0.2, min(1.2, p["pitchIn"] / max(p["diaIn"], 1)))
    R = p["D"] / 2
    chord = 0.1 * p["D"]
    Vtip = max(omega * R, 0.5)
    Re = max(rho * Vtip * chord / MU_AIR, 1000)
    re_factor = (150000 / Re) ** 0.25
    ct_static = p["ctRaw"] if p.get("ctRaw") is not None else 0.115 * pd
    cq_base = p["cqRaw"] if p.get("cqRaw") is not None else ct_static * (0.045 * re_factor + 0.11 * pd)
    Ji = math.sqrt(max(2 * ct_static / math.pi, 0))
    ct_eff = ct_static
    cq_eff = cq_base * (1 + 1.5 * Ji * Ji)
    return {"ctEff": ct_eff, "cqEff": cq_eff, "rho": rho, "Re": Re, "reFactor": re_factor,
            "ctStatic": ct_static, "cqStatic": cq_base, "Ji": Ji, "Vtip": Vtip}


def calc_motor_point(duty, V, Rm, Resc, p, rho=RHO0):
    if duty <= 0 or V <= 0:
        return {"rpm": 0, "omega": 0, "T": 0, "Q": 0, "I": 0, "P": 0, "Pmech": 0, "stalled": False}
    Reff = Rm + (Resc or 0)
    ke = 60 / (2 * math.pi * p["kv"])
    kt = ke
    omega = max(p["kv"] * V * duty * math.pi / 30 * 0.7, 15)
    stalled = False
    aero = prop_aero(p, omega, rho)
    for _ in range(12):
        aero = prop_aero(p, omega, rho)
        k = aero["cqEff"] * aero["rho"] * p["D"] ** 5 / (4 * math.pi ** 2)
        a = k
        b = kt * ke / Reff
        c = -(kt * V * duty / Reff - kt * p["i0"])
        disc = b * b - 4 * a * c
        if disc < 0 or a <= 0:
            stalled = True
            omega = 0
            break
        nxt = (-b + math.sqrt(disc)) / (2 * a)
        if not math.isfinite(nxt) or nxt < 0:
            stalled = True
            omega = 0
            break
        omega += (nxt - omega) * 0.6
    if stalled:
        return {"rpm": 0, "omega": 0, "T": 0, "Q": 0, "I": 0, "P": 0, "Pmech": 0, "stalled": True}
    n = omega / (2 * math.pi)
    T = aero["ctEff"] * aero["rho"] * n * n * p["D"] ** 4
    Q = aero["cqEff"] * aero["rho"] * n * n * p["D"] ** 5
    I = min(Q / kt + p["i0"], p["imax"] * 1.6)
    Vterm = max(V * duty - I * Reff, 0)
    P = Vterm * I + I * I * Reff
    Pmech = Q * omega
    return {"rpm": n * 60, "omega": omega, "T": max(T, 0), "Q": Q, "I": I, "P": P, "Pmech": Pmech,
            "stalled": False, "aero": aero}


def solve_quad(d, soc, p, rho=RHO0):
    s = 1.0 if soc is None else soc
    rIR = cell_ir(p, s)
    Rpack = p["cells"] * rIR
    V = cell_ocv(s) * p["cells"]
    r = calc_motor_point(d, V, motor_rm(p, 20), p["rdsOn"], p, rho)
    for _ in range(6):
        V = max(cell_ocv(s) * p["cells"] - 4 * r["I"] * Rpack, p["cells"] * 2.8)
        r = calc_motor_point(d, V, motor_rm(p, 20), p["rdsOn"], p, rho)
    return {"rpm": r["rpm"], "omega": r["omega"], "Tper": r["T"], "Ttot": 4 * r["T"],
            "Iper": r["I"], "Itot": 4 * r["I"], "V": V, "P": V * 4 * r["I"],
            "Pmech": 4 * r["Pmech"], "Q": r["Q"], "stalled": r["stalled"], "Rpack": Rpack}


def peukert_factor(cRatingCont):
    if cRatingCont >= 30:
        return 1.0
    if cRatingCont >= 20:
        return 0.90 + (cRatingCont - 20) * (1.0 - 0.90) / (30 - 20)
    if cRatingCont >= 12:
        return 0.72 + (cRatingCont - 12) * (0.90 - 0.72) / (20 - 12)
    return 0.70


def sock_point(vCell):
    lo, hi = 0.0, 1.0
    for _ in range(32):
        mid = (lo + hi) / 2
        if cell_ocv(mid) < vCell:
            lo = mid
        else:
            hi = mid
    true_soc = (lo + hi) / 2 * 100
    naive_soc = max(0.0, min(100.0, (vCell - 3.5) / (4.2 - 3.5) * 100))
    return {"vCell": vCell, "trueSoc": true_soc, "naiveSoc": naive_soc}


def make_params(kv, rm20, i0, imax, pmax, massMotor, diaIn, pitchIn, massProp,
                 cells, cap_mah, c_rating, c_rating_cont, cell_ir_mohm,
                 esc_current_a, rds_on_ohm, esc_max_cells=6, motor_max_cells=6):
    return {
        "kv": kv, "rm20": rm20, "i0": i0, "imax": imax, "pmax": pmax,
        "massMotor": massMotor, "D": diaIn * 0.0254, "diaIn": diaIn,
        "pitchIn": pitchIn, "massProp": massProp, "ctRaw": None, "cqRaw": None,
        "cells": cells, "cap": cap_mah, "cRating": c_rating, "cRatingCont": c_rating_cont,
        "cellIrBase": cell_ir_mohm / 1000.0,
        "escCurrentLimit": esc_current_a, "rdsOn": rds_on_ohm,
        "escMaxCells": esc_max_cells, "motorMaxCells": motor_max_cells,
    }


# ── Real catalog components used throughout theory.md worked examples ──
# Default build: 1806 motor / 5" tri-blade prop / 4S 3300 mAh pack / Cyclone 35A ESC / fpv5 chassis
MOTOR_1806 = dict(kv=2300, rm20=0.09, i0=0.6, imax=28, pmax=420, massMotor=19)
PROP_5IN = dict(diaIn=5.0, pitchIn=4.3, massProp=4.5)
ESC_CYCLONE35 = dict(esc_current_a=35, rds_on_ohm=0.0028)

BATT_4S3300 = dict(cells=4, cap_mah=3300, c_rating=25, c_rating_cont=15, cell_ir_mohm=6.5)   # default, modest cont-C
BATT_4S1300_LOWC = dict(cells=4, cap_mah=1300, c_rating=25, c_rating_cont=12, cell_ir_mohm=24.0)  # undersized/high-IR
BATT_4S1500_HIGHC = dict(cells=4, cap_mah=1500, c_rating=130, c_rating_cont=100, cell_ir_mohm=3.2)  # race-grade
BATT_6S5000 = dict(cells=6, cap_mah=5000, c_rating=30, c_rating_cont=22, cell_ir_mohm=6.0)


def params_with_battery(batt):
    return make_params(
        kv=MOTOR_1806["kv"], rm20=MOTOR_1806["rm20"], i0=MOTOR_1806["i0"],
        imax=MOTOR_1806["imax"], pmax=MOTOR_1806["pmax"], massMotor=MOTOR_1806["massMotor"],
        diaIn=PROP_5IN["diaIn"], pitchIn=PROP_5IN["pitchIn"], massProp=PROP_5IN["massProp"],
        cells=batt["cells"], cap_mah=batt["cap_mah"], c_rating=batt["c_rating"],
        c_rating_cont=batt["c_rating_cont"], cell_ir_mohm=batt["cell_ir_mohm"],
        esc_current_a=ESC_CYCLONE35["esc_current_a"], rds_on_ohm=ESC_CYCLONE35["rds_on_ohm"],
    )


if __name__ == "__main__":
    p = params_with_battery(BATT_4S3300)
    full = solve_quad(1.0, 1.0, p)
    print("Default build (1806 + 5in tri + 4S 3300mAh) full throttle, SoC=1:")
    print("  Itot=%.3f A  V=%.3f V  Ttot=%.3f N  rpm=%.0f" % (full["Itot"], full["V"], full["Ttot"], full["rpm"]))
