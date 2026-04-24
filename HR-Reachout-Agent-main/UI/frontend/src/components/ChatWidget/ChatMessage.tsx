import { cn } from "@/lib/utils";
import React from "react";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  content: string;
  isUser: boolean;
  type?: string;
  agentType?: string;
}

export const ChatMessage = ({ content, isUser, type, agentType }: ChatMessageProps) => {
  const isHumanAgent = agentType === "system";
  const isAssistant = agentType === "assistant";

  const baseClass = cn(
    "mb-3 w-fit min-w-[40%] max-w-[80%] rounded-2xl p-3 text-sm animate-fade-in",
    isUser
      ? "ml-auto bg-darkblue-accent text-white rounded-br-none"
      : isHumanAgent
        ? "mr-auto bg-white text-gray-800 border border-gray-400 rounded-bl-none"
        : "mr-auto bg-darkblue-lighter text-gray-100 rounded-bl-none"
  );

  const escalationClass = cn(
    type === "escalation-jira" &&
      "bg-yellow-200 text-yellow-900 border-l-4 border-yellow-500",
    type === "escalation-telegram" &&
      "bg-green-200 text-green-900 border-l-4 border-green-500"
  );

  const avatar = isHumanAgent ? (
    <img
      src="https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576292/HumanIcon_hv6ix7.jpg"
      className="w-6 h-6 rounded-full border"
      alt="Human Agent"
  />
  ) : (
    <img
      src="https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576066/AiIcon_v4f3iu.png"
      className="w-6 h-6 rounded-full border my-auto"
      alt="AI Assistant"
  />
  );

  return (
    <div className={cn("flex items-start space-x-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <div className="shrink-0 mt-3">{avatar}</div>}
      <div className={cn(baseClass, escalationClass)}>
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="mb-2">{children}</p>,
            a: ({ href, children }) => (
              <a
                href={href ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-custom-red-400 underline hover:text-custom-red-300 transition-all duration-200"
              >
                {children}
              </a>
            ),
            ul: ({ children }) => <ul className="list-disc ml-6 mb-2">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal ml-6 mb-2">{children}</ol>,
            li: ({ children }) => <li className="mb-1">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            h3: ({ children }) => <h3 className="font-bold text-lg mt-2 mb-1">{children}</h3>,
            h2: ({ children }) => <h2 className="font-bold text-xl mt-2 mb-2">{children}</h2>,
            h1: ({ children }) => <h1 className="font-bold text-2xl mt-2 mb-2">{children}</h1>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 mb-2">
                {children}
              </blockquote>
            ),
            // Add more overrides as needed
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {isUser && null}
    </div>
  );
};
