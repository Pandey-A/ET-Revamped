
import { Issue, IssueStatus } from "../types";

// Helper function to create dates in the past
const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Helper function to create random dates between two dates
const randomDateBetween = (start: Date, end: Date): Date => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

export const generateIssues = (status: IssueStatus, count: number): Issue[] => {
  const issues: Issue[] = [];
  
  const gameNames = ['Cyberpunk 2077', 'Call of Duty: Warzone', 'League of Legends', 'Fortnite', 
                     'Apex Legends', 'Minecraft', 'Valorant', 'Genshin Impact', 'Destiny 2'];
  
  const platforms = ['PC', 'PlayStation 5', 'Xbox Series X', 'Nintendo Switch', 'Mobile'];
  
  const categories = ['Technical Issue', 'Account Problem', 'Billing Question', 
                     'Gameplay Bug', 'Feature Request', 'Connectivity Issue'];
  
  const issuesByStatus = {
    new: [
      'Game crashes during loading screen',
      'Cannot connect to multiplayer servers',
      'FPS drops after recent update',
      'Audio cutting out during gameplay',
      'Character model not rendering correctly'
    ],
    escalated: [
      'Payment made but no in-game items received',
      'Account banned without explanation',
      'Recurring crash issue persists after multiple patches',
      'Lost all progress after server maintenance',
      'Unable to access purchased DLC'
    ],
    closed: [
      'Login issues resolved after account verification',
      'Game performance improved after driver update',
      'Missing items restored to inventory',
      'Control configuration fixed',
      'Friend list bug resolved'
    ],
    ai: [
      'How to defeat final boss?',
      'Best weapon loadout for PvP?',
      'How to unlock secret achievement?',
      'Fastest way to level up?',
      'Strategy for raid completion?'
    ]
  };
  
  for (let i = 0; i < count; i++) {
    const gameIndex = Math.floor(Math.random() * gameNames.length);
    const platformIndex = Math.floor(Math.random() * platforms.length);
    const categoryIndex = Math.floor(Math.random() * categories.length);
    const titleIndex = Math.floor(Math.random() * issuesByStatus[status].length);
    
    const createdDate = status === 'new' ? daysAgo(Math.floor(Math.random() * 2)) : 
                         status === 'escalated' ? daysAgo(Math.floor(Math.random() * 5) + 2) :
                         status === 'closed' ? daysAgo(Math.floor(Math.random() * 10) + 5) :
                         daysAgo(Math.floor(Math.random() * 3));
    
    const updatedDate = randomDateBetween(createdDate, new Date());
    
    const userId = `user-${Math.floor(Math.random() * 1000)}`;
    const userNames = ['Alex', 'Jamie', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Sam', 'Morgan', 'Quinn'];
    const userName = userNames[Math.floor(Math.random() * userNames.length)] + Math.floor(Math.random() * 100);
    
    // Generate messages
    const messageCount = Math.floor(Math.random() * 5) + 1;
    const messages = [];
    
    for (let j = 0; j < messageCount; j++) {
      const isFirstMessage = j === 0;
      const isAgent = j % 2 === 1;
      const messageDate = randomDateBetween(createdDate, updatedDate);
      
      messages.push({
        id: `msg-${i}-${j}`,
        senderId: isAgent ? 'agent-id' : userId,
        senderName: isAgent ? 'Support Agent' : userName,
        senderAvatar: isAgent ? '/placeholder.svg' : '/placeholder.svg',
        content: isFirstMessage 
          ? `I'm having an issue with ${gameNames[gameIndex]} on ${platforms[platformIndex]}. ${issuesByStatus[status][titleIndex]}.`
          : isAgent 
            ? 'Thank you for reporting this issue. Our team is investigating the problem and will get back to you shortly.'
            : 'Thanks for your help! I\'m still experiencing the issue. Is there anything else I can try?',
        timestamp: messageDate,
        isAgent
      });
    }
    
    issues.push({
      id: `issue-${status}-${i}`,
      title: issuesByStatus[status][titleIndex],
      description: `Issue with ${gameNames[gameIndex]} on ${platforms[platformIndex]}`,
      status,
      gameName: gameNames[gameIndex],
      platform: platforms[platformIndex],
      userId,
      userName,
      userAvatar: '/placeholder.svg',
      createdAt: createdDate,
      updatedAt: updatedDate,
      messages,
      priority: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as 'low' | 'medium' | 'high',
      category: categories[categoryIndex]
    });
  }
  
  return issues;
};

export const mockIssues = {
  new: generateIssues('new', 8),
  escalated: generateIssues('escalated', 6),
  closed: generateIssues('closed', 10),
  ai: generateIssues('ai', 7)
};

export const getAllIssues = () => {
  return [...mockIssues.new, ...mockIssues.escalated, ...mockIssues.closed, ...mockIssues.ai];
};

export const getMyIssues = () => {
  // For demo purposes, filter to show only a subset
  return getAllIssues().filter((_, index) => index % 3 === 0);
};
