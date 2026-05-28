import csv
import string
import os

GREETINGS_MAP = {}

def normalize_text(text: str) -> str:
    text = text.translate(str.maketrans('', '', string.punctuation))
    return text.strip().lower()

def load_greetings(filepath=None):
    """Loads the CSV into a dictionary."""
    if filepath is None:
        candidates = [
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "GREETING_DATA.csv"),
            os.path.join(os.path.dirname(__file__), "GREETING_DATA.csv"),
            "GREETING_DATA.csv"
        ]
        for path in candidates:
            if os.path.exists(path):
                filepath = path
                break
        else:
            filepath = candidates[0] # Default fallback
            
    if not os.path.exists(filepath):
        print(f"Warning: No {filepath} found. Greeting bypass disabled.")
        return
        
    try:
        with open(filepath, mode='r', encoding='utf-8') as file:
            reader = csv.reader(file)
            
            # Skip the first row (the headers: Category, Greeting, Response)
            next(reader, None) 
            
            for row in reader:
                if len(row) >= 3:
                    clean_input = normalize_text(row[1]) 
                    bot_response = row[2].strip()
                    
                    GREETINGS_MAP[clean_input] = bot_response
                    
        print(f"Successfully loaded {len(GREETINGS_MAP)} greetings into memory.")
    except Exception as e:
        print(f"Error loading greetings CSV: {e}")