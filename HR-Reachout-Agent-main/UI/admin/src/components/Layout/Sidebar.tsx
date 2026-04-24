
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MessageSquare, User, Book, ChevronRight, ChevronLeft , Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SidebarItem } from '@/types';

interface SidebarProps {
  className?: string;
}

const sidebarItems: SidebarItem[] = [
  {
    title: 'Issues',
    path: '/',
    icon: MessageSquare,
  },
  {
    title: 'My Issues',
    path: '/my-issues',
    icon: User,
  },
  {
    title: 'AI Agent',
    path: '/ai-agent',
    icon: Bot,
  },
  {
    title: 'Resource Base',
    path: '/resource-base',
    icon: Book,
  },
];

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        'h-screen bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
        className
      )}
    >
      <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex justify-center items-center">
            <img 
              src="https://res.cloudinary.com/dpnw5oqye/image/upload/v1751979161/c8e54786-2ab5-4427-b2fc-1e69edece502_kpbqbr.png" 
              alt="Elevate Trust Logo" 
              className="h-10 w-auto ml-6"
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto text-sidebar-foreground"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </Button>
      </div>

      <div className="flex flex-col flex-grow p-2 space-y-2 overflow-y-auto">
        {sidebarItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => 
              cn('sidebar-link', isActive && 'active')
            }
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        ))}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        {!collapsed && (
          <div className="text-xs text-sidebar-foreground/60">
            Elevate Trust v1.0
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
