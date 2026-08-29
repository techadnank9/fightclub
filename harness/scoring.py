"""Mechanical scoring. The formula (also goes in the PR body):

score = 60 * pass_rate + 25 * (1 - severity_penalty) + 15 * diff_economy

- pass_rate: fraction of the ORIGINAL test suite (from main) passing on the branch.
- severity_penalty: sum of finding weights (high 0.5, medium 0.25, low 0.1), capped at 1.
- diff_economy: 1 for a <=40-line diff, linearly down to 0 at >=400 lines.
"""

from __future__ import annotations

SEVERITY_WEIGHT = {"high": 0.5, "medium": 0.25, "low": 0.1}


def components(passed: int, total: int, findings: list[dict], diff_lines: int) -> dict:
    """The three weighted parts of the score, each already scaled to its cap."""
    pass_rate = (passed / total) if total else 0.0
    sev = min(1.0, sum(SEVERITY_WEIGHT.get(f.get("severity", "low"), 0.1) for f in findings))
    if diff_lines <= 40:
        economy = 1.0
    elif diff_lines >= 400:
        economy = 0.0
    else:
        economy = 1.0 - (diff_lines - 40) / 360
    return {
        "tests": round(60 * pass_rate, 1),
        "review": round(25 * (1 - sev), 1),
        "economy": round(15 * economy, 1),
        "passed": passed, "total": total,
        "findings": len(findings), "diffLines": diff_lines,
    }


def score(passed: int, total: int, findings: list[dict], diff_lines: int) -> int:
    pass_rate = (passed / total) if total else 0.0
    sev = min(1.0, sum(SEVERITY_WEIGHT.get(f.get("severity", "low"), 0.1) for f in findings))
    if diff_lines <= 40:
        economy = 1.0
    elif diff_lines >= 400:
        economy = 0.0
    else:
        economy = 1.0 - (diff_lines - 40) / 360
    return round(60 * pass_rate + 25 * (1 - sev) + 15 * economy)


def formula_text(passed: int, total: int, findings: list[dict], diff_lines: int) -> str:
    return (
        f"score = 60*({passed}/{total}) + 25*(1 - qodo_severity_penalty) + 15*diff_economy\n"
        f"findings: {len(findings)} ({', '.join(f.get('severity','?') for f in findings) or 'none'}), "
        f"diff: {diff_lines} lines"
    )
