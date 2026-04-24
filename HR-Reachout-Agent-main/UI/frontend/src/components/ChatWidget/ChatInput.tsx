import { useState, useRef, useEffect } from "react";
import { Send , Mic } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onMicClick: () => void;
  isEscalated: boolean ;
}

export const ChatInput = ({ onSendMessage , onMicClick , isEscalated }: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScroll, setShowScroll] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message);
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"; // reset height
        setShowScroll(false);
      }
    }
  };

  // Dynamically resize the textarea and toggle scrollbar visibility
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 6 * 24); // 6 lines max
      textarea.style.height = `${newHeight}px`;
      setShowScroll(textarea.scrollHeight > newHeight);
    }
  }, [message]);

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-darkblue-light p-3 flex items-center bg-darkblue-DEFAULT"
    >
      <div className="flex-grow">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message..."
          className={`w-full resize-none bg-darkblue-lighter border-darkblue-lighter border rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-darkblue-accent text-white text-sm leading-6 max-h-[144px] ${
            showScroll ? "overflow-y-auto" : "overflow-hidden"
          } custom-scrollbar`}
          rows={1}
          aria-label="Chat message"
        />
      </div>
      <button
        type="submit"
        className="ml-2 bg-darkblue-accent hover:bg-custom-red-600 text-white rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-custom-red-400"
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </button>
      <div
        title={isEscalated ? "Mic disabled - chat only during escalation" : "Start voice input"}
        className="ml-2"
      >
        <button
          type="button"
          onClick={onMicClick}
          disabled={isEscalated}
          className="bg-darkblue-accent hover:bg-custom-red-600 text-white rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-custom-red-400 disabled:cursor-not-allowed"
          aria-label="Voice input"
        >
          <Mic className="h-5 w-5" />
        </button>
      </div>

    </form>
  );
};
