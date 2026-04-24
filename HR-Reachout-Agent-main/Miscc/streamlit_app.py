import streamlit as st
import uuid
import asyncio
import base64
import logging
from AgentManager import chat_history_handler, query_handler

# Configure logging
logging.basicConfig(level=logging.INFO)

# Set page configuration
st.set_page_config(
    page_title="Customer Support AI Agent",
    page_icon="🤖"
)

# Initialize session state
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "escalated" not in st.session_state:
    st.session_state.escalated = False
if "messages" not in st.session_state:
    st.session_state.messages = []
if "history_refresh" not in st.session_state:
    st.session_state.history_refresh = 0

# Custom CSS
st.markdown("""
    <style>
    .fixed-title {
        position: fixed;
        top: 30px;
        padding: 25px;
        left: 0;
        z-index: 999;
        display: flex;
        justify-content: center;
        width: 100%;
        background-color: white;
    }
    .footer {
        position: fixed;
        left: 0;
        bottom: 0;
        width: 100%;
        color: black;
        text-align: center;
        padding: 10px;
        font-size: 12px;
        z-index: 999;
        color: gray;
    }
    .logo {
        height: 50px;
        width: auto;
    }
    .whatsapp-logo {
        height: 30px;
        width: auto;
    }
    .history-message {
        margin: 10px 0;
        padding: 10px;
        background-color: #f8f9fa;
        border-radius: 5px;
    }
    </style>
""", unsafe_allow_html=True)

# Static title and footer
st.markdown("""<div class="fixed-title"><img class="logo" src="https://elevatetrust.ai/assets/images/demo/modern-agency/logo.png"></img></div>""", unsafe_allow_html=True)
st.markdown("""<div class="footer"><h5>Made by ElevateTrust.Ai</h5></div>""", unsafe_allow_html=True)

# Load and convert image to base64
def get_base64_image(image_path):
    try:
        with open(image_path, "rb") as img_file:
            b64 = base64.b64encode(img_file.read()).decode()
        return f"data:image/png;base64,{b64}"
    except Exception as e:
        logging.error(f"Error loading image: {str(e)}")
        return ""

# Add watermark
image_b64 = get_base64_image("Resource/Ai-Agent-logog.avif")
if image_b64:
    st.markdown(
        f"""
        <style>
        .watermark {{
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0.1;
            z-index: 0;
            pointer-events: none;
        }}
        </style>
        <img src="{image_b64}" class="watermark" width="300">
        """,
        unsafe_allow_html=True
    )

async def main():
    logging.info("Starting Streamlit app...")

    with st.sidebar:
        st.header("WhatsApp Chat History")
        
        # Refresh button
        if st.button("Refresh History"):
            st.session_state.history_refresh += 1
            try:
                chat_history_handler.reload_whatsapp_history()
                logging.info(f"History refresh triggered for session {st.session_state.session_id}")
            except Exception as e:
                logging.error(f"Error refreshing WhatsApp history: {str(e)}")
                st.error("Failed to refresh history. Please try again.")

        # Display history
        try:
            selected_session_id = st.session_state.session_id
            chat_history_handler.reload_whatsapp_history()
            selected_history = chat_history_handler.get_whatsapp_history(selected_session_id)
            
            if selected_history:
                for msg in selected_history:
                    if hasattr(msg, 'role') and hasattr(msg, 'content'):
                        role = msg.role.capitalize()
                        content = msg.content
                        st.markdown(
                            f'<div class="history-message"><strong>{role}:</strong> {content}</div>',
                            unsafe_allow_html=True
                        )
                        logging.info(f"Displaying WhatsApp history message: Role: {msg.role}, Content: {msg.content}")
            else:
                logging.info(f"No WhatsApp messages found for session {selected_session_id}")
                st.markdown(
                    '<div class="history-message">No WhatsApp messages for this session.</div>',
                    unsafe_allow_html=True
                )
        except Exception as e:
            logging.error(f"Error in WhatsApp history display: {str(e)}")
            st.error("Failed to load WhatsApp history. Please try again.")

    # Display chat messages
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    # Accept user input
    if prompt := st.chat_input("How can I help you?"):
        # Reset escalation state for new interaction
        st.session_state.escalated = False
        
        # Add user message to chat history
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        # Process assistant response
        with st.chat_message("assistant"):
            session_id = st.session_state.session_id
            try:
                response = query_handler.process_query(prompt, session_id)
                
                full_response = "" 
                response = st.write_stream(response)
                for chunk in response:
                    if chunk:
                        full_response += chunk
                # full_response = st.write_stream(stream_with_clean)
                
                if full_response:
                    st.session_state.messages.append({"role": "assistant", "content": full_response})
                    
                    # Post-process query
                    task = await query_handler.post_process_query(
                        user_query=prompt,
                        assistant_response=full_response,
                        session_id=session_id
                    )
                    
                    # Debug log the task value
                    logging.info(f"Post-process task result: {task}")
                    
                    # Handle task results with robust type checking
                    if isinstance(task, dict) and "action_result" in task:
                        action_result = task["action_result"]
                        if isinstance(action_result, dict):
                            if action_result.get("jira_msg_success"):
                                issue_id = action_result["jira_issue_id"].id if hasattr(action_result["jira_issue_id"], "id") else action_result["jira_issue_id"]
                                register_msg = f"Thanks for reaching out. Your Query has been registered with the ID **{issue_id}**. One of our human experts will be in touch with you shortly."
                                st.session_state.messages.append({"role": "assistant", "content": register_msg})
                                st.session_state.escalated = True
                                st.info(register_msg)
                            elif action_result.get("whatsapp_msg_success"):
                                register_msg = "Thanks for reaching out. Your request has been registered. One of our human experts will be in touch with you shortly."
                                st.session_state.messages.append({"role": "assistant", "content": register_msg})
                                st.session_state.escalated = True
                                st.info(register_msg)
                        elif isinstance(action_result, bool):
                            logging.warning(f"action_result is a boolean ({action_result}), no action taken")
                        else:
                            logging.error(f"action_result is not a dictionary or boolean: {action_result}")
                            st.error("Unexpected response format from post-processing. Please try again.")
                    else:
                        logging.error(f"Task is not a dictionary or missing 'action_result': {task}")
                        st.error("Failed to process the response. Please try again.")
                else:
                    st.error("No response received. Please try again.")
            except Exception as e:
                logging.error(f"Error processing query: {str(e)}")
                st.error(f"Error: {str(e)}")

if __name__ == "__main__":
    asyncio.run(main())