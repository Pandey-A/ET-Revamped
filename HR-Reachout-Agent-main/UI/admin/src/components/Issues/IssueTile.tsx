
import React from 'react';
import { Issue, IssueStatus } from '@/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface IssueTileProps {
  issue: Issue;
  onClick: (issue: Issue) => void;
}

const statusLabels: Record<IssueStatus, string> = {
  new: 'New',
  escalated: 'Escalated',
  closed: 'Closed',
  ai: 'AI Agent',
};

const statusClasses: Record<IssueStatus, string> = {
  new: 'status-new',
  escalated: 'status-escalated',
  closed: 'status-closed',
  ai: 'status-ai',
};

const priorityClasses = {
  low: 'bg-slate-500/20 text-slate-300',
  medium: 'bg-amber-500/20 text-amber-300',
  high: 'bg-red-500/20 text-red-300',
};

const IssueTile: React.FC<IssueTileProps> = ({ issue, onClick }) => {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card 
      className="issue-tile flex flex-col h-full"
      onClick={() => onClick(issue)}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-medium text-sm line-clamp-2">{issue.title}</h3>
        <Badge className={cn(statusClasses[issue.status], 'ml-2 whitespace-nowrap')}>
          {statusLabels[issue.status]}
        </Badge>
      </div>
      
      <div className="text-xs text-muted-foreground mb-2">
        {issue.gameName} • {issue.platform}
      </div>
      
      <div className="mt-auto pt-3 flex items-center justify-between text-xs border-t border-border/50">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded-full bg-primary/20 flex-shrink-0"></div>
          <span className="text-muted-foreground">{issue.userName}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn(priorityClasses[issue.priority], 'text-xs')}>
            {issue.priority}
          </Badge>
          <span className="text-muted-foreground">
            {formatDate(issue.updatedAt)}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default IssueTile;
