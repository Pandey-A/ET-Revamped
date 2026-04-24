
import React, { useState } from 'react';
import { Issue } from '@/types';
import IssueTile from './IssueTile';
import ConversationModal from './ConversationModal';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface IssueSectionProps {
  title: string;
  issues: Issue[];
  className?: string;
}

const IssueSection: React.FC<IssueSectionProps> = ({ title, issues, className }) => {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  const handleIssueClick = (issue: Issue) => {
    try {
      setSelectedIssue(issue);
    } catch (error) {
      console.error('Error selecting issue:', error);
    }
  };

  const handleCloseModal = () => {
    setSelectedIssue(null);
  };

  return (
    <div className={cn('section-container', className)}>
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      
      <ScrollArea className="h-[300px]">
        {issues.length === 0 ? (
          <div className="text-muted-foreground text-center py-4">
            No issues found
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
            {issues.map((issue) => (
              <IssueTile 
                key={issue.id} 
                issue={issue} 
                onClick={handleIssueClick} 
              />
            ))}
          </div>
        )}
      </ScrollArea>
      
      <ConversationModal
        issue={selectedIssue}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default IssueSection;
