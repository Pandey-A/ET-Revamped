import os
import requests
from flask import Flask, request, jsonify
from yt_dlp import YoutubeDL
from urllib.parse import urlparse
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

VIDEO_API_URL = os.getenv("VIDEO_API_URL", "http://103.22.140.216:5009/predict/video")
AUDIO_CONVERT_URL = os.getenv("AUDIO_CONVERT_URL", "http://127.0.0.1:5000/convert")
AUDIO_PREDICT_URL = os.getenv("AUDIO_PREDICT_URL", "http://127.0.0.1:5000/predict")

def detect_platform(url):
    netloc = urlparse(url).netloc.lower()
    if "youtube" in netloc or "youtu.be" in netloc:
        return "youtube"
    elif "instagram.com" in netloc:
        return "instagram"
    elif "linkedin.com" in netloc:
        return "linkedin"
    return "unknown"

def download_video(url):
    platform = detect_platform(url)
    if platform == "unknown":
        raise ValueError("Unsupported platform")

    output_dir = os.path.join(os.getcwd(), "downloads")
    os.makedirs(output_dir, exist_ok=True)

    ydl_opts = {
        "outtmpl": os.path.join(output_dir, "%(id)s.%(ext)s"),
        "format": "bv*+ba/best",
        "merge_output_format": "mp4",
        "quiet": True,
    }

    cookies_file = os.getenv("COOKIES_FILE")
    if platform in ["instagram", "linkedin"] and cookies_file:
        ydl_opts["cookiefile"] = cookies_file

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filepath = ydl.prepare_filename(info).replace(".webm", ".mp4")
        return filepath

@app.route("/deepfake-check", methods=["POST"])
def deepfake_check():
    data = request.get_json()
    url = data.get("url")
    if not url:
        return jsonify({"error": "Missing video URL"}), 400

    try:
        video_path = download_video(url)
        print(f"[✓] Downloaded video: {video_path}")
    except Exception as e:
        return jsonify({"error": f"Download failed: {str(e)}"}), 500

    try:
        # Step 1: Complete Video and Audio Analysis via the main API
        with open(video_path, "rb") as f:
            analysis_response = requests.post(VIDEO_API_URL, files={"video": f})
        
        if analysis_response.status_code != 200:
            raise RuntimeError(analysis_response.text)
            
        analysis_result = analysis_response.json()
        print(f"[✓] Analysis complete.")
        
    except Exception as e:
        return jsonify({"error": f"Analysis failed: {str(e)}"}), 500

    return jsonify(analysis_result)

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
