import requests

url = "http://127.0.0.1:5009/predict/video"

try:
    with open("downloads/test.mp4", "wb") as f:
        f.write(b"fake video content")
        
    print("Sending POST request...")
    # wait wait, I can just download a sample tiny video:
    # curl -o test.mp4 "https://www.w3schools.com/html/mov_bbb.mp4"
    pass
