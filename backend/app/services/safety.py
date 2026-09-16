"""Deterministic emergency / red-flag rules. Must NOT depend on an LLM."""

from __future__ import annotations

import re

from app.models.enums import Priority

# (rule_id, priority, label, compiled predicates on lowercased text)
_RULES: list[tuple[str, str, str, list[str]]] = [
    (
        "RF_CHEST_DYSPNEA",
        Priority.URGENT.value,
        "Severe chest pain with breathing difficulty",
        [r"chest pain|pressure in chest|squeezing chest", r"breath|dyspn|short(ness)? of breath|can't breathe|cannot breathe"],
    ),
    (
        "RF_STROKE",
        Priority.URGENT.value,
        "Stroke-like symptoms (face, arm, speech, sudden weakness)",
        [r"stroke|face droop|slurred speech|cannot speak|sudden weakness|one side"],
    ),
    (
        "RF_BLEEDING",
        Priority.URGENT.value,
        "Severe bleeding",
        [r"severe bleed|bleeding heavily|vomiting blood|coughing blood|hematemesis|hemoptysis"],
    ),
    (
        "RF_LOC",
        Priority.URGENT.value,
        "Loss of consciousness or unresponsiveness",
        [r"unconscious|passed out|lost consciousness|not responding|fainted and"],
    ),
    (
        "RF_ANAPHYLAXIS",
        Priority.URGENT.value,
        "Severe allergic reaction",
        [r"anaphylaxis|throat swell|lips swell|cannot swallow|severe allerg"],
    ),
    (
        "RF_SUICIDE",
        Priority.URGENT.value,
        "Self-harm or suicidal ideation",
        [r"suicid|kill myself|end my life|self harm|want to die"],
    ),
    (
        "RF_THUNDERCLAP",
        Priority.URGENT.value,
        "Thunderclap / worst-ever sudden headache",
        [r"worst headache|thunderclap|sudden severe headache|explosive headache"],
    ),
    (
        "RF_MENINGISM",
        Priority.HIGH.value,
        "Fever with neck stiffness or confusion — possible CNS infection",
        [r"neck stiff|stiff neck|photophobia|confused|confusion|seizure"],
    ),
    (
        "RF_ABDO_ACUTE",
        Priority.HIGH.value,
        "Acute abdomen warning signs",
        [r"rigid abdomen|board.?like|vomiting blood|black stool|severe abdominal"],
    ),
    (
        "RF_SEIZURE",
        Priority.HIGH.value,
        "Seizure activity",
        [r"seizure|fit |convulsion|jerking"],
    ),
]


def scan_text(text: str) -> list[dict]:
    blob = (text or "").lower()
    hits: list[dict] = []
    if not blob.strip():
        return hits
    for rule_id, priority, label, patterns in _RULES:
        if rule_id in {"RF_CHEST_DYSPNEA", "RF_MENINGISM"}:
            if all(re.search(p, blob) for p in patterns):
                hits.append({"ruleId": rule_id, "priority": priority, "label": label, "code": rule_id})
            continue
        if any(re.search(p, blob) for p in patterns):
            hits.append({"ruleId": rule_id, "priority": priority, "label": label, "code": rule_id})
    # Chest pain alone is HIGH, not URGENT, unless dyspnea also present
    if re.search(r"chest pain|pressure in chest", blob) and not any(h["ruleId"] == "RF_CHEST_DYSPNEA" for h in hits):
        hits.append(
            {
                "ruleId": "RF_CHEST_PAIN",
                "priority": Priority.HIGH.value,
                "label": "Chest pain — needs same-day clinical review",
                "code": "RF_CHEST_PAIN",
            }
        )
    return hits


def scan_answers(answers: dict) -> list[dict]:
    parts = []
    for key, val in (answers or {}).items():
        if val is None:
            continue
        if isinstance(val, dict):
            parts.append(str(val.get("value", "")))
        else:
            parts.append(f"{key} {val}")
    return scan_text(" ".join(parts))
