import requests, json
res = requests.post('http://127.0.0.1:5003/deepfake-check', json={'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})
print(json.dumps(res.json(), indent=2))
