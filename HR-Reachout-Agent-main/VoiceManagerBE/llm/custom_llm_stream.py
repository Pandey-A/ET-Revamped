from __future__ import annotations

import json
import os
import uuid
from typing import Literal, Union, final

import aiohttp
from livekit.agents import llm, APIConnectionError, APIStatusError
from livekit.agents.llm import ToolChoice, ChatChunk, ChoiceDelta, CompletionUsage
# from livekit.agents.llm import ToolChoice, ChatChunk
# from livekit.agents.pipeline.pipeline_agent import VoicePipelineAgent
from AgentManager import query_handler
from livekit.agents.types import APIConnectOptions

class CustomLLMStream(llm.LLMStream):
    def __init__(
            self,
            llm,
            *,
            agent,
            model: str,
            user: str | None,
            chat_ctx: llm.ChatContext,
            conn_options: APIConnectOptions,
            fnc_ctx: llm.FunctionContext | None,
            temperature: float | None,
            n: int | None,
            parallel_tool_calls: bool | None,
            tool_choice: Union[ToolChoice, Literal["auto", "required", "none"]],
    ) -> None:
        super().__init__(
            llm, chat_ctx=chat_ctx, fnc_ctx=fnc_ctx, conn_options=conn_options
        )
        # import CustomLLM here, as importing at the top results in circular dependency
        from VoiceManagerBE.llm.custom_llm import CustomLLM
        self.agent = agent
        self._model = model
        self._llm: CustomLLM = llm
        self._user = user
        self._temperature = temperature
        self._n = n
        self._parallel_tool_calls = parallel_tool_calls
        self._tool_choice = tool_choice
        self.request_id = str(uuid.uuid4())

    async def _run(self) -> None:
        """Implementation of the abstract _run method"""
        try:

            # Get the latest message from chat context
            messages = self.chat_ctx.messages if hasattr(self.chat_ctx, 'messages') else []
            last_message = messages[-1] if messages else None
            user_query = "No query provided"
            if last_message:
                for attr in ['content', 'message', 'text']:
                    if hasattr(last_message, attr):
                        user_query = getattr(last_message, attr)
                        break

            # # Prepare API payload
            # payload = {
            #     "client": "web_widget",
            #     "client_id": client_details['client_id'],
            #     "conversation_id": client_details['conversation_id'],
            #     "is_source_required": False,
            #     "tweaks": client_details['tweaks'],
            #     "user_attributes": client_details['user_attributes'],
            #     "query": user_query,
            #     "type": "message",
            #     "is_trace_enabled": False,
            #     "output_type": client_details['output_type'],
            # }
            #
            # headers = {
            #     'x-api-key': client_details['x-api-key'],
            #     'stram': 'true',
            #     'Content-Type': 'application/json'
            # }
            #
            # total_tokens = 0
            # logger.info("Before LLM Call")
            # async with aiohttp.ClientSession() as session:
            #     async with session.post(
            #             self.spotinfo_backend_url + 'api/v1/sse/conversations',
            #             json=payload,
            #             headers=headers,
            #     ) as response:
            #         if response.status != 200:
            #             raise APIStatusError(
            #                 f"API returned status code {response.status}",
            #                 status_code=response.status,
            #                 request_id=self.request_id,
            #                 body=await response.text()
            #             )
            #
            #         logger.info(f"LLM response = _______________ {str(response)}")
            #         async for line in response.content:
            #             # logger.info("start iterating response content")
            #             if line:
            #                 try:
            #                     decoded_line = line.decode('utf-8').strip()
            #                     # logger.info(f"decoded_line = _______________ {decoded_line}")
            #                     if decoded_line.startswith('data: '):
            #                         data = json.loads(decoded_line[6:])
            #                         if 'content' in data:
            #                             content = data['content']
            #                             total_tokens += len(content.split())
            #
            #                             # Create a ChatChunk with the response content
            #                             chunk = ChatChunk(
            #                                 request_id=self.request_id,
            #                                 choices=[
            #                                     Choice(
            #                                         delta=ChoiceDelta(
            #                                             role="assistant",
            #                                             content=content
            #                                         ),
            #                                         index=0
            #                                     )
            #                                 ]
            #                             )
            #                             # logger.info(f"chunk = _______________ {chunk}")
            #                             self._event_ch.send_nowait(chunk)
            #
            #                 except json.JSONDecodeError:
            #                     logger.warning(f"Failed to decode JSON from line: {decoded_line}")
            #                 except Exception as e:
            #                     logger.error(f"Error processing stream chunk: {e}")
            #                     raise APIConnectionError(retryable=True) from e
            #
            # # Send final chunk with usage information
            # final_chunk = ChatChunk(
            #     request_id=self.request_id,
            #     choices=[],
            #     usage=CompletionUsage(
            #         completion_tokens=total_tokens,
            #         prompt_tokens=len(user_query.split()),
            #         total_tokens=total_tokens + len(user_query.split())
            #     )
            # )
            # logger.info(f"final_chunk = _______________ {final_chunk}")
            # self._event_ch.send_nowait(final_chunk)

            total_tokens = 0

            response = query_handler.process_query(user_query,"id_1234")

            async for delta in response:

                total_tokens += len(delta.content.split())
                # Create a ChatChunk with the response content
                chunk = llm.ChatChunk(
                    id=self.request_id,
                    delta=llm.ChoiceDelta(
                        role="assistant",
                        content=delta.content,
                    ),
                )

                # logger.info(f"chunk = _______________ {chunk}")
                self._event_ch.send_nowait(chunk)

            final_chunk = ChatChunk(
                request_id=self.request_id,
                choices=[],
                usage=CompletionUsage(
                    completion_tokens=total_tokens,
                    prompt_tokens=len(user_query.split()),
                    total_tokens=total_tokens + len(user_query.split())
                )
            )

            self._event_ch.send_nowait(final_chunk)

        except Exception as e:
            print(f"Error in CustomLLMStream: {e}")
            raise

    def _generate_dummy_response(self, query: str) -> str:
        """
        Generate a dummy response for testing purposes.
        """
        return f"This is a simulated response to your query about '{query}'. " \
               f"In a real implementation, this would be generated by your custom LLM logic."

    async def embeddings(self, text: str) -> list[float]:
        """
        Generate embeddings for the given text.
        This is a dummy implementation that returns a fixed-size vector.
        """
        return [0.1] * 10  # Return dummy embeddings

    def emit_event(self, event_name: str, data: any) -> None:
        """
        Emit an event with data
        Args:
            event_name: Name of the event
            data: Event data (must be JSON serializable)
        """
        try:
            if hasattr(self, 'on') and callable(getattr(self, 'on')):
                # Convert dictionary to a tuple of items for hashability
                if isinstance(data, dict):
                    data = tuple(sorted(data.items()))
                self.on(event_name, data)

        except Exception as e:
            pass

    def get_metrics(self) -> dict:
        """
        Return collected metrics
        """
        return self.metrics
