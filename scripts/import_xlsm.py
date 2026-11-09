#!/usr/bin/env python3
"""Convert the Excel School Management workbook (.xlsm) into the JSON seed the web app loads.

Usage:  python3 scripts/import_xlsm.py path/to/School_Management.xlsm [server/data/sample.json]
Needs:  pip install openpyxl
"""
import datetime as dt
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")


def iso(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return v or None


def txt(v):
    return "" if v is None else str(v).strip()


def num(v, default=0):
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def rows(ws, ncols):
    """DB sheets: row 3 = headers, data from row 4 (stops at the first blank ID)."""
    out = []
    for r in ws.iter_rows(min_row=4, max_col=ncols, values_only=True):
        if r[0] is None:
            continue
        out.append(list(r))
    return out


def col(ws, rng):
    return [c[0].value for c in ws[rng] if c[0].value not in (None, "")]


def table(ws, rng):
    return [[c.value for c in r] for r in ws[rng] if r[0].value not in (None, "")]


def main(src, dest):
    wb = openpyxl.load_workbook(src, data_only=True)
    adm, cal, com = wb["Admin"], wb["School Calendar"], wb["Communications"]

    settings = {
        "schoolName": txt(adm["E6"].value),
        "schoolAddress": txt(adm["E7"].value),
        "schoolContact": txt(adm["E8"].value),
        "currencySymbol": txt(adm["E9"].value) or "$",
        "currencyDecimals": int(num(adm["P37"].value)),
        "useFees": txt(adm["E10"].value) != "No",
        "lateCountsPresent": txt(adm["E11"].value) != "No",
        "riskAttendance": num(adm["E12"].value, 0.9) if num(adm["E12"].value, 0.9) <= 1 else num(adm["E12"].value) / 100,
        "riskDrop": num(adm["E13"].value, 5),
        "principal": txt(adm["E14"].value),
        "currentTerm": txt(adm["P36"].value),
        "sampleMode": txt(adm["P38"].value) == "Yes",
        "sampleAnchor": iso(adm["P39"].value),
        "grades": [{"name": txt(g), "tuition": num(t), "books": num(b)} for g, t, b in table(adm, "G6:I17")],
        "assessmentTypes": [{"name": txt(n), "weight": num(w)} for n, w in table(adm, "K6:L10")],
        "payMethods": [txt(v) for v in col(adm, "K13:K17")],
        "studentStatuses": [txt(v) for v in col(adm, "O6:O8")],
        "gradeBands": [{"band": txt(b), "from": num(f), "meaning": txt(m)} for b, f, m in table(adm, "G20:I25")],
        "optionalFees": [{"name": txt(n), "amount": num(a)} for n, a in table(adm, "G28:H37")],
        "subjects": [txt(v) for v in col(adm, "K20:K28")],
        "relationships": [txt(v) for v in col(adm, "D19:D26")],
        "genders": [txt(v) for v in col(adm, "D29:D31")],
        "streams": [txt(v) for v in col(adm, "D34:D37")],
        "terms": [{"name": txt(n), "start": iso(s), "end": iso(e), "feesDue": iso(d)} for n, s, e, d in table(cal, "F8:I11")],
        "holidays": [{"name": txt(r[0]), "type": txt(r[2]), "date": iso(r[3])} for r in table(cal, "F16:I25")],
        "keyDates": [{"label": txt(l), "date": iso(d)} for l, d in table(cal, "M8:N27")],
        "templates": {
            "absent": {"subject": txt(com["G7"].value), "body": txt(com["G8"].value)},
            "risk": {"subject": txt(com["L7"].value), "body": txt(com["L8"].value)},
            "report": {"subject": txt(com["G22"].value), "body": txt(com["G23"].value)},
            "fees": {"subject": txt(com["L22"].value), "body": txt(com["L23"].value)},
        },
    }

    data = {"settings": settings}
    data["students"] = [
        {"id": r[0], "learnerNo": txt(r[1]), "firstName": txt(r[2]), "lastName": txt(r[3]), "className": txt(r[4]),
         "dob": iso(r[5]), "gender": txt(r[6]), "status": txt(r[7]) or "Active", "enrolmentDate": iso(r[8]),
         "optionalFees": txt(r[9]), "guardianName": txt(r[10]), "relationship": txt(r[11]),
         "guardianPhone": txt(r[12]), "guardianEmail": txt(r[13]), "address": txt(r[14]),
         "medicalNote": txt(r[15]), "notes": txt(r[17])}
        for r in rows(wb["Students DB"], 18)]
    data["classes"] = [
        {"id": r[0], "name": txt(r[1]), "grade": txt(r[2]), "stream": txt(r[3]), "teacher": txt(r[4]),
         "room": txt(r[5]), "notes": txt(r[6])} for r in rows(wb["Classes DB"], 7)]
    data["teachers"] = [
        {"id": r[0], "name": txt(r[1]), "phone": txt(r[2]), "email": txt(r[3]), "subjects": txt(r[4]),
         "notes": txt(r[5])} for r in rows(wb["Teachers DB"], 6)]
    data["registers"] = [
        {"id": r[0], "date": iso(r[1]), "className": txt(r[2]), "takenBy": txt(r[3]),
         "present": int(num(r[4])), "enrolled": int(num(r[5]))} for r in rows(wb["Registers DB"], 6)]
    data["attendance"] = [
        {"id": r[0], "learnerId": r[1], "date": iso(r[2]), "className": txt(r[3]), "mark": txt(r[4]),
         "note": txt(r[5])} for r in rows(wb["Attendance DB"], 6)]
    data["assessments"] = [
        {"id": r[0], "term": txt(r[1]), "className": txt(r[2]), "subject": txt(r[3]), "name": txt(r[4]),
         "weight": num(r[5]), "outOf": num(r[6], 100) or 100, "date": iso(r[7])}
        for r in rows(wb["Assessments DB"], 8)]
    # marks are compact: [id, assessmentId, learnerId, mark]
    data["marks"] = [[r[0], r[1], r[2], r[3]] for r in rows(wb["Marks DB"], 4) if r[3] is not None]
    data["comments"] = [
        {"id": r[0], "learnerId": r[1], "term": txt(r[2]), "teacherComment": txt(r[3]),
         "principalComment": txt(r[4])} for r in rows(wb["Comments DB"], 5)]
    data["payments"] = [
        {"id": r[0], "studentId": r[1], "receiptNo": txt(r[2]), "date": iso(r[3]), "term": txt(r[4]),
         "amount": num(r[5]), "method": txt(r[6]), "reference": txt(r[7]), "paidBy": txt(r[8]), "note": txt(r[9])}
        for r in rows(wb["Payments DB"], 10)]
    data["paymentPlans"] = [
        {"id": r[0], "studentId": r[1], "term": txt(r[2]), "agreedOn": iso(r[3]), "instalment": num(r[4]),
         "nextDue": iso(r[5]), "note": txt(r[6])} for r in rows(wb["Payment Plans DB"], 7)]

    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", dest, {k: len(v) for k, v in data.items() if isinstance(v, list)})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "server/data/sample.json")
