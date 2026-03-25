import os
from flask import Flask, jsonify, make_response, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'mock-audio'})


@app.route('/convert', methods=['POST'])
def convert_video_to_wav():
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify({'error': 'Missing file'}), 400

    mock_wav = uploaded.read()
    if not mock_wav:
        mock_wav = b'RIFFMOCKWAVE'

    response = make_response(mock_wav)
    response.headers['Content-Type'] = 'audio/wav'
    response.headers['Content-Disposition'] = 'inline; filename=audio.wav'
    return response


@app.route('/predict', methods=['POST'])
def predict_audio():
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify({'error': 'Missing file'}), 400

    segment_predictions = [
        {'prediction': 'Real', 'confidence': 0.81},
        {'prediction': 'Fake', 'confidence': 0.74},
        {'prediction': 'Fake', 'confidence': 0.69},
        {'prediction': 'Real', 'confidence': 0.77},
    ]
    fake_segments = sum(1 for seg in segment_predictions if seg['prediction'] == 'Fake')

    return jsonify(
        {
            'segment_count': len(segment_predictions),
            'fake_segments': fake_segments,
            'segment_predictions': segment_predictions,
        }
    )


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5010'))
    app.run(host='0.0.0.0', port=port, debug=True)
