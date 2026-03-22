import { useEffect, useRef } from "react"
import type { Turn } from "../App"

interface Props {
  turns: Turn[]
}

const agentColors: Record<string, { badge: string; border: string; bg: string }> = {
  prover: {
    badge: "bg-blue-400/10 text-blue-400 ring-1 ring-blue-400/20",
    border: "border-blue-400/20",
    bg: "bg-blue-400/[0.03]",
  },
  verifier: {
    badge: "bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20",
    border: "border-amber-400/20",
    bg: "bg-amber-400/[0.03]",
  },
}

const defaultColors = {
  badge: "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700",
  border: "border-zinc-800",
  bg: "",
}

export function Transcript({ turns }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns.length])

  if (turns.length === 0) {
    return (
      <div className="text-zinc-600 text-center py-8 font-mono text-sm">
        Waiting for first turn...
      </div>
    )
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
      {turns.map((turn) => {
        const colors = agentColors[turn.agentId] ?? defaultColors
        return (
          <div
            key={turn.turnNumber}
            className={`animate-fade-in rounded-lg border ${colors.border} ${colors.bg} bg-zinc-900/50 p-4 ring-1 ring-zinc-800/50`}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${colors.badge}`}>
                {turn.agentId}
              </span>
              <span className="text-[10px] text-zinc-600 font-mono">
                Turn {turn.turnNumber}
              </span>
            </div>

            {/* Message */}
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono">
              {turn.message}
            </p>

            {/* Tool calls */}
            {turn.toolCalls.length > 0 && (
              <div className="mt-3 space-y-1">
                {turn.toolCalls.map((tc, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs font-mono rounded-lg bg-zinc-950/50 ring-1 ring-zinc-800 px-2.5 py-1.5"
                  >
                    <span className="text-violet-400">fn {tc.name}</span>
                    <span className="text-zinc-500 truncate">
                      {JSON.stringify(tc.args)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
