import useCombinedTranscriptions from "@/hooks/useCombinedTranscriptions";
import * as React from "react";
import ReactMarkdown from "react-markdown";


interface TranscriptionViewProps {
  messages?: Array<{ content: string; isUser: boolean; type?: string }>;
}

export default function TranscriptionView({ messages = [] }: TranscriptionViewProps) {
  const combinedTranscriptions = useCombinedTranscriptions();
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [combinedTranscriptions, messages]);

    // 👇 Deduplicate by content and role
  const seen = new Set();
  const merged = [
    ...messages.map(m => ({
      key: `msg:${m.content}:${m.isUser}`,
      content: m.content,
      isUser: m.isUser,
    })),
    ...combinedTranscriptions.map(t => ({
      key: `trans:${t.text}:${t.role}`,
      content: t.text,
      isUser: t.role !== "assistant",
    })),
  ].filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });

  return (
    <div className="relative h-full w-full mx-auto">

      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-400 to-transparent z-10" />

      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[var(--lk-bg)] to-transparent z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--lk-bg)] to-transparent z-10 pointer-events-none" />

      <div ref={containerRef} className="h-full flex flex-col gap-2 overflow-y-auto px-4 py-8">
        {merged.map((item, index) => (
          <div
            key={item.key || index}
            className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
              item.isUser ? "user-mess self-end" : "assistant-mess self-start"
            }`}
          >
            <ReactMarkdown 
             components={{
                p: ({ children }) => <p className="mb-2">{children}</p>,
                a: ({ href, children }) => (
                  <a
                    href={href ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-custom-red-700 underline break-words"
                  >
                    {children}
                  </a>
                ),
                ul: ({ children }) => <ul className="list-disc ml-6 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ml-6 mb-2">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                strong: ({ children }) => <strong className="font-extrabold px-1">{children}</strong>,
                h3: ({ children }) => <h3 className="font-bold text-lg mt-2 mb-1">{children}</h3>,
                h2: ({ children }) => <h2 className="font-bold text-xl mt-2 mb-2">{children}</h2>,
                h1: ({ children }) => <h1 className="font-bold text-2xl mt-2 mb-2">{children}</h1>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 mb-2">
                    {children}
                  </blockquote>
                ),
                // Add more overrides as needed
              }}
            >
                {item.content}
            </ReactMarkdown>
          </div>
        ))}

      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-400 to-transparent z-10" />

    </div>
  );
}
