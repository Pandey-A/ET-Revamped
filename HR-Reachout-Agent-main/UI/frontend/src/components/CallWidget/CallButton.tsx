import { Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CallButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export const CallButton = ({ isOpen, onClick }: CallButtonProps) => {
  return (
    <button
      id="call-button"
      onClick={onClick}
      className={cn(
        "w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300",
        "bg-darkblue-accent hover:bg-custom-red-600",
        "focus:outline-none focus:ring-2 focus:ring-custom-red-400 focus:ring-opacity-75",
        isOpen ? "rotate-90" : "rotate-0"
      )}
      aria-label={isOpen ? "Close call panel" : "Open call panel"}
    >
      {isOpen ? (
        <X className="w-6 h-6 text-white" />
      ) : (
        <Phone className="w-6 h-6 text-white" />
      )}
      <span className="sr-only">{isOpen ? "Close call panel" : "Open call panel"}</span>
    </button>
  );
};