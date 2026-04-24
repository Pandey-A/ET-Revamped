
import React from 'react';
import IssueSection from '../Issues/IssueSection';
import { Issue } from '@/types';

interface DashboardProps {
  title: string;
  newIssues: Issue[];
  escalatedIssues: Issue[];
  closedIssues: Issue[];
  aiIssues: Issue[];
}

const Dashboard: React.FC<DashboardProps> = ({
  title,
  newIssues,
  escalatedIssues,
  closedIssues,
  aiIssues
}) => {
  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">
          Manage and respond to user issues for gaming applications
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex gap-3 p-4 rounded-lg bg-card/70 border border-border">
          <div className="bg-primary/20 rounded-full w-12 h-12 flex items-center justify-center">
            <span className="text-xl font-bold text-primary">
              {newIssues.length + escalatedIssues.length}
            </span>
          </div>
          <div>
            <h3 className="font-medium">Active Issues</h3>
            <p className="text-sm text-muted-foreground">
              Issues requiring attention
            </p>
          </div>
        </div>
        <div className="flex gap-3 p-4 rounded-lg bg-card/70 border border-border">
          <div className="bg-green-500/20 rounded-full w-12 h-12 flex items-center justify-center">
            <span className="text-xl font-bold text-green-400">
              {closedIssues.length}
            </span>
          </div>
          <div>
            <h3 className="font-medium">Resolved Issues</h3>
            <p className="text-sm text-muted-foreground">
              Successfully closed issues
            </p>
          </div>
        </div>
      </div>
      
      <div className="space-y-6">
        <IssueSection title="New Issues" issues={newIssues} />
        <IssueSection title="Escalated Issues" issues={escalatedIssues} />
        <IssueSection title="AI Agent Issues" issues={aiIssues} />
        <IssueSection title="Closed Issues" issues={closedIssues} />
      </div>
    </div>
  );
};

export default Dashboard;
