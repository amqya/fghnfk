#!/usr/bin/env python3
"""
Build the app's college dataset from the U.S. Department of Education
College Scorecard "Scorecard Elements" file (public domain).

Source (official): https://collegescorecard.ed.gov/data
This script reads a local copy of the CSV (scripts/scorecard-raw.csv) and
writes a slim, app-ready JSON to data/colleges.json.

Coverage goal: every currently-operating, degree-granting U.S. institution
so that no real college is missed. Trade/certificate-only schools
(predominant credential = certificate) are excluded to keep the deck about
actual colleges and universities; everything that grants an associate,
bachelor's, or graduate degree is kept.
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "scorecard-raw.csv")
OUT = os.path.join(HERE, "..", "data", "colleges.json")

# ---- lookups -------------------------------------------------------------

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


# CIP 2-digit code -> human field name (for "top majors")
CIP = {
    "01": "Agriculture", "03": "Natural Resources & Environment",
    "04": "Architecture", "05": "Area, Ethnic & Gender Studies",
    "09": "Communication & Journalism", "10": "Communications Technology",
    "11": "Computer Science", "12": "Culinary & Personal Services",
    "13": "Education", "14": "Engineering", "15": "Engineering Technology",
    "16": "Foreign Languages", "19": "Family & Consumer Sciences",
    "22": "Legal Studies", "23": "English", "24": "Liberal Arts & Humanities",
    "25": "Library Science", "26": "Biology", "27": "Mathematics",
    "29": "Military Technologies", "30": "Interdisciplinary Studies",
    "31": "Parks, Recreation & Fitness", "38": "Philosophy & Religion",
    "39": "Theology & Religious Vocations", "40": "Physical Sciences",
    "41": "Science Technologies", "42": "Psychology",
    "43": "Criminal Justice & Security", "44": "Public Administration",
    "45": "Social Sciences", "46": "Construction Trades",
    "47": "Mechanic & Repair Technologies", "48": "Precision Production",
    "49": "Transportation", "50": "Visual & Performing Arts",
    "51": "Health & Nursing", "52": "Business & Management", "54": "History",
}

CONTROL = {"1": "Public", "2": "Private nonprofit", "3": "For-profit"}

# Predominant degree awarded
PREDDEG = {"2": "2-year", "3": "4-year", "4": "Graduate"}


def setting_for(locale):
    """LOCALE code -> broad setting."""
    if not locale:
        return None
    try:
        code = int(float(locale))
    except ValueError:
        return None
    tens = code // 10
    return {1: "City", 2: "Suburb", 3: "Town", 4: "Rural"}.get(tens)


def num(v):
    if v in ("", "NULL", "PrivacySuppressed", None):
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 4)
    except (ValueError, TypeError):
        return None


def size_category(ugds):
    if ugds is None:
        return None
    if ugds < 1000:
        return "Very small (<1k)"
    if ugds < 3000:
        return "Small (1k–3k)"
    if ugds < 10000:
        return "Medium (3k–10k)"
    if ugds < 20000:
        return "Large (10k–20k)"
    return "Very large (20k+)"


def selectivity_for(sat_avg):
    if sat_avg is None:
        return "Test-optional / Open"
    if sat_avg >= 1400:
        return "Most selective"
    if sat_avg >= 1250:
        return "Highly selective"
    if sat_avg >= 1100:
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


def top_majors(row):
    pairs = []
    for code, name in CIP.items():
        share = num(row.get("PCIP" + code, ""))
        if share and share > 0:
            pairs.append((share, name))
    pairs.sort(reverse=True)
    return [name for _, name in pairs[:4]]


def title_case_name(name):
    # Scorecard names are already mixed-case; leave as-is.
    return name.strip()


def build():
    with open(RAW, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)

    out = []
    for r in rows:
        if r.get("CURROPER") != "1":
            continue  # skip closed institutions
        preddeg = PREDDEG.get(r.get("PREDDEG", ""))
        if preddeg is None:
            continue  # skip certificate-only / unclassified (keeps it about colleges)

        state = r.get("STABBR", "").strip()
        ugds = num(r.get("UGDS"))
        sat = num(r.get("SAT_AVG"))
        net = num(r.get("NPT4_PUB")) or num(r.get("NPT4_PRIV"))
        earn = num(r.get("MD_EARN_WNE_P10"))
        grad = num(r.get("C150_4_POOLED_SUPP"))
        url = (r.get("INSTURL") or "").strip()
        if url and not url.startswith("http"):
            url = "https://" + url

        rec = {
            "id": r.get("UNITID"),
            "name": title_case_name(r.get("INSTNM", "")),
            "city": r.get("CITY", "").strip(),
            "state": state,
            "stateName": STATE_NAMES.get(state, state),
            "region": region_for(state),
            "url": url,
            "control": CONTROL.get(r.get("CONTROL", ""), "Other"),
            "degree": preddeg,
            "size": ugds,
            "sizeCategory": size_category(ugds),
            "setting": setting_for(r.get("LOCALE", "")),
            "satAvg": sat,
            "selectivity": selectivity_for(sat),
            "netPrice": net,
            "costTier": cost_tier(net),
            "gradRate": round(grad * 100) if grad is not None else None,
            "earnings": earn,
            "majors": top_majors(r),
            "flags": {
                "hbcu": r.get("HBCU") == "1",
                "hsi": r.get("HSI") == "1",
                "tribal": r.get("TRIBAL") == "1",
                "menOnly": r.get("MENONLY") == "1",
                "womenOnly": r.get("WOMENONLY") == "1",
                "religious": r.get("RELAFFIL") not in ("", "NULL", None, "-2"),
            },
        }
        out.append(rec)

    # Friendly default ordering so the deck opens with recognizable schools:
    # non-profit before for-profit, 4-year before 2-year, then larger first.
    # Every college is still present -- this only affects starting order.
    deg_rank = {"4-year": 0, "Graduate": 1, "2-year": 2}
    out.sort(key=lambda c: (
        1 if c["control"] == "For-profit" else 0,
        deg_rank.get(c["degree"], 3),
        -(c["size"] or 0),
    ))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(out)} colleges to {os.path.relpath(OUT)}")
    # quick coverage summary
    from collections import Counter
    print("By degree:", dict(Counter(c["degree"] for c in out)))
    print("By control:", dict(Counter(c["control"] for c in out)))
    print("States covered:", len({c["state"] for c in out}))


if __name__ == "__main__":
    build()
