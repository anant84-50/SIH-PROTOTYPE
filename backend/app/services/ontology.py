"""Adaptive interview ontology. Pathways are complaints, never diagnoses."""

from app.models.enums import ComplaintPathway

SKIP_TOKENS = {
    "i don't know",
    "dont know",
    "don't know",
    "prefer not to answer",
    "skip",
    "unknown",
    "पता नहीं",
    "उत्तर नहीं देना",
    "தெரியாது",
    "சொல்ல விரும்பவில்லை",
    "জানি না",
    "উত্তর দিতে চাই না",
}

PATHWAYS = {
    ComplaintPathway.FEVER.value: {
        "label": "Fever",
        "opening": "We'll ask a few focused questions about the fever so the doctor has a clear picture. This is not a diagnosis.",
        "questions": [
            {"id": "duration", "field": "hpi", "text": "How many days have you had fever?", "type": "choice",
             "options": ["Less than 1 day", "1–3 days", "4–7 days", "More than 7 days"]},
            {"id": "pattern", "field": "hpi", "text": "Is the fever continuous, or does it come and go?", "type": "choice",
             "options": ["Continuous", "Comes and goes", "Only at night", "Not sure"]},
            {"id": "temperature", "field": "hpi", "text": "Have you measured temperature? If yes, what was the highest?", "type": "text"},
            {"id": "chills", "field": "reviewOfSystems", "text": "Are you having chills, shivering, or drenching sweats?", "type": "choice",
             "options": ["Chills / shivering", "Sweats", "Both", "Neither"]},
            {"id": "associated", "field": "reviewOfSystems", "text": "Any of these along with fever?", "type": "multi",
             "options": ["Headache", "Body ache", "Cough", "Sore throat", "Rash", "Burning urine", "Loose stools", "None"]},
            {"id": "red_cns", "field": "redFlags", "text": "Any neck stiffness, unusual confusion, or a seizure?", "type": "choice",
             "options": ["No", "Neck stiffness", "Confusion", "Seizure", "Prefer not to answer"]},
            {"id": "meds_taken", "field": "medications", "text": "What have you already taken for the fever?", "type": "text"},
            {"id": "travel", "field": "personalHistory", "text": "Any recent travel, mosquito bites, or known sick contacts?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What worries you most about this illness?", "type": "text"},
        ],
        "missing_if": {"duration": "duration of fever", "temperature": "measured temperature"},
    },
    ComplaintPathway.COUGH_COLD.value: {
        "label": "Cough / Cold",
        "opening": "A short set of questions about the cough or cold. Answers help the doctor, they are not a diagnosis.",
        "questions": [
            {"id": "duration", "field": "hpi", "text": "How long have you had the cough or cold?", "type": "choice",
             "options": ["Less than 3 days", "3–14 days", "2–8 weeks", "More than 8 weeks"]},
            {"id": "character", "field": "hpi", "text": "Is the cough dry or is there sputum?", "type": "choice",
             "options": ["Dry", "With sputum", "Both at times", "Mostly runny nose / sneezing"]},
            {"id": "sputum", "field": "hpi", "text": "If there is sputum, what colour is it?", "type": "choice",
             "options": ["No sputum", "Clear / white", "Yellow / green", "Blood-stained", "Not sure"]},
            {"id": "breathless", "field": "redFlags", "text": "Are you breathless at rest or after a few steps?", "type": "choice",
             "options": ["No", "On walking", "At rest", "Wheeze / chest tightness"]},
            {"id": "chest_pain", "field": "redFlags", "text": "Any chest pain, especially when you breathe in?", "type": "choice",
             "options": ["No", "Yes — with breathing", "Yes — pressure / tightness", "Prefer not to answer"]},
            {"id": "feverish", "field": "reviewOfSystems", "text": "Have you also had fever?", "type": "choice",
             "options": ["No", "Yes — low grade", "Yes — high", "Not measured"]},
            {"id": "smoking", "field": "personalHistory", "text": "Do you smoke, vape, or have workplace dust / smoke exposure?", "type": "text"},
            {"id": "meds_taken", "field": "medications", "text": "Any syrups, inhalers, or tablets already used?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What would you like the doctor to focus on?", "type": "text"},
        ],
        "missing_if": {"duration": "duration", "character": "dry vs productive cough"},
    },
    ComplaintPathway.HEADACHE.value: {
        "label": "Headache",
        "opening": "We'll characterise the headache. Sudden 'worst ever' pain is treated as urgent.",
        "questions": [
            {"id": "onset", "field": "hpi", "text": "How did the headache start?", "type": "choice",
             "options": ["Gradually over hours/days", "Over a few minutes", "Suddenly like a thunderclap", "After injury"]},
            {"id": "duration", "field": "hpi", "text": "How long has this episode lasted?", "type": "choice",
             "options": ["Minutes", "Hours", "1–3 days", "More than 3 days", "Recurring for weeks"]},
            {"id": "location", "field": "hpi", "text": "Where is the pain?", "type": "choice",
             "options": ["One side", "Both sides / band-like", "Forehead / eyes", "Back of head / neck", "Whole head"]},
            {"id": "severity", "field": "hpi", "text": "On a scale of 1–10, how severe is it now?", "type": "choice",
             "options": ["1–3 mild", "4–6 moderate", "7–8 severe", "9–10 worst ever"]},
            {"id": "associates", "field": "reviewOfSystems", "text": "Any of these with the headache?", "type": "multi",
             "options": ["Nausea / vomiting", "Light sensitivity", "Sound sensitivity", "Visual changes", "None"]},
            {"id": "neuro", "field": "redFlags", "text": "Any weakness, speech change, confusion, or neck stiffness?", "type": "choice",
             "options": ["No", "Weakness / numbness", "Speech change", "Confusion", "Neck stiffness"]},
            {"id": "history", "field": "pastMedicalHistory", "text": "Have you had similar headaches before, or a diagnosis like migraine?", "type": "text"},
            {"id": "meds_taken", "field": "medications", "text": "What pain medicines have you already taken?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What concerns you most about this headache?", "type": "text"},
        ],
        "missing_if": {"onset": "onset pattern", "severity": "severity"},
    },
    ComplaintPathway.ABDOMINAL_PAIN.value: {
        "label": "Abdominal pain",
        "opening": "Location, timing and associated symptoms help the doctor. Severe rigidity or bleeding is urgent.",
        "questions": [
            {"id": "location", "field": "hpi", "text": "Where is the pain most?", "type": "choice",
             "options": ["Upper middle", "Right upper", "Left upper", "Around navel", "Right lower", "Left lower", "All over"]},
            {"id": "onset", "field": "hpi", "text": "How did it start, and for how long?", "type": "choice",
             "options": ["Sudden, hours", "Gradual, hours", "1–3 days", "More than 3 days", "Recurring weeks"]},
            {"id": "character", "field": "hpi", "text": "What does the pain feel like?", "type": "choice",
             "options": ["Cramping", "Burning", "Sharp / stabbing", "Dull ache", "Colicky waves"]},
            {"id": "gi", "field": "reviewOfSystems", "text": "Any of these?", "type": "multi",
             "options": ["Vomiting", "Loose stools", "Constipation", "Blood in stool", "Black stool", "Fever", "None"]},
            {"id": "food", "field": "hpi", "text": "Relation to food?", "type": "choice",
             "options": ["Worse after meals", "Worse when hungry", "No relation", "Not sure"]},
            {"id": "red", "field": "redFlags", "text": "Is the abdomen very tender, rigid, or are you fainting?", "type": "choice",
             "options": ["No", "Very tender", "Rigid / board-like", "Fainting / collapse"]},
            {"id": "gyn", "field": "personalHistory", "text": "If relevant: any chance of pregnancy, or missed period?", "type": "text"},
            {"id": "meds_taken", "field": "medications", "text": "Antacids, painkillers or other medicines already taken?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What do you want the doctor to know first?", "type": "text"},
        ],
        "missing_if": {"location": "pain location", "onset": "duration / onset"},
    },
    ComplaintPathway.BODY_JOINT_PAIN.value: {
        "label": "Body / joint pain",
        "opening": "We'll map which joints and whether there is swelling, stiffness or trauma.",
        "questions": [
            {"id": "distribution", "field": "hpi", "text": "Where is the pain?", "type": "choice",
             "options": ["One joint", "A few joints", "Many joints", "Whole body / muscles", "Back / neck"]},
            {"id": "duration", "field": "hpi", "text": "For how long?", "type": "choice",
             "options": ["Hours–2 days", "3–14 days", "2–6 weeks", "More than 6 weeks"]},
            {"id": "swelling", "field": "hpi", "text": "Is any joint swollen, red, or hot?", "type": "choice",
             "options": ["No", "Swollen", "Red / hot", "Cannot bear weight"]},
            {"id": "stiffness", "field": "hpi", "text": "Morning stiffness lasting more than 30 minutes?", "type": "choice",
             "options": ["No", "Yes < 30 min", "Yes > 30 min", "Stiff all day"]},
            {"id": "trauma", "field": "hpi", "text": "Any fall, injury, or unusual exertion?", "type": "text"},
            {"id": "feverish", "field": "reviewOfSystems", "text": "Fever, rash, or recent infection?", "type": "choice",
             "options": ["None", "Fever", "Rash", "Recent infection", "Prefer not to answer"]},
            {"id": "pmh", "field": "pastMedicalHistory", "text": "Known arthritis, gout, thyroid or autoimmune illness?", "type": "text"},
            {"id": "meds_taken", "field": "medications", "text": "Painkillers or oils / home remedies already used?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What limits you most — sleep, walking, work?", "type": "text"},
        ],
        "missing_if": {"distribution": "joints involved", "duration": "duration"},
    },
    ComplaintPathway.OTHER.value: {
        "label": "Other concern",
        "opening": "Describe the problem in your own words — voice or text. We will only ask what is still missing.",
        "questions": [
            {"id": "free_text", "field": "chiefComplaint", "text": "In your own words, what is the main problem today?", "type": "text"},
            {"id": "duration", "field": "hpi", "text": "When did this start, and is it getting better or worse?", "type": "text"},
            {"id": "severity", "field": "hpi", "text": "How much is it affecting sleep, work or daily activity?", "type": "choice",
             "options": ["Mild", "Moderate", "Severe", "Cannot do daily activity"]},
            {"id": "associated", "field": "reviewOfSystems", "text": "Any fever, weight change, breathlessness, bleeding, or fainting?", "type": "text"},
            {"id": "pmh", "field": "pastMedicalHistory", "text": "Important past illnesses, surgeries or long-term medicines?", "type": "text"},
            {"id": "allergies", "field": "allergies", "text": "Any medicine or food allergies?", "type": "text"},
            {"id": "concerns", "field": "patientConcerns", "text": "What would you like the doctor to address first?", "type": "text"},
        ],
        "missing_if": {"free_text": "chief complaint", "duration": "duration"},
    },
}

COMMON_HISTORY = [
    {"id": "pmh_core", "field": "pastMedicalHistory", "text": "Any long-term illnesses — diabetes, BP, asthma, TB, heart, thyroid?", "type": "text"},
    {"id": "allergies_core", "field": "allergies", "text": "Known drug or food allergies? Write 'none' if none.", "type": "text"},
    {"id": "meds_core", "field": "medications", "text": "List current medicines (name and dose if known), or 'none'.", "type": "text"},
]


def pathway_def(code: str) -> dict:
    return PATHWAYS.get(code) or PATHWAYS[ComplaintPathway.OTHER.value]


def is_skip(answer: str) -> bool:
    return (answer or "").strip().lower() in SKIP_TOKENS
