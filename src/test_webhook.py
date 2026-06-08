import requests
import json
import time

# Your local FastAPI endpoint
URL = "http://localhost:8001/webhook"

# A dummy WhatsApp payload that matches what your producer.py expects
mock_payload = {
    "entry": [
        {
            "changes": [
                {
                    "value": {
                        "contacts": [
                            {"wa_id": "919876543210"} # Dummy phone number
                        ],
                        "messages": [
                            {
                                "id": f"wamid.mock.{int(time.time())}", # Unique ID
                                "type": "text",
                                "text": {"body": "what is the capital of india?"} # The message
                            }
                        ]
                    }
                }
            ]
        }
    ]
}

print(f"Sending mock message to {URL}...")
try:
    response = requests.post(URL, json=mock_payload, timeout=5)
    print(f"FastAPI Status Code: {response.status_code}")
    print(f"FastAPI Response: {response.json()}")
except Exception as e:
    print(f"Failed to connect to FastAPI: {e}")