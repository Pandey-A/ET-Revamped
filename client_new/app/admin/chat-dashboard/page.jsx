'use client';

import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import ChatOpsDashboard from '@/components/chat-dashboard/ChatOpsDashboard';

export default function ChatDashboardPage() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      window.location.href = '/login/';
    }
  }, [isLoading, user]);

  if (isLoading) {
    return (
      <div className="cdb-page-loading">
        <p>Loading chat dashboard…</p>
      </div>
    );
  }

  if (!user) return null;

  if (user.role !== 'admin') {
    return (
      <div className="cdb-page-loading cdb-page-loading--error">
        <p>Access denied. Admin role required.</p>
      </div>
    );
  }

  return <ChatOpsDashboard />;
}
