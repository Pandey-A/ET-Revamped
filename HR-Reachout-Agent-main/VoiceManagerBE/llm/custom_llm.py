from __future__ import annotations

from typing import Literal, Union

from livekit.agents import llm
from livekit.agents.llm import ToolChoice
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from . import CustomLLMStream

class CustomLLM(llm.LLM):
    def __init__(
            self,
            *,
            model: str = "default",
            api_key: str | None = None,
            base_url: str | None = None,
            user: str | None = None,
            temperature: float | None = None,
            parallel_tool_calls: bool | None = None,
            tool_choice: Union[ToolChoice, Literal["auto", "required", "none"]] = "auto",
            store: bool | None = None,
            metadata: dict[str, str] | None = None,
    ) -> None:
        """
        Create a new instance of Custom LLM.
        """
        super().__init__()
        self._capabilities = llm.LLMCapabilities(supports_choices_on_int=True)

        self._model = model
        self._user = user
        self._temperature = temperature
        self._parallel_tool_calls = parallel_tool_calls
        self._tool_choice = tool_choice
        self._store = store
        self._metadata = metadata
        self._running_fncs = set()

    # ToDo @rutvik below method highlighted in yellow. Indicating signature not matching to parent class' method
    def chat(
            self,
            *,
            agent,
            chat_ctx: llm.ChatContext,
            conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
            fnc_ctx: llm.FunctionContext | None = None,
            temperature: float | None = None,
            n: int | None = 1,
            parallel_tool_calls: bool | None = None,
            tool_choice: Union[ToolChoice, Literal["auto", "required", "none"]] | None = None,
    ) -> "CustomLLMStream":
        """Create and return CustomLLMStream"""

        if parallel_tool_calls is None:
            parallel_tool_calls = self._parallel_tool_calls

        if tool_choice is None:
            tool_choice = self._tool_choice

        if temperature is None:
            temperature = self._temperature

        return CustomLLMStream(
            self,
            agent=agent,
            model=self._model,
            user=self._user,
            chat_ctx=chat_ctx,
            fnc_ctx=fnc_ctx,
            conn_options=conn_options,
            n=n,
            temperature=temperature,
            parallel_tool_calls=parallel_tool_calls,
            tool_choice=tool_choice,
        )
