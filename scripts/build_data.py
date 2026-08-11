#!/usr/bin/env python3
"""
Build the app's college dataset from the U.S. Department of Education
College Scorecard "Scorecard Elements" file (public domain).

Source (official): https://collegescorecard.ed.gov/data
Reads a local copy of the CSV (scripts/scorecard-raw.csv) and writes an
app-ready JSON to data/colleges.json.

Coverage: every currently-operating institution that predominantly grants an
associate, bachelor's, or graduate degree -- so no real college is missed.
"""
import csv
import json
import math
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "scorecard-raw.csv")
ADMIT = os.path.join(HERE, "admit.csv")
OUT = os.path.join(HERE, "..", "data", "colleges.json")


def load_admit():
    """UNITID -> {rate, sat25, sat75} from the full institution file
    (admission rate and SAT 25th/75th percentiles are not in the slim file)."""
    m = {}
    if not os.path.exists(ADMIT):
        return m
    with open(ADMIT, newline="") as fh:
        for r in csv.DictReader(fh):
            uid = r["UNITID"]
            rate = r.get("ADM_RATE", "")
            m[uid] = {
                "rate": round(float(rate) * 100) if rate not in ("", "NULL") else None,
                "sat25": int(r["SAT25"]) if r.get("SAT25") else None,
                "sat75": int(r["SAT75"]) if r.get("SAT75") else None,
            }
    return m

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands", "GU": "Guam",
    "AS": "American Samoa", "MP": "Northern Mariana Islands", "FM": "Micronesia",
    "MH": "Marshall Islands", "PW": "Palau",
}

REGIONS = {
    "Northeast": {"CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"},
    "Midwest": {"IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"},
    "South": {"DE", "FL", "GA", "MD", "NC", "SC", "VA", "DC", "WV", "AL", "KY",
              "MS", "TN", "AR", "LA", "OK", "TX"},
    "West": {"AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY", "AK", "CA", "HI",
             "OR", "WA"},
}


def region_for(state):
    for name, members in REGIONS.items():
        if state in members:
            return name
    return "Territories"


CIP = {
    "01": "Agriculture", "03": "Environmental Science", "04": "Architecture",
    "05": "Ethnic & Gender Studies", "09": "Communication & Journalism",
    "10": "Media & Communications Tech", "11": "Computer Science & IT",
    "12": "Culinary & Personal Services", "13": "Education",
    "14": "Engineering", "15": "Engineering Technology", "16": "Foreign Languages",
    "19": "Family & Consumer Sciences", "22": "Legal & Pre-Law", "23": "English",
    "24": "Liberal Arts & Humanities", "25": "Library Science", "26": "Biology",
    "27": "Mathematics & Statistics", "29": "Military Technologies",
    "30": "Interdisciplinary Studies", "31": "Parks, Recreation & Fitness",
    "38": "Philosophy & Religion", "39": "Theology & Religious Vocations",
    "40": "Physical Sciences (Chem/Physics)", "41": "Science Technologies",
    "42": "Psychology", "43": "Criminal Justice & Security",
    "44": "Public & Social Services", "45": "Social Sciences (Econ/Poli-Sci)",
    "46": "Construction Trades", "47": "Mechanic & Repair Tech",
    "48": "Precision Production", "49": "Transportation",
    "50": "Visual & Performing Arts", "51": "Health & Nursing",
    "52": "Business & Management", "54": "History",
}

CONTROL = {"1": "Public", "2": "Private nonprofit", "3": "For-profit"}
PREDDEG = {"2": "2-year", "3": "4-year", "4": "Graduate"}


def setting_for(locale):
    if not locale:
        return None
    try:
        code = int(float(locale))
    except ValueError:
        return None
    return {1: "City", 2: "Suburb", 3: "Town", 4: "Rural"}.get(code // 10)


def num(v):
    if v in ("", "NULL", "PrivacySuppressed", None):
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 4)
    except (ValueError, TypeError):
        return None


def pct(v):
    n = num(v)
    return None if n is None else round(n * 100)


def size_category(u):
    if u is None:
        return None
    if u < 1000:
        return "Very small (<1k)"
    if u < 3000:
        return "Small (1k–3k)"
    if u < 10000:
        return "Medium (3k–10k)"
    if u < 20000:
        return "Large (10k–20k)"
    return "Very large (20k+)"


def selectivity_for(sat):
    if sat is None:
        return "Test-optional / Open"
    if sat >= 1400:
        return "Most selective"
    if sat >= 1250:
        return "Highly selective"
    if sat >= 1100:
        return "Selective"
    return "Less selective"


def cost_tier(net):
    if net is None:
        return None
    if net < 10000:
        return "Under $10k/yr"
    if net < 20000:
        return "$10k–$20k/yr"
    if net < 35000:
        return "$20k–$35k/yr"
    return "$35k+/yr"


