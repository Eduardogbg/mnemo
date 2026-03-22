/**
 * PipelineTracker — vertical step indicator for the 10-step Mnemo protocol.
 * Sits in the left column (~300px) and tells the story of the negotiation.
 */

export interface PipelineStep {
  step: number
  name: string
  status: "pending" | "running" | "done" | "error"
  detail?: Record<string, string>
}

interface Props {
  steps: PipelineStep[]
}

function truncateHash(hash: string, len = 10): string {
  if (hash.length <= len + 4) return hash
  return `${hash.slice(0, len)}...${hash.slice(-4)}`
}

function StatusIcon({ status }: { status: PipelineStep["status"] }) {
  switch (status) {
    case "done":
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-400/15 text-emerald-400 text-xs font-bold flex-shrink-0">
          &#10003;
        </span>
      )
    case "running":
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-amber-400 flex-shrink-0 animate-spin-slow">
          <span className="block w-1.5 h-1.5 bg-amber-400 rounded-full" />
        </span>
      )
    case "error":
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-400/15 text-red-400 text-xs font-bold flex-shrink-0">
          &#10005;
        </span>
      )
    default:
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full border border-zinc-700 flex-shrink-0">
          <span className="block w-1.5 h-1.5 bg-zinc-700 rounded-full" />
        </span>
      )
  }
}

function StepRow({ step }: { step: PipelineStep }) {
  const isActive = step.status === "running"
  const isDone = step.status === "done"
  const isError = step.status === "error"

  return (
    <div
      className={`
        flex items-start gap-3 px-3 py-2 rounded-md transition-colors
        ${isActive ? "bg-amber-400/5 border border-amber-400/20" : ""}
        ${isError ? "bg-red-400/5" : ""}
      `}
    >
      <StatusIcon status={step.status} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-mono ${
              isDone
                ? "text-zinc-400"
                : isActive
                  ? "text-amber-400 font-medium"
                  : isError
                    ? "text-red-400"
                    : "text-zinc-600"
            }`}
          >
            {step.step}.
          </span>
          <span
            className={`text-xs ${
              isDone
                ? "text-zinc-300"
                : isActive
                  ? "text-zinc-100 font-medium"
                  : isError
                    ? "text-red-300"
                    : "text-zinc-600"
            }`}
          >
            {step.name}
          </span>
        </div>

        {/* Detail key-value pairs */}
        {step.detail && Object.keys(step.detail).length > 0 && (
          <div className="mt-1 space-y-0.5">
            {Object.entries(step.detail).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-600 font-mono">{key}:</span>
                <span className="text-[10px] text-zinc-400 font-mono truncate">
                  {value.startsWith("0x") ? truncateHash(value) : value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PipelineTracker({ steps }: Props) {
  return (
    <div className="w-full">
      <h3 className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-3 px-3">
        Pipeline
      </h3>
      <div className="space-y-0.5">
        {steps.map((step) => (
          <StepRow key={step.step} step={step} />
        ))}
      </div>
    </div>
  )
}
