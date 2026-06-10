'use client';

import Navbar from '@/components/Navbar';

export default function WhatsAppChannelsError({ error, reset }) {
  return (
    <div className="admin-page admin-page--status">
      <Navbar />
      <div className="admin-nav-spacer" />
      <div className="admin-status-card">
        <h2>Could not load WhatsApp Channels</h2>
        <p>{error?.message || 'Something went wrong while loading this page.'}</p>
        <button type="button" className="aia-create-btn" onClick={() => reset()} style={{ marginTop: '1rem' }}>
          Try again
        </button>
      </div>
    </div>
  );
}
