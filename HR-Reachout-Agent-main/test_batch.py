import weaviate
client = weaviate.connect_to_custom(http_host='13.200.189.83', http_port=8080, http_secure=False, grpc_host='13.200.189.83', grpc_port=50051, grpc_secure=False)
collection = client.collections.get("TestTest")
with collection.batch.dynamic() as batch:
    batch.add_object({"text": "Batch test 1"})
    batch.add_object({"text": "Batch test 2"})
if len(collection.batch.failed_objects) > 0:
    print("Batch failed:", collection.batch.failed_objects)
else:
    print("Batch success!")
