import weaviate
import logging
logging.basicConfig(level=logging.DEBUG)
client = weaviate.connect_to_custom(http_host='13.200.189.83', http_port=8080, http_secure=False, grpc_host='13.200.189.83', grpc_port=50051, grpc_secure=False)
print("Ready:", client.is_ready())
try:
    collection = client.collections.create(name="TestTest")
except Exception:
    collection = client.collections.get("TestTest")
print("Inserting...")
try:
    collection.data.insert({"text": "Hello world" * 100})
    print("Success!")
except Exception as e:
    print("Error:", e)
