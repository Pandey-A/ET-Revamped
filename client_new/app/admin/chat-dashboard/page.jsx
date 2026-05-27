import { redirect } from 'next/navigation';

/** Old URL — keep working for bookmarks. */
export default function LegacyAdminChatDashboardPage() {
  redirect('/chat-dashboard/');
}
