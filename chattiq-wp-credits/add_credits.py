from src.redis_store import deduct_user_credits, get_user_credits

test_number = "919876543210"

# Remember: deduct_user_credits with a NEGATIVE number adds credits!
deduct_user_credits(test_number, -10)

new_balance = get_user_credits(test_number)
print(f"Success! User {test_number} now has {new_balance} credits.")