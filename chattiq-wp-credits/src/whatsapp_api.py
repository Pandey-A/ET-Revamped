import requests
from src.config import META_ACCESS_TOKEN

def send_whatsapp_message(business_phone_number_id: str, to_phone_number: str, text: str):
    """Sends a message using the dynamic Business ID extracted from the webhook."""
    url = f"https://graph.facebook.com/v19.0/{business_phone_number_id}/messages"
    
    headers = {
        "Authorization": f"Bearer {META_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone_number,
        "type": "text",
        "text": {"body": text}
    }
    
    response = requests.post(url, headers=headers, json=payload, timeout=10)
    response.raise_for_status()
    return response.json()


# def send_whatsapp_message(business_phone_number_id: str, to_phone_number: str, text: str):
#     print("\n" + "*" "="*48)
#     print(f"[MOCK WHATSAPP OUTBOUND]")
#     print(f"From Business ID: {business_phone_number_id}")
#     print(f"To Phone Number:  {to_phone_number}")
#     print(f"Bot says:         {text}")
#     print("="*50 + "\n")
    
#     # Return a dummy success JSON so the worker queue knows it "sent" successfully
#     return {"status": "mock_success"}