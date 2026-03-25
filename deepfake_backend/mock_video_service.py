from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'mock-video'})


@app.route('/predict/video', methods=['POST'])
def predict_video():
    if 'file' not in request.files:
        return jsonify({'error': 'Missing file'}), 400

    segments = [
        {
            'Time Range (s)': '0-2',
            'lips Manipulation(%)': 17.8,
            'Face Manipulation(%)': 11.3,
        },
        {
            'Time Range (s)': '2-4',
            'lips Manipulation(%)': 21.2,
            'Face Manipulation(%)': 18.6,
        },
        {
            'Time Range (s)': '4-6',
            'lips Manipulation(%)': 36.1,
            'Face Manipulation(%)': 28.7,
        },
    ]

    return jsonify(
        {
            'overall_result': 'Fake (Mock)',
            'fake_clip_count': 1,
            'avg_lips': 25.0,
            'avg_face': 19.53,
            'segments': segments,
        }
    )


@app.route('/predict/image', methods=['POST'])
def predict_image():
    if 'file' not in request.files:
        return jsonify({'error': 'Missing file'}), 400

    uploaded = request.files['file']
    name = (uploaded.filename or '').lower()

    # Mock heuristic so output varies during local testing.
    if 'real' in name:
        prediction = 'Real'
        confidence = 0.86
    else:
        prediction = 'Fake'
        confidence = 0.79

    return jsonify(
        {
            'prediction': prediction,
            'confidence': confidence,
            'model': 'mock-image-detector-v1',
        }
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5009, debug=True)
