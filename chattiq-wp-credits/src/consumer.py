import json
import time
import typing_extensions as typing
from src.config import get_sqs_client, SQS_QUEUE_URL
from src.redis_store import add_chat_message, summarize_chat_context, record_user_metric, deduct_user_charge, refund_user_charge
from src.whatsapp_api import send_whatsapp_message
from src.greetings import load_greetings, normalize_text, GREETINGS_MAP
from src.llm_client import call_llm_rag

# Worker Pipeline
def process_queue():
    sqs = get_sqs_client()
    load_greetings()
    print("Worker started. Listening for messages...")
    
    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL, 
                MaxNumberOfMessages=1, 
                WaitTimeSeconds=20
            )
            
            if 'Messages' not in response:
                continue 
                
            for message in response['Messages']:
                receipt_handle = message['ReceiptHandle']
                body = json.loads(message['Body'])
                
                user_id = body['user_id']
                phone_number = body['phone_number']
                query = body['query']
                business_phone_number_id = body.get('business_phone_number_id', '')
                
                # Record the query received
                record_user_metric(user_id, "total_queries_received")
                
                # THE GREETING BYPASS
                clean_query = normalize_text(query)
                if clean_query in GREETINGS_MAP:
                    bot_reply = GREETINGS_MAP[clean_query]
                    send_whatsapp_message(business_phone_number_id, phone_number, bot_reply)
                    record_user_metric(user_id, "total_greetings_bypassed")
                    sqs.delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle)
                    print(f"Handled free greeting for {phone_number}.")
                    continue 

                # THE ATOMIC LOCK
                charge_type = deduct_user_charge(user_id, 1)
                
                try:
                    # CALL LLM (Gemini or OpenAI)
                    context = summarize_chat_context(phone_number)
                    llm_result = call_llm_rag(context, query)
                    
                    is_answered = llm_result.get("is_answered", False)
                    ai_reply = llm_result.get("reply", "I encountered an issue.")

                    if is_answered:
                        send_whatsapp_message(business_phone_number_id, phone_number, ai_reply)
                        add_chat_message(phone_number, "user", query)
                        add_chat_message(phone_number, "assistant", ai_reply)
                        record_user_metric(user_id, "total_successful_replies")
                    else:
                        refund_user_charge(user_id, charge_type, 1)
                        record_user_metric(user_id, "total_failed_replies")
                        fallback_msg = "I couldn't find the answer to that in my knowledge base."
                        send_whatsapp_message(business_phone_number_id, phone_number, fallback_msg)

                    sqs.delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle)

                except Exception as e:
                    print(f"Error processing LLM: {e}")
                    refund_user_charge(user_id, charge_type, 1)
                    record_user_metric(user_id, "total_failed_replies")
                    
        except Exception as e:
            print(f"Critical Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    process_queue()