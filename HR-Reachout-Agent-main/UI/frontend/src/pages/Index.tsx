
import { ChatWidget } from "../components/ChatWidget/ChatWidget";

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-custom-red-50 to-white">
      <div className="text-center max-w-2xl px-4">
        <h1 className="text-4xl font-bold text-custom-red-900 mb-6">Your Virtual Assistant</h1>
        <p className="text-xl text-custom-red-700 mb-8">
          Have a question? Click the chat button in the corner to start a conversation with our AI assistant.
        </p>
        <div className="flex justify-center">
          <a 
            href="#chat"
            onClick={(e) => {
              e.preventDefault();
              document.querySelector('#chat-button')?.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
              );
            }}
            className="px-6 py-3 bg-custom-red-500 text-white rounded-md hover:bg-custom-red-600 transition-colors"
          >
            Start Chatting
          </a>
        </div>
      </div>
      <ChatWidget />
    </div>
  );
};

export default Index;
