/**
 * AuditPanel — streams LLM blind audit output with a terminal-like feel.
 */

import { useEffect, useRef } from "react"

interface Props {
  model: string
  text: string
  status: "running" | "done"
  latencyMs?: number
}

export function AuditPanel({ model, text, status, latencyMs }: Props) {
  const scrollRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 flex flex-col max-h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
        <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
          LLM Audit
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {model}
          </span>
          {status === "running" && (
            <span className="inline-block w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
          )}
          {status === "done" && (
            <span className="inline-block w-1.5 h-1.5 bg-emerald-400 rounded-full" />
          )}
        </div>
      </div>

      {/* Body */}
      <pre
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap"
      >
        {text || (
          <span className="text-zinc-600">Analyzing contract...</span>
        )}
        {status === "running" && (
          <span className="inline-block w-1.5 h-4 bg-amber-400/80 ml-0.5 animate-blink align-text-bottom" />
        )}
      </pre>

      {/* Footer */}
      {status === "done" && latencyMs != null && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600 font-mono">
            Completed in {(latencyMs / 1000).toFixed(1)}s
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {text.length.toLocaleString()} chars
          </span>
        </div>
      )}
    </div>
  )
}
