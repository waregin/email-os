import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import type { ThreadDetail as ThreadDetailType, MessageDetail } from '../api';
import { parseSender, formatDate } from '../utils/text';
import { prepareHtml } from '../utils/html';

function HtmlFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = prepareHtml(html);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handler = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.type === 'iframe-height' && e.data.h) {
        iframe.style.height = `${e.data.h}px`;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups"
      className="w-full border-0 block"
      style={{ minHeight: '100px' }}
      title="email-body"
    />
  );
}

function MessagePanel({ message, defaultExpanded }: { message: MessageDetail; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 hover:bg-gray-900/60 transition-colors bg-gray-900/20"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <span
            className={`text-sm truncate ${
              message.isUnread ? 'font-semibold text-gray-100' : 'text-gray-300'
            }`}
          >
            {parseSender(message.sender)}
          </span>
          <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
            {formatDate(message.date)}
          </span>
        </div>
        {!expanded && (
          <div className="text-xs text-gray-600 truncate mt-0.5">{message.snippet}</div>
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-800">
          {message.htmlBody ? (
            <HtmlFrame html={message.htmlBody} />
          ) : message.plaintextBody ? (
            <pre className="px-4 py-3 text-sm text-gray-300 whitespace-pre-wrap break-words font-sans">
              {message.plaintextBody}
            </pre>
          ) : (
            <p className="px-4 py-3 text-sm text-gray-600">(no content)</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ThreadDetail({ threadId }: { threadId: string }) {
  const [thread, setThread] = useState<ThreadDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setThread(null);
    api
      .getThread(threadId)
      .then(setThread)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [threadId]);

  if (loading) {
    return <div className="px-4 py-6 text-sm text-gray-600">Loading thread…</div>;
  }

  if (error) {
    return <div className="px-4 py-6 text-sm text-red-400">Error: {error}</div>;
  }

  if (!thread) return null;

  const hasUnread = thread.messages.some((m) => m.isUnread);

  return (
    <div className="space-y-2 px-4 py-3">
      {thread.messages.map((message, i) => (
        <MessagePanel
          key={message.id}
          message={message}
          defaultExpanded={message.isUnread || (!hasUnread && i === thread.messages.length - 1)}
        />
      ))}
    </div>
  );
}
