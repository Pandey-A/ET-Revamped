
import React from 'react';
import Sidebar from './Sidebar';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface MainLayoutProps {
  children: React.ReactNode;
  className?: string;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children, className }) => {
  const isMobile = useIsMobile();

  return (
    // <div className="flex min-h-screen bg-gaming-background">
    <div className="flex min-h-screen bg-[#f1f0f0]">
      <Sidebar />
      <main className={cn('flex-grow p-4 md:p-6 overflow-y-auto', className)}>
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
