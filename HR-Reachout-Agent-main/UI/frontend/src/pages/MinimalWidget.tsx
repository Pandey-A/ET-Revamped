import { ChatWidget } from "@/components/ChatWidget/ChatWidget";

const MinimalWidget = () => {
  return (
    <div className="!bg-transparent" style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      background: 'transparent'
    }}>
      <ChatWidget />
    </div>
  );
}

export default MinimalWidget;