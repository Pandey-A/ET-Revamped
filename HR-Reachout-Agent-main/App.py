from AgentManager import query_handler
import chainlit as cl
import uuid
import asyncio
import logging

logging.info("Starting Application...")

@cl.on_chat_start
async def on_chat_start():
    session_id = str(uuid.uuid4())  # Generate session_id once per chat session
    cl.user_session.set("session_id", session_id)

@cl.on_message
async def on_message(message: cl.Message):
    session_id = cl.user_session.get("session_id")
    try:
        msg = cl.Message(content="", author="Assistant")
        await msg.send()

        user_input = message.content
        response = query_handler.process_query(user_input, session_id)

        full_response = ""
        for chunk in response:
            if chunk:
                await msg.stream_token(chunk)  # Stream
                full_response += chunk

        if full_response:
            msg.content = full_response
            await msg.send()
            task = await query_handler.post_process_query(user_query=user_input, assistant_response=full_response, session_id=session_id)
            # action_task = asyncio.create_task(
            #     query_handler.post_process_query(
            #         user_query=user_input,
            #         assistant_response=full_response, 
            #         session_id=session_id)
            # )
            # task = await action_task
            if isinstance(task['action_result'], dict) and "action_result" in task:
                action_result = task["action_result"]
                if action_result["success"] and action_result.get("jira_msg_success"):
                    issue_id = action_result["jira_issue_id"].id if hasattr(action_result["jira_issue_id"], "id") else action_result["jira_issue_id"]
                    await cl.Message(f"Thanks for reaching out. Your request has been registered with the ID **{issue_id}**. One of our human experts will be in touch with you shortly.").send()
            else:
                print("Unexpected task result:", task)
            return
        else:
            msg.content = "Some Error has occurred. Please try once again"
            await msg.send()

    except Exception as e:
        await cl.Message(content=f"Error: {e}", author="Assistant").send()
