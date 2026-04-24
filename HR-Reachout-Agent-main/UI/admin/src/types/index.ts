
// Sidebar types
export type SidebarItem = {
  title: string;
  path: string;
  icon: React.ElementType;
}

// Issue types
export type IssueStatus = 'new' | 'escalated' | 'closed' | 'ai';

export type IssueMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: Date;
  isAgent: boolean;
}

export type Issue = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  gameName?: string;
  platform?: string;
  userId: string;
  userName: string;
  userAvatar: string;
  createdAt: Date;
  updatedAt: Date;
  messages: IssueMessage[];
  priority: 'low' | 'medium' | 'high';
  category: string;
}
