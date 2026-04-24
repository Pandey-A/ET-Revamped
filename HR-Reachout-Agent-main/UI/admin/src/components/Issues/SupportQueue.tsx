import React, { useState, useEffect } from 'react';
import { useRef } from 'react';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Filter } from 'lucide-react';
import ConversationModal from './ConversationModal';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import axios from 'axios';
import type { Issue } from '@/types'; 

interface SupportQueueProps {
  title: string;
}

const SupportQueue: React.FC<SupportQueueProps> = ({ title }) => {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'escalated' | 'active'>('all');
  const isMobile = useIsMobile();
  const socketRef = useRef<WebSocket | null>(null);

useEffect(() => {
  const sessionId = `agent-frontend-${Date.now()}`;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;

  let reconnectTimeout: NodeJS.Timeout | null = null;
  let isUnmounted = false;

  const setupWebSocket = () => {
    // const ws = new WebSocket(`${protocol}://${host}/api/ws/admin?session_id=${sessionId}`);
    const ws = new WebSocket(`${import.meta.env.VITE_BACKEND_URL}/ws/admin?session_id=${sessionId}`);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log(`[WebSocket] Connected to /ws/admin as ${sessionId}`);
    };

    ws.onmessage = (event) => {
      if (event.data === "ping") return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.error('[WebSocket] Failed to parse message:', err);
        return;
      }

      if (data.type === 'ticket_escalated' && data.ticket && data.ticket.jira_issue_id != null ) {
        const newTicket = data.ticket;
        console.log(" New ticket escalated:", newTicket);

        const transformedIssue: Issue = {
          id: newTicket.jira_issue_id || newTicket.session_id || `temp-${Math.random()}`,
          title: newTicket.summary || 'No Summary Provided',
          description: newTicket.description || 'No description available.',
          userName: 'John',
          status: 'escalated',
          priority: 'medium',
          updatedAt: new Date(newTicket.created_at ?? Date.now()),
          userId: newTicket.session_id || `unknown-user-${Math.random()}`,
          userAvatar: 'https://cdn.example.com/default-avatar.png',
          createdAt: new Date(newTicket.created_at ?? Date.now()),
          messages: newTicket.messages || [],
          category: 'General Support'
        };

        setIssues(prev => {
          const exists = prev.some(issue => issue.id === transformedIssue.id);
          if (exists) return prev;
          return [transformedIssue, ...prev];
        });

        toast.success(" New escalated ticket received!", {
          position: "top-right",
          autoClose: 5000,
          style: {
            background: "#1e293b",
            color: "#facc15",
            fontWeight: "bold",
            fontFamily: "monospace",
            border: "1px solid #facc15",
            borderRadius: "8px",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)"
          },
        });
      }
    };

    ws.onclose = () => {
      if (isUnmounted) return;

      console.warn('[WebSocket] 🔌 Disconnected. Reconnecting in 10ms...');
      reconnectTimeout = setTimeout(() => {
        if (!isUnmounted) {
          setupWebSocket();
        }
      }, 10);
    };

    ws.onerror = (err) => {
      console.error("[WebSocket] ❗ Error:", err);
    };
  };

  fetchIssues();
  setupWebSocket();

  return () => {
    isUnmounted = true;
    if (socketRef.current) {
      socketRef.current.close();
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
  };
}, []);


  const fetchIssues = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/tickets/escalated`);
      
      if (Array.isArray(res.data)) {
        const transformedIssues: Issue[] = res.data
           .filter((backendIssue: any) => backendIssue.jira_issue_id !== null ) //  Only keep Jira tickets
           .map((backendIssue: any) => {
          let status: Issue['status'];
          if (backendIssue.awaiting_human_response === true) {
            status = 'escalated';
          } else {
            // This logic might need further refinement based on your backend.
            // If 'awaiting_human_response' is false, does it mean 'closed', 'new', or 'ai'?
            // For now, let's assume if it's no longer awaiting human, it's either 'new' or 'ai'.
            // You might need a more sophisticated mapping if your backend sends other status indicators.
            status = 'ai'; // Or 'new', or 'closed' based on your specific logic
          }

          return {
            id: backendIssue.jira_issue_id || backendIssue.session_id || `temp-${Math.random()}`,
            title: backendIssue.summary || 'No Summary Provided',
            description: backendIssue.description || 'No description available.',
            userName: 'John', // Default if not in backend, or map from a new backend field
            status: status,
            priority: 'medium', // Default if not in backend, or map from a new backend field
            updatedAt: new Date(backendIssue.created_at ?? Date.now()),

            // POPULATE THE MISSING FIELDS FOR 'Issue' TYPE:
            userId: backendIssue.session_id || `unknown-user-${Math.random()}`, // Using session_id as userId
            userAvatar: 'https://cdn.example.com/default-avatar.png', // Provide a default avatar URL
            createdAt: new Date(backendIssue.created_at ?? Date.now()), // Directly map from backend
            messages: backendIssue.messages || [], // Directly map from backend, ensure it's an array
            category: 'General Support' // Provide a default category
          };
        });
        setIssues(transformedIssues);
      } else {
        console.error('Expected array but got:', res.data);
        setIssues([]); // fallback to empty array
      }
    } catch (err) {
      console.error('Error fetching issues:', err);
    }
  };

  const handleMessageSentInModal = () => {
    fetchIssues(); 
  };

  const handleIssueClick = (issue: Issue) => {
    setSelectedIssue(issue);
  };

  const handleCloseModal = () => {
    setSelectedIssue(null);
  };

  // const filteredIssues = issues.filter(issue => {
  //   const matchesSearch =
  //     (issue.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
  //     (issue.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
  //     (issue.userName || '').toLowerCase().includes(searchQuery.toLowerCase());

  //   if (!matchesSearch) return false;

  //   switch (activeFilter) {
  //     case 'pending': return issue.status === 'new';
  //     case 'escalated': return issue.status === 'escalated';
  //     case 'active': return issue.status === 'new' || issue.status === 'ai';
  //     default: return true;
  //   }
  // });
  const filteredIssues = issues.filter(issue => {
  const matchesSearch =
    (issue.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (issue.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (issue.userName || '').toLowerCase().includes(searchQuery.toLowerCase());

  if (!matchesSearch) return false;

  switch (activeFilter) {
    case 'pending': return issue.status === 'new';
    case 'escalated': return issue.status === 'escalated';
    // CHANGE THIS LINE: Include 'escalated' in your active filter
    case 'active': return issue.status === 'new' || issue.status === 'ai' || issue.status === 'escalated';
    default: return true;
  }
});

  const formatTime = (dateString: string | Date) => {
    try {
      return new Date(dateString).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      console.error("Invalid date string for formatting:", dateString, e);
      return "Invalid Date";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch(status) {
      case 'new': return 'bg-blue-500/20 text-blue-300';
      case 'escalated': return 'bg-amber-500/20 text-amber-300';
      case 'closed': return 'bg-green-500/20 text-green-300';
      case 'ai': return 'bg-purple-500/20 text-purple-300';
      default: return 'bg-slate-500/20 text-slate-300';
    }
  };

  const pendingCount = issues.filter(i => i.status === 'new').length;
  const escalatedCount = issues.filter(i => i.status === 'escalated').length;
  const activeCount = issues.filter(i => i.status === 'new' || i.status === 'ai' || i.status === 'escalated').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input 
              placeholder="Search issues..."
              className="pl-9 w-full md:w-64"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card/70">
        <div className="bg-black/10 p-3 overflow-x-auto">
          <div className="flex gap-4 min-w-max">
            {['all', 'escalated', 'active'].map(filter => (
              <span
                key={filter}
                className={`px-2 py-1 rounded-md cursor-pointer flex gap-1 items-center ${activeFilter === filter ? 'bg-primary/20 text-primary' : 'hover:bg-background/30'}`}
                onClick={() => setActiveFilter(filter as any)}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                {filter !== 'all' && <Badge className="text-xs h-5">{
                  // filter === 'pending' ? pendingCount :
                  filter === 'escalated' ? escalatedCount :
                  filter === 'active' ? activeCount : ''
                }</Badge>}
              </span>
            ))}
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-240px)]">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr className="border-b border-border">
                <th className="text-center p-3 font-medium text-sm text-muted-foreground">PLAYER</th>
                <th className="text-center p-3 font-medium text-sm text-muted-foreground">ISSUE</th>
                <th className="text-center p-3 font-medium text-sm text-muted-foreground">STATUS</th>
                {/* <th className="text-left p-3 font-medium text-sm text-muted-foreground">SENTIMENT</th> */}
                <th className="text-left p-3 font-medium text-sm text-muted-foreground">WAITING/ACTIVE SINCE</th>
                <th className="text-center p-3 font-medium text-sm text-muted-foreground">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No issues found
                  </td>
                </tr>
              ) : (
                filteredIssues.map((issue) => (
                  <tr 
                    key={issue.id} 
                    className="border-b border-border hover:bg-muted/10 cursor-pointer transition-colors"
                    onClick={() => handleIssueClick(issue)}
                  >
                    <td className="p-3 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
                        {issue.userName?.charAt(0) || "U"}
                      </div>
                      <div>
                        <p className="font-medium">{issue.userName || "Unknown User"}</p>
                        {/* <p className="text-xs text-muted-foreground">Level {Math.floor(Math.random() * 50) + 1}</p> */}
                      </div>
                    </td>
                    <td className="p-3">{issue.title}</td>
                    <td className="p-3">
                      {/* <Badge className={getStatusBadgeClass(issue.status || "new")}> */}
                      <Badge className="text-sm bg-[#F59E0B33] text-[#ebc030]">
                        { (issue.status || 'new').charAt(0).toUpperCase() + (issue.status || 'new').slice(1)}
                      </Badge>
                    </td>
                    {/* <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 bg-muted/20 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${issue.priority === 'high' ? 'bg-red-500' : issue.priority === 'medium' ? 'bg-amber-500' : 'bg-green-500'}`}
                            style={{ width: issue.priority === 'high' ? '75%' : issue.priority === 'medium' ? '50%' : '25%' }}
                          ></div>
                        </div>
                        <span className={issue.priority === 'high' ? 'text-red-300' : issue.priority === 'medium' ? 'text-amber-300' : 'text-green-300'}>
                          {issue.priority === 'high' ? '-0.75' : issue.priority === 'medium' ? '0.00' : '0.50'}
                        </span>
                      </div>
                    </td> */}
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border border-muted-foreground flex items-center justify-center">
                          <div className="w-2 h-2 bg-primary rounded-full"></div>
                        </div>
                        {formatTime(issue.updatedAt)}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleIssueClick(issue);
                          }} 
                          className="text-primary bg-primary/10 hover:bg-primary/20"
                        >
                          Chat
                        </Button>
                        <Button 
                          onClick={(e) => e.stopPropagation()} 
                          className="text-green-400 bg-green-500/10 hover:bg-green-500/20"
                        >
                          Resolve
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      <ConversationModal
        issue={selectedIssue} 
        onClose={handleCloseModal}
        onMessageSent={handleMessageSentInModal}
      />
    </div>
  );
};

export default SupportQueue;