import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  isOpen: boolean;
  messages: Array<{ content: string; isUser: boolean; type?: string ; agentType?: string; }>;
  onSendMessage: (content: string) => void;
  isTyping: boolean;
  isEscalated: boolean;
  onMicClick: () => void;
}

export const ChatPanel = ({ isOpen, messages, onSendMessage, isTyping , isEscalated, onMicClick }: ChatPanelProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const seenMessages = new Set();
  const deduplicatedMessages = messages.filter((m) => {
    const key = `${m.content}:${m.isUser}:${m.type ?? ""}`;
    if (seenMessages.has(key)) return false;
    seenMessages.add(key);
    return true;
  });


  return (
    <div
      className={cn(
        "absolute bottom-16 right-0 bg-white rounded-lg shadow-2xl min-w-[450px] sm:w-96 overflow-hidden",
        "transition-all duration-300 transform origin-bottom-right",
        "flex flex-col max-h-[525px]",
        isOpen
          ? "scale-100 opacity-100 pointer-events-auto"
          : "scale-95 opacity-0 pointer-events-none"
      )}
    >
      <div className="bg-darkblue-DEFAULT border-b border-darkblue-light p-4">
        <div className="flex items-center ml-4 space-x-5">
          <img
            src={
              isEscalated
                ? "https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576292/HumanIcon_hv6ix7.jpg"
                : "https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576066/AiIcon_v4f3iu.png"
            }
            alt={isEscalated ? "Human Agent" : "AI Assistant"}
            className="w-10 h-10 rounded-full"
          />
          <div>
            <h3 className="text-black font-black">
              {isEscalated ? "Human Agent" : "AI Assistant"}
            </h3>
            {!isEscalated && (
              <p className="text-xs text-gray-500 mt-1">
                AI Generated (Please check for Factual Correctness)
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 max-h-[300px] bg-darkblue-DEFAULT">
        {deduplicatedMessages.map((message, index) => (
          <ChatMessage
            key={index}
            content={message.content}
            isUser={message.isUser}
            type={message.type}
            agentType={message.agentType}
          />
        ))}

        {isTyping && (
          <div className="mb-2 flex justify-start">
            <div className="bg-darkblue-light text-white px-4 py-4 rounded-xl rounded-bl-none max-w-[80%] flex items-center space-x-2">
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      <ChatInput onSendMessage={onSendMessage} onMicClick={onMicClick} isEscalated={isEscalated} />
    </div>
  );
};

