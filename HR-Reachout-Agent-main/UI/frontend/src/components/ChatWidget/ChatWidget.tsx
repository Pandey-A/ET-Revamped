import { useEffect, useRef, useState } from "react";
import { ChatButton } from "./ChatButton";
import { ChatPanel } from "./ChatPanel";
import { CallPanel } from "../CallWidget/CallPanel";
import { toast } from "@/hooks/use-toast";
import { ArrowRight } from "lucide-react";

type Message = {
  content: string;
  isUser: boolean;
  type?: "escalation-jira" | "escalation-whatsapp" | "escalation-telegram";
  agentType?: string ;
};

export const ChatWidget = () => {
  const [isTyping, setIsTyping] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { content: "Hi there! How can I assist you today?", isUser: false },
  ]);

  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [isEscalated, setIsEscalated] = useState(false);
  const [agentName, setAgentName] = useState("AI Assistant");

  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agent_id") || "default-agent";

  console.log("i am received agent id from bg",{agentId})

  const ws = useRef<WebSocket | null>(null);

  const toggleChat = () => setIsOpen(!isOpen);
  const toggleCall = () => setIsCallOpen((prev) => !prev);

  const [showEscalationModal, setShowEscalationModal] = useState(false);

  const getSessionId = () => {
    let sessionId = sessionStorage.getItem("session_id");
    if (!sessionId) {
      sessionId = `session_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID()}`;
      console.log("Generated new session ID:", sessionId);
      sessionStorage.setItem("session_id", sessionId);
    }
    return sessionId;
  };

  const sessionId = getSessionId();

useEffect(() => {
  fetch(`${import.meta.env.VITE_BACKEND_URL}/chat/is_escalated/${sessionId}`)
    .then(res => res.json())
    .then(data => {
      if (data.escalated) {
        setIsEscalated(true);
        console.log(data);
        setAgentName("Human Agent");
      }
    });
}, [sessionId]);


  useEffect(() => {
  const fetchHistory = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/chat/history/${sessionId}`);
      const data = await res.json();
      console.log("WebSocket on user received message:", data);

      if (Array.isArray(data.messages)) {
        const formatted = data.messages.map((msg: any) => ({
          content: msg.message || msg.content,
          isUser: msg.agent_name === "User", 
          agentType: msg.agent_name?.toLowerCase() ,
        }));
        setMessages((prev) => [...prev, ...formatted]);
      }
    } catch (err) {
      console.error("Failed to load conversation history", err);
    }
  };

  fetchHistory();
}, [sessionId , isOpen]);


useEffect(() => {
  if (!sessionId) return;

  let retryTimeout: NodeJS.Timeout;
  let isUnmounted = false;

  const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    // const wsUrl = `${protocol}://${host}/api/ws?session_id=${sessionId}`;
    const wsUrl = `${import.meta.env.VITE_BACKEND_URL}/ws?session_id=${sessionId}`;

    console.log(" Connecting WebSocket to:", wsUrl);
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      console.log(" WebSocket connected");
    };

    socket.onmessage = async (event) => {
      if (event.data === "ping") return;

      try {
        const data = JSON.parse(event.data);
        console.log(" USER WS MESSAGE RECEIVED:", data);

        // Match session
        if (data.session_id === sessionId) {
          
          // If escalation, don't add to messages — just toggle panels
          if (data.escalated === true) {
            console.log(" Escalation detected via WebSocket");

            await new Promise((resolve) => setTimeout(resolve, 2000));
            
            // alert("You've been connected to a human support agent. Further communication will continue here in the chat.")
            setShowEscalationModal(true); 
            // Panel switching logic only
            setIsCallOpen(false);
            setIsOpen(true);
            setIsEscalated(true);
            setAgentName("Human Agent");
            
            return; // Skip rendering message in chat
          }

          const isUser = data.agent_name?.toLowerCase() === "user" ||
                        data.agent_name?.toLowerCase() === "human_agent";
          setMessages((prev) => [
            ...prev,
            {
              content: data.message,
              isUser,
              agentType: data.agent_name?.toLowerCase() ,
            },
          ]);
        }
      } catch (err) {
        console.error(" Error parsing WebSocket message", err);
      }
    };


    socket.onerror = (err) => {
      console.error(" WebSocket error:", err);
      socket.close(); 
    };

    socket.onclose = () => {
      console.warn(" WebSocket connection closed");

      // Attempt to reconnect after delay
      if (!isUnmounted) {
        retryTimeout = setTimeout(() => {
          console.log(" Reconnecting WebSocket...");
          connectWebSocket();
        }, 5000);
      }
    };
  };

  connectWebSocket();

  return () => {
    isUnmounted = true;
    clearTimeout(retryTimeout);
    ws.current?.close();
  };
}, [sessionId]);


