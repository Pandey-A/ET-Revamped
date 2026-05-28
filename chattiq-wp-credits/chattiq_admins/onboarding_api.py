import uvicorn
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from src.redis_store import onboard_user_plan

app = FastAPI(title="Chattiq Onboarding API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supported plans mapping
PLANS_CREDITS = {
    "Basic": 2000,
    "Pro": 2000,
    "Enterprise": 0
}

@app.post("/onboard")
async def onboard_customer(payload: dict = Body(..., example={"user_id": "919876543210", "plan": "Pro"})):
    user_id = payload.get("user_id")
    plan = payload.get("plan")
    custom_credits = payload.get("custom_credits")
    
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    if not plan:
        raise HTTPException(status_code=400, detail="Missing plan")
        
    if plan not in PLANS_CREDITS:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid plan. Supported plans are: {list(PLANS_CREDITS.keys())}"
        )
        
    # Determine settings based on plan
    if plan == "Basic":
        credits_to_add = custom_credits if custom_credits is not None else 2000
        allow_overdraft = False
        overdraft_rate = 0
    elif plan == "Pro":
        credits_to_add = custom_credits if custom_credits is not None else 2000
        allow_overdraft = True
        overdraft_rate = 1
    elif plan == "Enterprise":
        # Enterprise brings customization (contact sales / customize)
        credits_to_add = custom_credits if custom_credits is not None else 0
        allow_overdraft = payload.get("allow_overdraft", True)
        overdraft_rate = payload.get("overdraft_rate", 1)
        
    try:
        updated_account = onboard_user_plan(
            user_id=user_id,
            plan=plan,
            credits_to_add=credits_to_add,
            allow_overdraft=allow_overdraft,
            overdraft_rate=overdraft_rate
        )
        return {
            "status": "success",
            "message": f"Successfully onboarded user {user_id} on {plan} plan.",
            "account": updated_account
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("chattiq_admins.onboarding_api:app", host="0.0.0.0", port=8003, reload=True)

