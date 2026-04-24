import React from 'react';
import MainLayout from '@/components/Layout/MainLayout';
import SupportQueue from '@/components/Issues/SupportQueue';
import { getMyIssues } from '@/utils/mockData';

const MyIssues = () => {
  try {
    const allMyIssues = getMyIssues();
    
    return (
      <MainLayout>
        <SupportQueue 
          title="My Support Queue" 
          // issues={allMyIssues} 
        />
      </MainLayout>
    );
  } catch (error) {
    console.error('Error rendering My Issues page:', error);
    return (
      <MainLayout>
        <div className="p-6 text-center">
          <h1 className="text-xl font-semibold mb-4">An error occurred</h1>
          <p>We encountered a problem loading your issues. Please try refreshing the page.</p>
        </div>
      </MainLayout>
    );
  }
};

export default MyIssues;
