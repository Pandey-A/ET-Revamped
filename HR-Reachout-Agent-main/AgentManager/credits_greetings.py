"""Greeting bypass (no credit charge) — from GREETING_DATA.csv."""
import csv
import os
import string

GREETINGS_MAP: dict[str, str] = {}
_LANGUAGE_LABELS = {
    "english", "hindi", "punjabi", "tamil", "telugu", "kannada", "malayalam",
    "bengali", "gujarati", "marathi", "urdu", "assamese", "odia", "kashmiri",
    "sindhi", "french", "spanish", "german", "italian", "japanese", "chinese",
    "korean", "arabic", "turkish", "russian", "portuguese",
}


def normalize_text(text: str) -> str:
    text = text.translate(str.maketrans("", "", string.punctuation))
    return text.strip().lower()

def _valid_response(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    nt = normalize_text(t)
    # Guard against malformed rows like: Greeting=Hello, Response=English
    if nt in _LANGUAGE_LABELS:
        return False
    # Very short one-word labels are usually bad data in this file.
    if " " not in t and len(t) <= 10:
        return False
    return True


def load_greetings(filepath: str | None = None) -> None:
    global GREETINGS_MAP
    GREETINGS_MAP = {}
    if filepath is None:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [
            os.path.join(base, "data", "GREETING_DATA.csv"),
            os.path.join(base, "..", "chattiq-wp-credits", "GREETING_DATA.csv"),
            os.path.join(base, "GREETING_DATA.csv"),
        ]
        for path in candidates:
            if os.path.exists(path):
                filepath = path
                break
        else:
            filepath = candidates[0]

    if not os.path.exists(filepath):
        return

    try:
        with open(filepath, mode="r", encoding="utf-8") as file:
            dict_reader = csv.DictReader(file)
            if dict_reader.fieldnames and "Greeting" in dict_reader.fieldnames:
                for row in dict_reader:
                    clean_input = normalize_text(str(row.get("Greeting", "")))
                    bot_response = str(row.get("Chatbot Response", "")).strip()
                    if clean_input and _valid_response(bot_response):
                        GREETINGS_MAP[clean_input] = bot_response
            else:
                file.seek(0)
                reader = csv.reader(file)
                next(reader, None)
                for row in reader:
                    if len(row) >= 3:
                        clean_input = normalize_text(row[1])
                        bot_response = row[2].strip()
                        if clean_input and _valid_response(bot_response):
                            GREETINGS_MAP[clean_input] = bot_response
    except Exception:
        pass


def greeting_reply(user_text: str) -> str | None:
    if not GREETINGS_MAP:
        load_greetings()
    key = normalize_text(user_text or "")
    return GREETINGS_MAP.get(key)


load_greetings()
