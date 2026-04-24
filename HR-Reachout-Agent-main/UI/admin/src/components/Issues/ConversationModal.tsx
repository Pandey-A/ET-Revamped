import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter, 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator'; 
import { X, Send } from 'lucide-react';
import { Issue, IssueMessage } from '@/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import axios from "axios";

interface ChatMessage {
  agent_name: string; 
  message: string;
  timestamp?: string;
}

interface ConversationModalProps {
  issue: Issue | null;
  onClose: () => void;
  onMessageSent?: () => void; 
}

const ConversationModal: React.FC<ConversationModalProps> = ({ issue, onClose, onMessageSent }) => {
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false); // Added state for sending
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

useEffect(() => {
  const textarea = textareaRef.current;
  if (textarea) {
    textarea.style.height = "auto"; // Reset for shrink if necessary
    textarea.style.height = Math.min(textarea.scrollHeight, 6 * 24) + "px"; // max 6 lines
  }
}, [newMessage]);


useEffect(() => {
  if (!issue?.userId) return;

  let retryTimeout: NodeJS.Timeout;
  let isUnmounted = false;

  const connectWebSocket = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  // const socket = new WebSocket(`${protocol}://${host}/api/ws/admin?session_id=${issue.userId}`);
    const socket = new WebSocket(`ws://localhost:8000/ws/admin?session_id=${issue.userId}`);
    ws.current = socket;

    socket.onopen = () => {
      console.log(" Connected to WebSocket");
    };

    socket.onmessage = (event) => {
      if (event.data === "ping") {
      return;
    }


      try {
        const data = JSON.parse(event.data);
        console.log(" New message received:", data);

        setConversationHistory((prev) => [
          ...prev,
          {
            agent_name: data.agent_name,
            message: data.message,
            timestamp: data.timestamp || new Date().toISOString(),
          },
        ]);
      } catch (err) {
        console.error(" Failed to parse WebSocket message", err);
      }
    };

    socket.onclose = (event) => {
      console.warn(" WebSocket disconnected" , event.code , event.reason);

      if (!isUnmounted) {
        retryTimeout = setTimeout(() => {
          console.log(" Reconnecting WebSocket...");
          connectWebSocket();
        }, 5000);
      }
    };

    socket.onerror = (err) => {
      console.error(" WebSocket error:", err);
      socket.close();
    };
  };

  connectWebSocket();

  return () => {
    isUnmounted = true;
    clearTimeout(retryTimeout);
    ws.current?.close();
  };
}, [issue?.userId]);


 
useEffect(() => {
    const fetchConversationHistory = async () => {

      if (!issue || !issue.userId) { 
        setConversationHistory([]);
        return;
      }

      setIsLoadingHistory(true);
      try {
        const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/chat/history/${issue.userId}`); // Changed to issue.userId
        if (response.data && Array.isArray(response.data.messages)) {
          setConversationHistory(response.data.messages);
        } else {
          setConversationHistory([]);
          console.warn("Unexpected response format for chat history:", response.data);
        }
      } catch (error) {
        console.error("Failed to fetch conversation history:", error);
        setConversationHistory([]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchConversationHistory();
  }, [issue]); 

  // --- Effect to scroll to bottom when history updates ---
  useEffect(() => {
    scrollToBottom();
  }, [conversationHistory]); // Scroll when conversationHistory updates, not issue.messages

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

const handleSendMessage = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!newMessage.trim() || !issue || !issue.userId) {
    console.warn("Cannot send message: Message is empty or issue/session_id is missing.");
    return;
  }

  setIsSending(true);

  try {
    const response = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/tickets/reply`, {
      session_id: issue.userId,
      message: newMessage,
      agent_name: "system",
    });

    if (response.data.status === "success") {

      setNewMessage("");
      onMessageSent?.(); 
    } else {
      console.error("Backend reported an issue sending message:", response.data);
    }
  } catch (error) {
    console.error("Failed to send message:", error);
  } finally {
    setIsSending(false);
  }
};
  if (!issue) return null;

  return (
    <Dialog open={!!issue} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* User Avatar and Info */}
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
                {issue.userName.charAt(0)}
              </div>
              <div>
                <DialogTitle className="text-lg font-medium">{issue.title}</DialogTitle>
                <div className="flex items-center gap-2 mt-1 text-sm">
                
                  {issue.gameName && issue.platform && (
                    <span className="text-muted-foreground">{issue.gameName} • {issue.platform}</span>
                  )}
                  <Badge variant="outline" className="text-xs">
                      ID:&nbsp;
                      <a 
                        href={`https://my23-team.atlassian.net/browse/${issue.id}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="underline text-blue-600 hover:text-blue-800"
                      >
                        https://my23-team.atlassian.net/browse/${issue.id}
                      </a>
                  </Badge>
                </div>
              </div>
            </div>
            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
            >
              <X size={18} />
            </Button>
          </div>
        </DialogHeader>

        {/* Conversation History Area */}
        <div className="flex-1 overflow-auto">
          <ScrollArea className="h-full py-4 px-4">
            <div className="space-y-4">
              {isLoadingHistory ? (
                <p className="text-center text-muted-foreground">Loading conversation...</p>
              ) : conversationHistory.length > 0 ? (
            
                conversationHistory.map((msg, index) => (
                  
                  <MessageBubble 
                    key={index} 
                    message={{
                      id: `msg-${index}`, 
                      senderName: msg.agent_name,
                      senderAvatar: msg.agent_name === 'User' ? issue.userAvatar : '/placeholder-avatar.png', 
                      content: msg.message,
                      timestamp: msg.timestamp || new Date().toISOString(), 
                      isAgent: msg.agent_name === 'AI' || msg.agent_name === 'system',
                    }} 
                  />
                ))
              ) : (
                <p className="text-center text-muted-foreground">No conversation history found.</p>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        <div className="border-t border-border bg-card p-4 mt-auto">
          <form onSubmit={handleSendMessage} className="flex w-full gap-2 items-end">
            <div className="flex-grow">
              <textarea
                ref={textareaRef}
                rows={1}
                className="w-full resize-none border-gray-500 border rounded-lg py-2 px-3 text-black text-sm leading-6 max-h-[144px] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-400 scrollbar-track-transparent"
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={isSending}
              />
            </div>
            <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSending}>
              <Send size={18} className="mr-2" /> Send
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};


interface MessageBubbleProps {
  message: IssueMessage; 
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isAgent =
    message.senderName === 'AI' ||
    message.senderName === 'system' ||
    message.senderName === 'System';

  const linkify = (text: string) => {
    const urlRegex = /((https?:\/\/|www\.)[^\s]+)/g;
    return text.split(urlRegex).map((part, index) => {
      if (urlRegex.test(part)) {
        const href = part.startsWith("http") ? part : `https://${part}`;
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline break-words"
          >
            <span>{part}</span>
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className={cn("flex gap-3", isAgent ? "justify-start" : "justify-end")}>
      {isAgent && (
        <Avatar className="h-8 w-8 bg-white">
          <AvatarImage
            src={message.senderAvatar || '/placeholder-avatar.png'}
            alt={message.senderName}
          />
          <AvatarFallback>{message.senderName.charAt(0)}</AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-lg p-3",
          message.senderName === 'User' || message.senderName === 'user'
            ? "bg-blue-600 text-white"
            : message.senderName === 'System' || message.senderName === 'system'
              ? "bg-green-600 text-white"
              : "bg-muted text-foreground"
        )}
      >
        <div className="flex justify-between items-center gap-2 mb-1">
          <span className="font-medium text-sm">
            {message.senderName.charAt(0).toUpperCase() + message.senderName.slice(1)}
          </span>
          <span className="text-xs opacity-70">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <p className="text-sm break-words">{linkify(message.content)}</p>
      </div>

      {!isAgent && (
        <Avatar className="h-8 w-8 bg-white">
          <AvatarImage
            src={message.senderAvatar || '/placeholder-avatar.png'}
            alt={message.senderName}
          />
          <AvatarFallback>{message.senderName.charAt(0)}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
};
export default ConversationModal;