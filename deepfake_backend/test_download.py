import os
import tempfile
import re
from flask import Flask, request, jsonify
from yt_dlp import YoutubeDL
from urllib.parse import urlparse

app = Flask(__name__)

# --- Detect platform from URL ---
def detect_platform(url):
    netloc = urlparse(url).netloc.lower()
    if "youtube.com" in netloc or "youtu.be" in netloc:
        return "youtube"
    elif "instagram.com" in netloc:
        return "instagram"
    elif "linkedin.com" in netloc:
        return "linkedin"
    else:
        return "unknown"

# --- Download video using yt-dlp ---
def download_video(url):
    platform = detect_platform(url)
    if platform == "unknown":
        raise ValueError("Unsupported platform")

    tmpdir = os.path.join(os.getcwd(), "downloads")
    os.makedirs(tmpdir, exist_ok=True)

    ydl_opts = {
        "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
        "format": "bv*+ba/best",
        "merge_output_format": "mp4",
        "quiet": True,
    }

    # Optional: Add cookies for Instagram/LinkedIn
    cookies_path = os.getenv("COOKIES_FILE")
    if platform in ["instagram", "linkedin"] and cookies_path:
        ydl_opts["cookiefile"] = cookies_path

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filepath = ydl.prepare_filename(info).replace(".webm", ".mp4")
        return filepath

# --- API Endpoint ---
@app.route("/api/test-download", methods=["POST"])
def test_download():
    data = request.get_json()
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        file_path = download_video(url)
        return jsonify({
            "message": "Download successful",
            "file_path": file_path,
            "platform": detect_platform(url)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Run Server ---
if __name__ == "__main__":
    app.run(port=5000, debug=True)
