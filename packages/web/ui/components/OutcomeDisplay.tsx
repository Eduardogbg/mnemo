import type { Outcome } from "../App"
import { EvidencePanel } from "./EvidencePanel"

interface Props {
  outcome: Outcome
}

const outcomeConfig: Record<string, { label: string; color: string; bg: string }> = {
  ACCEPTED: { label: "Accepted", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
  REJECTED: { label: "Rejected", color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  EXHAUSTED: { label: "Exhausted", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
}

const severityConfig: Record<string, { color: string }> = {
  critical: { color: "text-red-400" },
  high: { color: "text-orange-400" },
  medium: { color: "text-amber-400" },
  low: { color: "text-zinc-400" },
}

export function OutcomeDisplay({ outcome }: Props) {
  const config = outcomeConfig[outcome.outcome] ?? outcomeConfig.EXHAUSTED

  return (
    <div>
      <div className={`mt-6 rounded-lg border p-5 ${config.bg}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className={`text-lg font-bold ${config.color}`}>
                {config.label}
              </span>
              {outcome.agreedSeverity && (
                <span className={`text-sm font-mono font-medium ${severityConfig[outcome.agreedSeverity]?.color ?? "text-zinc-400"}`}>
                  {outcome.agreedSeverity.toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {outcome.totalTurns} turn{outcome.totalTurns !== 1 ? "s" : ""}
              {outcome.assignedSeverity && !outcome.agreedSeverity && (
                <span> · Assigned: {outcome.assignedSeverity} (not agreed)</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <EvidencePanel
        evidence={outcome.evidence}
        verification={outcome.verification}
        escrow={outcome.escrow}
        ipfs={outcome.ipfs}
      />
    </div>
  )
}
