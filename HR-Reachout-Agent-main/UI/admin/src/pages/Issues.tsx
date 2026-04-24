
import React from 'react';
import MainLayout from '@/components/Layout/MainLayout';
import SupportQueue from '@/components/Issues/SupportQueue';
import { mockIssues } from '@/utils/mockData';

const Issues = () => {
  try {
    // Combine all issues for the queue view
    const allIssues = [
      ...mockIssues.new,
      ...mockIssues.escalated,
      ...mockIssues.closed,
      ...mockIssues.ai
    ];
    
    return (
      <MainLayout>
        <SupportQueue 
          title="Support Queue Management" 
          // issues={allIssues} 
        />
      </MainLayout>
    );
  } catch (error) {
    console.error('Error rendering Issues page:', error);
    return (
      <MainLayout>
        <div className="p-6 text-center">
          <h1 className="text-xl font-semibold mb-4">An error occurred</h1>
          <p>We encountered a problem loading the Issues Dashboard. Please try refreshing the page.</p>
        </div>
      </MainLayout>
    );
  }
};

export default Issues;
