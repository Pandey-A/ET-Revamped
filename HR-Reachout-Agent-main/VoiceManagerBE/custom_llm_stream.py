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
# from AgentManager.shared_instances import get_query_handler
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
            llm, chat_ctx=chat_ctx, conn_options=conn_options, tools=[])
        # import CustomLLM here, as importing at the top results in circular dependency

        self.agent = agent
        self._model = model
        self._llm = llm
        self._user = user
        self._temperature = temperature
        self._n = n
        self._parallel_tool_calls = parallel_tool_calls
        self._tool_choice = tool_choice
        self.request_id = str(uuid.uuid4())

    async def _run(self) -> None:
        # current function call that we're waiting for full completion (args are streamed)
        # (defined inside the _run method to make sure the state is reset for each run/attempt)
        self._oai_stream: openai.AsyncStream[ChatCompletionChunk] | None = None
        self._tool_call_id: str | None = None
        self._fnc_name: str | None = None
        self._fnc_raw_arguments: str | None = None
        self._tool_index: int | None = None
        retryable = True

        try:
            chat_ctx = to_chat_ctx(self._chat_ctx, id(self._llm))
            fnc_ctx = to_fnc_ctx(self._tools) if self._tools else openai.NOT_GIVEN
            if lk_oai_debug:
                tool_choice = self._extra_kwargs.get("tool_choice", NOT_GIVEN)
                logger.debug(
                    "chat.completions.create",
                    extra={
                        "fnc_ctx": fnc_ctx,
                        "tool_choice": tool_choice,
                        "chat_ctx": chat_ctx,
                    },
                )

            self._oai_stream = stream = await self._client.chat.completions.create(
                messages=chat_ctx,
                tools=fnc_ctx,
                model=self._model,
                stream_options={"include_usage": True},
                stream=True,
                **self._extra_kwargs,
            )

            async with stream:
                async for chunk in stream:
                    for choice in chunk.choices:
                        chat_chunk = self._parse_choice(chunk.id, choice)
                        if chat_chunk is not None:
                            retryable = False
                            self._event_ch.send_nowait(chat_chunk)

                    if chunk.usage is not None:
                        retryable = False
                        tokens_details = chunk.usage.prompt_tokens_details
                        cached_tokens = tokens_details.cached_tokens if tokens_details else 0
                        chunk = llm.ChatChunk(
                            id=chunk.id,
                            usage=llm.CompletionUsage(
                                completion_tokens=chunk.usage.completion_tokens,
                                prompt_tokens=chunk.usage.prompt_tokens,
                                prompt_cached_tokens=cached_tokens or 0,
                                total_tokens=chunk.usage.total_tokens,
                            ),
                        )
                        self._event_ch.send_nowait(chunk)

        except openai.APITimeoutError:
            raise APITimeoutError(retryable=retryable) from None
        except openai.APIStatusError as e:
            raise APIStatusError(
                e.message,
                status_code=e.status_code,
                request_id=e.request_id,
                body=e.body,
                retryable=retryable,
            ) from None
        except Exception as e:
            raise APIConnectionError(retryable=retryable) from e

    async def _run(self) -> None:
        """Implementation of the abstract _run method"""
        try:

            # Get the latest message from chat context
            messages = self.chat_ctx.messages if hasattr(self.chat_ctx, 'messages') else []
            print(f"printing messages...............{messages}")
            last_message = messages[-1] if messages else None
            user_query = "No query provided"
            if last_message:
                for attr in ['content', 'message', 'text']:
                    if hasattr(last_message, attr):
                        user_query = getattr(last_message, attr)
                        break

            # Prepare API payload
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
            print(f"printing user query: {user_query}")
            payload = {
                "user_input":user_query,
                "session_id": "abc123"
            }

            headers = {
                "Content-Type": "application/json"
            }

            total_tokens = 0
            print("Before LLM Call")
            async with aiohttp.ClientSession() as session:
                async with session.post(
                        "https://b65c-2405-201-101b-482a-151e-6624-2510-d0fd.ngrok-free.app/api/chat/stream/voice",
                        json=payload,
                        headers=headers,
                ) as response:
                    if response.status != 200:
                        raise APIStatusError(
                            f"API returned status code {response.status}",
                            status_code=response.status,
                            request_id=self.request_id,
                            body=await response.text()
                        )

                    print(f"LLM response = _______________ {str(response)}")
                    async for line in response.content:
                        # logger.info("start iterating response content")
                        if line:
                            try:
                                decoded_line = line.decode('utf-8').strip()
                                # logger.info(f"decoded_line = _______________ {decoded_line}")
                                if decoded_line.startswith('data: '):
                                    data = json.loads(decoded_line[6:])
                                    if 'content' in data:
                                        content = data['content']
                                        total_tokens += len(content.split())
                                        chunk = llm.ChatChunk(
                                            id=self.request_id,
                                            delta=llm.ChoiceDelta(
                                                role="assistant",
                                                content=content,
                                            ),
                                        )
                                        # logger.info(f"chunk = _______________ {chunk}")
                                        self._event_ch.send_nowait(chunk)

                            except json.JSONDecodeError:
                                print(f"Failed to decode JSON from line: {decoded_line}")
                            except Exception as e:
                                print(f"Error processing stream chunk: {e}")
                                raise APIConnectionError(retryable=True) from e

            # Send final chunk with usage information
            final_chunk = ChatChunk(
                id=self.request_id,
                usage=CompletionUsage(
                    completion_tokens=total_tokens,
                    prompt_tokens=len(user_query.split()),
                    total_tokens=total_tokens + len(user_query.split())
                )
            )
            print(f"final_chunk = _______________ {final_chunk}")
            self._event_ch.send_nowait(final_chunk)

            # total_tokens = 0
            # query_handler = get_query_handler()
            # response = query_handler.process_query(user_query,"id_1234")
            #
            # async for delta in response:
            #
            #     total_tokens += len(delta.content.split())
            #     # Create a ChatChunk with the response content
            #     chunk = llm.ChatChunk(
            #         id=self.request_id,
            #         delta=llm.ChoiceDelta(
            #             role="assistant",
            #             content=delta.content,
            #         ),
            #     )
            #
            #     # logger.info(f"chunk = _______________ {chunk}")
            #     self._event_ch.send_nowait(chunk)


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