def offered_fields(row):
    """All CIP2 fields the school awards (PCIP share > 0)."""
    out = []
    for code, name in CIP.items():
        s = num(row.get("PCIP" + code, ""))
        if s and s > 0:
            out.append((s, name))
    out.sort(reverse=True)
    return out


def diversity_pct(row):
    keys = ["UGDS_WHITE", "UGDS_BLACK", "UGDS_HISP", "UGDS_ASIAN",
            "UGDS_AIAN", "UGDS_NHPI", "UGDS_2MOR"]
    shares = [num(row.get(k)) for k in keys]
    shares = [s for s in shares if s is not None]
    total = sum(shares)
    if total <= 0:
        return None, None
    shares = [s / total for s in shares]
    hhi = sum(s * s for s in shares)          # 1 = one group, ~0 = many equal
    index = 1 - hhi                            # higher = more diverse
    scaled = min(100, round(index / 0.72 * 100))
    # readable breakdown for the details view
    labels = ["White", "Black", "Hispanic", "Asian", "Native American",
              "Pacific Islander", "Two or more"]
    breakdown = sorted(
        [(labels[i], round(shares[i] * 100)) for i in range(len(shares))],
        key=lambda x: -x[1],
    )
    breakdown = [{"g": g, "p": p} for g, p in breakdown if p >= 1]
    return scaled, breakdown


def prominence(size, sat, ret, grad, earn, control):
    """Ordering score so both big state schools and small elite schools surface
    near the top, and obscure/for-profit ones sink. Not shown to users."""
    score = 0.0
    if size:
        score += math.log10(size + 1) * 10          # scale, not dominance
    if sat:
        score += (sat - 900) / 8
    if ret is not None:
        score += ret * 0.4
    if grad is not None:
        score += grad * 0.3
    if earn:
        score += earn / 2500
    if control == "For-profit":
        score -= 25
    return round(score, 2)


def build():
    with open(RAW, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    admit = load_admit()

    out = []
    for r in rows:
        if r.get("CURROPER") != "1":
            continue
        degree = PREDDEG.get(r.get("PREDDEG", ""))
        if degree is None:
            continue

        state = r.get("STABBR", "").strip()
        control = CONTROL.get(r.get("CONTROL", ""), "Other")
        size = num(r.get("UGDS"))
        sat = num(r.get("SAT_AVG"))
        net = num(r.get("NPT4_PUB")) or num(r.get("NPT4_PRIV"))
        earn = num(r.get("MD_EARN_WNE_P10"))
        gradF = num(r.get("C150_4_POOLED_SUPP"))
        grad = round(gradF * 100) if gradF is not None else None
        retention = pct(r.get("RET_FT4_POOLED_SUPP"))
        pell = pct(r.get("PCTPELL"))
        adult = pct(r.get("UG25ABV"))
        partTime = pct(r.get("PPTUG_EF"))
        div_pct, div_break = diversity_pct(r)

        url = (r.get("INSTURL") or "").strip()
        if url and not url.startswith("http"):
            url = "https://" + url

        fields = offered_fields(r)
        adm = admit.get(r.get("UNITID"), {})
        rec = {
            "id": r.get("UNITID"),
            "name": (r.get("INSTNM") or "").strip(),
            "city": r.get("CITY", "").strip(),
            "state": state,
            "stateName": STATE_NAMES.get(state, state),
            "region": region_for(state),
            "url": url,
            "control": control,
            "degree": degree,
            "size": size,
            "sizeCategory": size_category(size),
            "setting": setting_for(r.get("LOCALE", "")),
            "satAvg": sat,
            "sat25": adm.get("sat25"),
            "sat75": adm.get("sat75"),
            "admitRate": adm.get("rate"),
            "selectivity": selectivity_for(sat),
            "netPrice": net,
            "costTier": cost_tier(net),
            "gradRate": grad,
            "retention": retention,
            "earnings": earn,
            "pell": pell,
            "adultPct": adult,
            "partTimePct": partTime,
            "diversity": div_pct,
            "diversityBreakdown": div_break,
            "majors": [n for _, n in fields[:5]],       # top for display
            "fields": [n for _, n in fields],            # all offered, for filtering
            "flags": {
                "hbcu": r.get("HBCU") == "1",
                "hsi": r.get("HSI") == "1",
                "tribal": r.get("TRIBAL") == "1",
                "menOnly": r.get("MENONLY") == "1",
                "womenOnly": r.get("WOMENONLY") == "1",
                "religious": r.get("RELAFFIL") not in ("", "NULL", None, "-2"),
            },
            "_score": prominence(size, sat, retention, grad, earn, control),
        }
        out.append(rec)

    out.sort(key=lambda c: c["_score"], reverse=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(out)} colleges to {os.path.relpath(OUT)}")
    print("By degree:", dict(Counter(c["degree"] for c in out)))
    print("By control:", dict(Counter(c["control"] for c in out)))
    print("First 6:", [c["name"] for c in out[:6]])


if __name__ == "__main__":
    build()
