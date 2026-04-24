import requests

BASE_URL = "https://8543-115-98-233-91.ngrok-free.app/api"  # Change this if running on another host/port
# BASE_URL = "https://4ae2-115-98-233-106.ngrok-free.app/api"  # Change this if running on another host/port

def test_webpage_indexing():
    url = f"{BASE_URL}/index/url"
    payload = {
        "url": "https://support.boat-lifestyle.com/articles/popular-help-topics/exchanges/6242c50c9f565e24683a4953",
        "collection_name": "test_web_collection"
    }
    print("\n🔹 Testing Web Page Indexing...")
    response = requests.post(url, json=payload)
    print("Status Code:", response.status_code)
    print("Response:", response.json())


def test_pdf_indexing():
    url = f"{BASE_URL}/index/pdf"
    payload = {
        "pdf_url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        "collection_name": "test_pdf_collection"
    }
    print("\n🔹 Testing PDF Indexing...")
    response = requests.post(url, json=payload)
    print("Status Code:", response.status_code)
    print("Response:", response.json())


if __name__ == "__main__":
    test_webpage_indexing()
    test_pdf_indexing()
