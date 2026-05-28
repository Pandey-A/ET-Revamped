import os
import redis
import boto3
from dotenv import load_dotenv

load_dotenv()

# Redis Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
META_VERIFY_TOKEN = os.getenv("META_VERIFY_TOKEN", "my_secure_webhook_token_123")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")


# AWS Configuration
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL", "")

def get_redis_client():
    return redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD if REDIS_PASSWORD else None,
        decode_responses=True
    )

def get_sqs_client():
    return boto3.client(
        'sqs',
        region_name=os.getenv("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
    )