const streamMessage = async (content: string) => {
  if (!content.trim()) return;
  setMessages((prev) => [...prev, { content, isUser: true, agentType: "user" }]);

  try {
    if (isEscalated) {
      await fetch(`${import.meta.env.VITE_BACKEND_URL}/tickets/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message: content,
          agent_name: "user",
          agent_id: agentId
        }),
      });

      // toast({
      //   title: "Message sent to Human Agent",
      //   description: "Waiting for response...",
      // });
      return;
    }

    setIsTyping(true);

    const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/chat/stream/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_input: content, session_id: sessionId, agent_id: agentId }),
    });

    if (!response.ok || !response.body) throw new Error("Streaming failed");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let assistantResponse = "";
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      assistantResponse += chunk;

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];

        if (!firstChunk && last && !last.isUser) {
          updated[updated.length - 1] = {
            ...last,
            content: last.content + chunk,
          };
        } else {
          updated.push({ content: chunk, isUser: false, agentType: "assistant" });
        }

        return updated;
      });

      if (firstChunk) {
        firstChunk = false;
        setIsTyping(false);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));    // dealy of 800ms

    console.log("📤 analyze_action payload:", {
      user_input: content,
      assistantResponse,
      sessionId
    });

    const retryAnalyze = async (attempts = 2) => {
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/chat/analyze_action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_input: content,
              assistant_response: assistantResponse,
              session_id: sessionId,
              agent_id: agentId
            }),
          });
          if (!res.ok) throw new Error("Retrying analyze_action...");
          return await res.json();
        } catch (err) {
          if (i === attempts - 1) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    let parsedResponse;
    try {
      parsedResponse = await retryAnalyze();
    } catch (err) {
      console.error("analyze_action failed after retries:", err);
      toast({ title: "Error analyzing message", description: "There was an internal error during conversation" });
      return;
    }

    console.log("analyze_action returned:", parsedResponse);
    const { action_result } = parsedResponse;

    if (action_result?.jira_msg_success) {
      const escalationMsg = `We've forwarded your issue to our human support team. Please wait while an agent connects with you shortly.`;
      setMessages((prev) => [...prev, { content: escalationMsg, isUser: false, type: "escalation-jira" , agentType: "assistant" }]);
      setIsEscalated(true);
      setAgentName(parsedResponse.agent_name || "Human Agent");

      await saveEscalationToHistory(escalationMsg);
    } else if (action_result?.telegram_msg_success) {
      const escalationMsg = `You've been connected to a human support agent on Telegram. They'll continue this conversation shortly.`;
      setMessages((prev) => [...prev, { content: escalationMsg, isUser: false, type: "escalation-telegram" , agentType: "assistant" }]);
      setIsEscalated(true);
      setAgentName(parsedResponse.agent_name || "Human Agent");

      await saveEscalationToHistory(escalationMsg);
    } else if (action_result?.whatsapp_msg_success) {
      const escalationMsg = `We've notified our support team on WhatsApp. They'll reach out shortly.`;
      setMessages((prev) => [...prev, { content: escalationMsg, isUser: false, type: "escalation-whatsapp" , agentType: "assistant" }]);
    }

    // toast({ title: "Message sent", description: "AI responded successfully" });
  } catch (error) {
    console.error("Error:", error);
    toast({
      title: "Error",
      description: "There was an internal error during conversation",
      variant: "destructive",
    });
  } finally {
    setIsTyping(false);
  }
};

// helper
const saveEscalationToHistory = async (escalationMsg: string) => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const retrySave = async (attempts = 2) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/chat/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            agent_name: "assistant",
            message: escalationMsg,
            agent_id: agentId
          }),
        });
        if (!res.ok) throw new Error("Retrying save...");
        return;
      } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  try {
    await retrySave();
  } catch (err) {
    console.error("chat/save failed after retries:", err);
    toast({
      title: "Warning",
      description: "There was an internal error during coversation",
      variant: "destructive",
    });
  }
};




  return (
    <div className="fixed bottom-10 right-10 z-50 space-y-5">
      <ChatButton
        isOpen={isOpen || isCallOpen}
        onClick={() => {
          if (isOpen || isCallOpen) {
            setIsOpen(false);
            setIsCallOpen(false);
          } else {
            setIsOpen(true);
          }
        }}
      />
      <ChatPanel
        isOpen={isOpen}
        messages={messages}
        onSendMessage={streamMessage}
        isTyping={isTyping}
        isEscalated={isEscalated}
        
        onMicClick={() => {
          setIsOpen(false); 
          setIsCallOpen(true);    
        }}
      />
      <CallPanel
        isOpen={isCallOpen}
        transcripts={transcripts}
        // onClose={toggleCall}
        onClose={() => setIsCallOpen(false)} // or toggleCall
        onOpenChat={() => setIsOpen(true)}
        messages={messages}
      />
      {showEscalationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full text-center">
            <div className="flex items-center justify-between space-x-4 mb-4">
              <div className="flex-1">
                <img src="https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576066/AiIcon_v4f3iu.png" alt="AI Avatar" className="w-24 h-24 mx-auto rounded-full border" />
                <p className="mt-2 text-sm text-gray-600">AI Assistant</p>
              </div>
              <div className="text-gray-400">
                <ArrowRight className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <img src="https://res.cloudinary.com/dpnw5oqye/image/upload/v1752576292/HumanIcon_hv6ix7.jpg" alt="Human Agent" className="w-24 h-24 mx-auto rounded-full border" />
                <p className="mt-2 text-sm text-gray-600">Human Agent</p>
              </div>
            </div>
            <p className="text-gray-800 font-semibold">
              Transferring your query to a human agent.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              All further messages will come from our support team.
            </p>
            <button
              className="mt-4 px-4 py-2 bg-custom-red-500 text-white rounded-md hover:bg-custom-red-600"
              onClick={() => setShowEscalationModal(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}

    </div>
  );
};