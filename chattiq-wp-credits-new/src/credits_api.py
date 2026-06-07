import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from src.redis_store import get_user_billing_and_monitoring, get_token_usage_per_session

app = FastAPI(title="WhatsApp Credits API")

# Enable CORS to allow the frontend UI to make requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/credits")
async def get_credits(user_id: str = Query(..., description="The user's phone number or user ID")):
    try:
        return get_user_billing_and_monitoring(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tokens")
async def get_tokens(user_id: str = Query(..., description="The user's phone number or user ID")):
    try:
        return get_token_usage_per_session(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("src.credits_api:app", host="0.0.0.0", port=8002, reload=True)
