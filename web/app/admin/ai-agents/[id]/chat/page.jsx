import { Suspense } from "react";
import ClientPage from "./ClientPage";

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={<div className="admin-page admin-page--status"><div className="admin-status-card">Loading chat…</div></div>}>
      <ClientPage />
    </Suspense>
  );
}
