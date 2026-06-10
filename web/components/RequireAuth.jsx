'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function RequireAuth({ children, allowedRoles = ['user', 'admin'] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      window.location.href = `/login?from=${pathname}`;
      return;
    }

    if (user?.isBlocked) {
      const q = new URLSearchParams({ blockedUntil: user.blockedUntil || '' });
      window.location.href = `/blocked?${q.toString()}`;
      return;
    }


  }, [isLoading, isAuthenticated, user, allowedRoles, pathname]);

  if (isLoading) return null;
  if (!isAuthenticated) return null;
  if (user?.isBlocked) return null;


  return <>{children}</>;
}
