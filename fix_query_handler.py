import re

file_path = "/opt/deepfake_et_frontend/HR-Reachout-Agent-main/AgentManager/Query_handler.py"
with open(file_path, "r") as f:
    content = f.read()

# We need to replace the following lines in aprocess_query:
#             chat_history+= [ChatMessage(role="system", content=content)]
#             response = agent.stream_chat(user_input, chat_history)
#             print(f"printing response: {response.response_gen}")
#             return response.response_gen

pattern = r'chat_history\+= \[ChatMessage\(role="system", content=content\)\]\s*response = agent\.stream_chat\(user_input, chat_history\)\s*print\(f"printing response: \{response\.response_gen\}"\)\s*return response\.response_gen'

replacement = """chat_history+= [ChatMessage(role="system", content=content)]
            
            # Use synchronous chat in a thread to avoid Bedrock streaming issues
            def run_chat():
                return agent.chat(user_input, chat_history)
            
            response = await asyncio.to_thread(run_chat)
            
            async def mock_async_gen():
                yield str(response)
                
            return mock_async_gen()"""

new_content = re.sub(pattern, replacement, content)

with open(file_path, "w") as f:
    f.write(new_content)

print("Replaced successfully!")
