from crewai import Agent, Flow
from crewai.flow import ConversationConfig, ConversationState, RouterConfig, listen
from crewai_tools import ExaSearchTool

LLM_MODEL = "gpt-5.6-sol"

LANGUAGE_INSTRUCTION = "Always reply in the same language as the user's latest message."

# Simple guardrail: this assistant only searches the web and does nothing else.
SCOPE_INSTRUCTION = (
    "You are a web search assistant. Your ONLY capability is searching the web for "
    "information and answering based on what you find. Do not do anything else: no "
    "writing or debugging code, no math, no translations, no drafting or editing "
    "content, no role-play, no general advice or opinions. If the user asks what you "
    "can do, tell them you can only search the web for information. If the user asks "
    "for anything outside web search, politely decline in one sentence and invite "
    "them to ask you to look something up instead."
)


@ConversationConfig(
    llm=LLM_MODEL,
    # Applied to the built-in `converse` route too, so it obeys the same guardrail.
    system_prompt=SCOPE_INSTRUCTION + " " + LANGUAGE_INSTRUCTION,
    router=RouterConfig(
        routes=["search", "simple"],
        default_intent="simple",
        fallback_intent="simple",
    ),
    defer_trace_finalization=False,
)
class ConversationalRoutingFlow(Flow[ConversationState]):
    @listen("search")
    def handle_search(self) -> str:
        """Web search, current events, real-time info, or looking things up online."""
        history = "\n".join(
            f"{m['role']}: {m['content']}" for m in self.conversation_messages
        )
        agent = Agent(
            role="Web Search Assistant",
            goal="Answer using live web search and the full conversation history",
            backstory=(
                "You research the web with Exa to answer accurately. "
                + SCOPE_INSTRUCTION
                + " "
                + LANGUAGE_INSTRUCTION
            ),
            tools=[ExaSearchTool()],
            inject_date=True,
            llm=LLM_MODEL,
        )
        reply = agent.kickoff(
            f"Conversation so far:\n{history}\n\n"
            f"Answer the user's latest message by searching the web. "
            f"{SCOPE_INSTRUCTION} {LANGUAGE_INSTRUCTION}"
        ).raw
        self.append_assistant_message(reply)
        return reply

    @listen("simple")
    def handle_simple(self) -> str:
        """Capability questions, greetings, or anything that is not a web search request."""
        agent = Agent(
            role="Web Search Assistant",
            goal="Explain that you only search the web, and decline non-search requests",
            backstory=SCOPE_INSTRUCTION + " " + LANGUAGE_INSTRUCTION,
            inject_date=True,
            llm=LLM_MODEL,
        )
        reply = agent.kickoff(
            f"{self.state.current_user_message or ''}\n\n"
            f"{SCOPE_INSTRUCTION} {LANGUAGE_INSTRUCTION}"
        ).raw
        self.append_assistant_message(reply)
        return reply


def kickoff():
    ConversationalRoutingFlow().chat()


def plot():
    ConversationalRoutingFlow().plot()


if __name__ == "__main__":
    kickoff()
