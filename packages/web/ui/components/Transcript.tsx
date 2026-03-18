import { useEffect, useRef } from "react"
import type { Turn } from "../App"

interface Props {
  turns: Turn[]
}

const agentColors: Record<string, { badge: string; border: string }> = {
  prover: { badge: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20", border: "border-emerald-400/20" },
  verifier: { badge: "bg-amber-400/10 text-amber-400 border-amber-400/20", border: "border-amber-400/20" },
}

export function Transcript({ turns }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns.length])

  if (turns.length === 0) {
    return (
      <div className="text-zinc-600 text-center py-8 font-mono text-sm">
        Waiting for first turn…
      </div>
    )
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
      {turns.map((turn) => {
        const colors = agentColors[turn.agentId] ?? { badge: "bg-zinc-800 text-zinc-400 border-zinc-700", border: "border-zinc-800" }
        return (
          <div
            key={turn.turnNumber}
            className={`animate-fade-in rounded-lg border ${colors.border} bg-zinc-900/50 p-4`}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${colors.badge}`}>
                {turn.agentId}
              </span>
              <span className="text-xs text-zinc-600">
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
                    className="flex items-center gap-2 text-xs font-mono rounded bg-zinc-800/50 px-2 py-1"
                  >
                    <span className="text-violet-400">⚡ {tc.name}</span>
                    <span className="text-zinc-500">
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
