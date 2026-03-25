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
      router.replace(`/login?from=${pathname}`);
      return;
    }

    if (user?.isBlocked) {
      const q = new URLSearchParams({ blockedUntil: user.blockedUntil || '' });
      router.replace(`/blocked?${q.toString()}`);
      return;
    }

    if (!allowedRoles.includes(user?.role)) {
      if (user?.role === 'admin') {
        router.replace('/admin');
      } else {
        router.replace('/upload');
      }
    }
  }, [isLoading, isAuthenticated, user, allowedRoles, router, pathname]);

  if (isLoading) return null;
  if (!isAuthenticated) return null;
  if (user?.isBlocked) return null;
  if (!allowedRoles.includes(user?.role)) return null;

  return <>{children}</>;
}
