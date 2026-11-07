import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function Pre({ children }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = (ref.current && ref.current.innerText) || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (_error) {
      setCopied(false);
    }
  };

  return (
    <div className="code">
      <button type="button" className="code-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

const COMPONENTS = {
  pre: Pre,
  // Links stay inert: this application has no business reaching the internet
  // on your behalf, and the window refuses external navigation anyway.
  a: ({ children }) => <span className="md-link">{children}</span>,
};

export default function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}