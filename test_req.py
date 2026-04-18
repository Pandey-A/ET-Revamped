import requests, json
res = requests.post('http://127.0.0.1:5003/deepfake-check', json={'url': 'https://www.youtube.com/shorts/L6JmF81Bq5E'})
print(json.dumps(res.json(), indent=2))
