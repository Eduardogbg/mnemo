/**
 * AuditPanel — streams LLM blind audit output with a terminal-like feel.
 * Includes a lightweight markdown renderer (regex-based, no deps).
 */

import { useEffect, useRef, useMemo, type ReactNode } from "react"

// ---------------------------------------------------------------------------
// Minimal markdown-to-JSX renderer
// Handles: headings, bold, inline code, fenced code blocks, bullet/numbered
// lists. Good enough for hackathon LLM output.
// ---------------------------------------------------------------------------

function renderMarkdown(src: string): ReactNode[] {
  const lines = src.split("\n")
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  const inlineFormat = (raw: string): ReactNode => {
    // Split by backtick first, then bold inside non-code segments
    const parts: ReactNode[] = []
    const codeRe = /`([^`]+)`/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = codeRe.exec(raw)) !== null) {
      if (m.index > last) parts.push(boldify(raw.slice(last, m.index), key++))
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-zinc-800 text-amber-300 text-[11px]"
        >
          {m[1]}
        </code>,
      )
      last = m.index + m[0].length
    }
    if (last < raw.length) parts.push(boldify(raw.slice(last), key++))
    return parts.length === 1 ? parts[0] : <>{parts}</>
  }

  const boldify = (s: string, k: number): ReactNode => {
    const parts: ReactNode[] = []
    const boldRe = /\*\*(.+?)\*\*/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = boldRe.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      parts.push(
        <strong key={`b${k}-${m.index}`} className="text-zinc-100 font-semibold">
          {m[1]}
        </strong>,
      )
      last = m.index + m[0].length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts.length === 1 ? parts[0] : <span key={k}>{parts}</span>
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      out.push(
        <pre
          key={key++}
          className="my-2 p-3 rounded-lg bg-zinc-950 ring-1 ring-zinc-800 text-[11px] text-emerald-300 overflow-x-auto"
        >
          {lang && (
            <span className="block text-[9px] text-zinc-600 mb-1 uppercase">
              {lang}
            </span>
          )}
          {codeLines.join("\n")}
        </pre>,
      )
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const cls =
        level === 1
          ? "text-base font-bold text-zinc-100 mt-4 mb-2"
          : level === 2
            ? "text-sm font-bold text-zinc-200 mt-3 mb-1.5"
            : "text-xs font-semibold text-zinc-300 mt-2 mb-1"
      out.push(
        <div key={key++} className={cls}>
          {inlineFormat(headingMatch[2])}
        </div>,
      )
      i++
      continue
    }

    // Bullet list — collect consecutive lines
    if (/^\s*[-*]\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(
          <li key={key++} className="ml-4 list-disc text-zinc-300">
            {inlineFormat(lines[i].replace(/^\s*[-*]\s+/, ""))}
          </li>,
        )
        i++
      }
      out.push(
        <ul key={key++} className="my-1 space-y-0.5">
          {items}
        </ul>,
      )
      continue
    }

    // Numbered list
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(
          <li key={key++} className="ml-4 list-decimal text-zinc-300">
            {inlineFormat(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}
          </li>,
        )
        i++
      }
      out.push(
        <ol key={key++} className="my-1 space-y-0.5">
          {items}
        </ol>,
      )
      continue
    }

    // Blank line → spacing
    if (line.trim() === "") {
      out.push(<div key={key++} className="h-2" />)
      i++
      continue
    }

    // Plain paragraph
    out.push(
      <p key={key++} className="text-zinc-300 my-0.5">
        {inlineFormat(line)}
      </p>,
    )
    i++
  }

  return out
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  model: string
  text: string
  status: "running" | "done"
  latencyMs?: number
}

export function AuditPanel({ model, text, status, latencyMs }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text])

  const rendered = useMemo(() => renderMarkdown(text), [text])

  return (
    <div className="flex flex-col" style={{ maxHeight: "calc(100vh - 8rem)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 flex-shrink-0">
        <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${status === "running" ? "bg-amber-400 glow-amber" : "bg-emerald-400 glow-green"}`} />
          LLM Audit
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
            {model}
          </span>
          {status === "running" && (
            <span className="text-[10px] font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full ring-1 ring-amber-400/20">
              streaming
            </span>
          )}
          {status === "done" && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-400/20">
              complete
            </span>
          )}
        </div>
      </div>

      {/* Body — markdown rendered */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 text-xs font-mono leading-relaxed"
      >
        {text ? (
          rendered
        ) : (
          <span className="text-zinc-600">Analyzing contract...</span>
        )}
        {status === "running" && (
          <span className="inline-block w-1.5 h-4 bg-amber-400/80 ml-0.5 animate-blink align-text-bottom" />
        )}
      </div>

      {/* Footer */}
      {status === "done" && latencyMs != null && (
        <div className="px-4 py-1.5 border-t border-zinc-800/80 flex items-center justify-between bg-zinc-950/30 flex-shrink-0">
          <span className="text-[10px] text-zinc-500 font-mono">
            Completed in {(latencyMs / 1000).toFixed(1)}s
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {text.length.toLocaleString()} chars
          </span>
        </div>
      )}
    </div>
  )
}
