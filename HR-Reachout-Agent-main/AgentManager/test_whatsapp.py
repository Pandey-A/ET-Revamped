import sys
import os

# Add the parent directory to sys.path so we can import AgentManager
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from AgentManager.whatsapp_handler import whatsapp_api

if __name__ == "__main__":
    print("Testing WhatsApp Cloud API...")
    # The config is already loaded in whatsapp_api from config.json
    lead_data = {
        "name": "Test User",
        "email": "test@example.com",
        "phone": "+919975555279",
        "summary": "This is a test message to initiate conversation.",
        "session_id": "test-session-123"
    }
    
    print(f"Sending notification to {whatsapp_api.admin_phone}...")
    result = whatsapp_api.send_lead_notification(lead_data)
    
    if result.get("status") == "success":
        print("✅ Message sent successfully!")
        print(f"Response: {result.get('response')}")
    else:
        print("❌ Failed to send message.")
        print(f"Error: {result.get('error')}")
