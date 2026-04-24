
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export const ChatButton = ({ isOpen, onClick }: ChatButtonProps) => {
  return (
    <button
      id="chat-button"
      onClick={onClick}
      className={cn(
        "w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300",
        "bg-darkblue-accent hover:bg-custom-red-600",
        "focus:outline-none focus:ring-2 focus:ring-custom-red-400 focus:ring-opacity-75",
        isOpen ? "rotate-90" : "rotate-0"
      )}
      aria-label={isOpen ? "Close widget" : "Open widget"}
    >
      {isOpen ? (
        <X className="w-6 h-6 text-white" />
      ) : (
        <MessageCircle className="w-6 h-6 text-white" />
      )}
      <span className="sr-only">{isOpen ? "Close widget" : "Open widget"}</span>
    </button>
  );
};
