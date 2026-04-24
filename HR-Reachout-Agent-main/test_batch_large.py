import weaviate
import random
client = weaviate.connect_to_custom(http_host='13.200.189.83', http_port=8080, http_secure=False, grpc_host='13.200.189.83', grpc_port=50051, grpc_secure=False)
collection = client.collections.get("TestTest")
with collection.batch.dynamic() as batch:
    for i in range(16):
        vector = [random.uniform(-1, 1) for _ in range(1536)]
        batch.add_object({"text": "A" * 2000}, vector=vector)
if len(collection.batch.failed_objects) > 0:
    print("Batch failed:", collection.batch.failed_objects)
else:
    print("Batch success!")
