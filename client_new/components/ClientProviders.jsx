'use client';

import { AuthProvider } from '@/context/AuthContext';
import FloatingChatWidget from '@/components/FloatingChatWidget';

export default function ClientProviders({ children }) {
  return (
    <AuthProvider>
      {children}
      <FloatingChatWidget />
    </AuthProvider>
  );
}
