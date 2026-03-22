import React, { useReducer, useCallback } from "react"
import { ChallengePicker } from "./components/ChallengePicker"
import { Transcript } from "./components/Transcript"
import { OutcomeDisplay } from "./components/OutcomeDisplay"
import { EvidencePanel } from "./components/EvidencePanel"
import { PipelineTracker, type PipelineStep } from "./components/PipelineTracker"
import { AuditPanel } from "./components/AuditPanel"

// ---------- Data types ----------

export interface Turn {
  turnNumber: number
  agentId: string
  message: string
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
}

export interface VerificationData {
  status: "running" | "passed" | "failed" | "error"
  verdict?: string
  evidence?: string
  executionTimeMs?: number
}

export interface EscrowData {
  escrowId: string
  status: string
  txHash?: string
}

export interface IpfsData {
  cid: string
  url: string
}

export interface Outcome {
  outcome: "ACCEPTED" | "REJECTED" | "EXHAUSTED"
  totalTurns: number
  assignedSeverity?: string
  agreedSeverity?: string
  evidence?: string
  verification?: VerificationData | null
  escrow?: EscrowData | null
  ipfs?: IpfsData | null
}

// ---------- State & Actions ----------

const STEP_NAMES: Record<number, string> = {
  1: "Environment Setup",
  2: "Agent Identity",
  3: "TEE Attestation",
  4: "Protocol Registration",
  5: "Discovery",
  6: "LLM Audit",
  7: "Forge Verification",
  8: "Negotiation",
  9: "Settlement",
  10: "Post-Settlement",
}

function makeInitialSteps(): PipelineStep[] {
  return Array.from({ length: 10 }, (_, i) => ({
    step: i + 1,
    name: STEP_NAMES[i + 1],
    status: "pending" as const,
  }))
}

interface AppState {
  phase: "pick" | "running" | "done"
  roomId?: string
  challengeName?: string

  // Pipeline
  steps: PipelineStep[]

  // Identity & attestation
  identity?: { protocolAgentId: string; researcherAgentId: string }
  attestation?: { quote: string; rtmr3: string }

  // Audit
  auditModel: string
  auditText: string
  auditStatus: "running" | "done"
  auditLatencyMs?: number

  // Negotiation
  turns: Turn[]

  // Evidence
  verification: VerificationData | null
  escrow: EscrowData | null
  ipfs: IpfsData | null

  // Outcome
  outcome?: Outcome
}

const initialState: AppState = {
  phase: "pick",
  steps: makeInitialSteps(),
  auditModel: "",
  auditText: "",
  auditStatus: "running",
  turns: [],
  verification: null,
  escrow: null,
  ipfs: null,
}

type AppAction =
  | { type: "START_ROOM"; roomId: string; challengeName: string }
  | { type: "PHASE"; step: number; name: string; status: "start" | "done" | "error" }
  | { type: "IDENTITY"; data: { protocolAgentId: string; researcherAgentId: string } }
  | { type: "ATTESTATION"; data: { quote: string; rtmr3: string } }
  | { type: "REGISTRY"; data: { protocolId: string; metadataURI: string; maxBounty: string; txHash: string } }
  | { type: "DISCOVERY"; data: { protocolId: string; name: string; bounty: string; slotsScanned: number } }
  | { type: "AUDIT"; data: { status: "start" | "delta" | "done"; model: string; text?: string; latencyMs?: number } }
  | { type: "TURN"; data: Turn }
  | { type: "VERIFICATION"; data: VerificationData }
  | { type: "ESCROW"; data: EscrowData }
  | { type: "IPFS"; data: IpfsData }
  | { type: "OUTCOME"; data: Outcome }
  | { type: "REPUTATION"; data: { agentId: string; role: string; value: number; txHash: string } }
  | { type: "RESET" }

function updateStep(
  steps: PipelineStep[],
  stepNum: number,
  update: Partial<PipelineStep>,
): PipelineStep[] {
  return steps.map((s) =>
    s.step === stepNum ? { ...s, ...update } : s,
  )
}

function addStepDetail(
  steps: PipelineStep[],
  stepNum: number,
  detail: Record<string, string>,
): PipelineStep[] {
  return steps.map((s) =>
    s.step === stepNum
      ? { ...s, detail: { ...(s.detail ?? {}), ...detail } }
      : s,
  )
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "START_ROOM":
      return {
        ...initialState,
        phase: "running",
        roomId: action.roomId,
        challengeName: action.challengeName,
        steps: makeInitialSteps(),
      }

    case "PHASE": {
      const stepStatus =
        action.status === "start"
          ? "running"
          : action.status === "done"
            ? "done"
            : "error"

      return {
        ...state,
        steps: updateStep(state.steps, action.step, { status: stepStatus }),
      }
    }

    case "IDENTITY":
      return {
        ...state,
        identity: action.data,
        steps: addStepDetail(state.steps, 2, {
          protocol: action.data.protocolAgentId,
          researcher: action.data.researcherAgentId,
        }),
      }

    case "ATTESTATION":
      return {
        ...state,
        attestation: action.data,
        steps: addStepDetail(state.steps, 3, {
          "RTMR[3]": action.data.rtmr3,
        }),
      }

    case "REGISTRY":
      return {
        ...state,
        steps: addStepDetail(state.steps, 4, {
          protocol: action.data.protocolId,
          bounty: action.data.maxBounty,
          tx: action.data.txHash,
        }),
      }

    case "DISCOVERY":
      return {
        ...state,
        steps: addStepDetail(state.steps, 5, {
          name: action.data.name,
          bounty: action.data.bounty,
          scanned: String(action.data.slotsScanned),
        }),
      }

    case "AUDIT": {
      if (action.data.status === "start") {
        return {
          ...state,
          auditModel: action.data.model,
          auditText: "",
          auditStatus: "running",
          auditLatencyMs: undefined,
        }
      }
      if (action.data.status === "delta") {
        return {
          ...state,
          auditText: state.auditText + (action.data.text ?? ""),
        }
      }
      // done
      return {
        ...state,
        auditStatus: "done",
        auditLatencyMs: action.data.latencyMs,
        auditText: action.data.text != null ? state.auditText + action.data.text : state.auditText,
      }
    }

    case "TURN":
      return {
        ...state,
        turns: [...state.turns, action.data],
      }

    case "VERIFICATION":
      return {
        ...state,
        verification: action.data,
      }

    case "ESCROW":
      return {
        ...state,
        escrow: action.data,
      }

    case "IPFS":
      return {
        ...state,
        ipfs: action.data,
      }

    case "OUTCOME":
      return {
        ...state,
        phase: "done",
        outcome: action.data,
      }

    case "REPUTATION":
      return {
        ...state,
        steps: addStepDetail(state.steps, 10, {
          [action.data.role]: `${action.data.value}`,
          tx: action.data.txHash,
        }),
      }

    case "RESET":
      return initialState

    default:
      return state
  }
}

// ---------- Helpers ----------

/** Which step is currently running? Used to decide what the right column shows. */
function activeStepNumber(steps: PipelineStep[]): number | null {
  const running = steps.find((s) => s.status === "running")
  return running?.step ?? null
}

// ---------- WebSocket message handler ----------

/** Type-safe cast from unknown — we trust the backend schema. */
function as<T>(data: unknown): T {
  return data as T
}

function handleWsMessage(
  msg: { type: string; data: unknown },
  dispatch: React.Dispatch<AppAction>,
): void {
  switch (msg.type) {
    case "phase": {
      const d = as<{ step: number; name: string; status: "start" | "done" | "error" }>(msg.data)
      dispatch({ type: "PHASE", step: d.step, name: d.name, status: d.status })
      break
    }
    case "identity":
      dispatch({ type: "IDENTITY", data: as<{ protocolAgentId: string; researcherAgentId: string }>(msg.data) })
      break
    case "attestation":
      dispatch({ type: "ATTESTATION", data: as<{ quote: string; rtmr3: string }>(msg.data) })
      break
    case "registry":
      dispatch({ type: "REGISTRY", data: as<{ protocolId: string; metadataURI: string; maxBounty: string; txHash: string }>(msg.data) })
      break
    case "discovery":
      dispatch({ type: "DISCOVERY", data: as<{ protocolId: string; name: string; bounty: string; slotsScanned: number }>(msg.data) })
      break
    case "audit":
      dispatch({ type: "AUDIT", data: as<{ status: "start" | "delta" | "done"; model: string; text?: string; latencyMs?: number }>(msg.data) })
      break
    case "turn":
      dispatch({ type: "TURN", data: as<Turn>(msg.data) })
      break
    case "verification":
      dispatch({ type: "VERIFICATION", data: as<VerificationData>(msg.data) })
      break
    case "escrow":
      dispatch({ type: "ESCROW", data: as<EscrowData>(msg.data) })
      break
    case "ipfs":
      dispatch({ type: "IPFS", data: as<IpfsData>(msg.data) })
      break
    case "outcome":
      dispatch({ type: "OUTCOME", data: as<Outcome>(msg.data) })
      break
    case "reputation":
      dispatch({ type: "REPUTATION", data: as<{ agentId: string; role: string; value: number; txHash: string }>(msg.data) })
      break
  }
}

// ---------- Component ----------

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const handleStart = useCallback(async (challengeId: string, challengeName: string) => {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId }),
    })
    if (!res.ok) {
      alert(`Failed to create room: ${await res.text()}`)
      return
    }
    const { roomId } = (await res.json()) as { roomId: string }

    dispatch({ type: "START_ROOM", roomId, challengeName })

    // Connect WebSocket
    const wsUrl = `ws://${window.location.host}/ws/${roomId}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      const raw: unknown = JSON.parse(event.data)
      const msg = raw as { type: string; data: unknown }
      handleWsMessage(msg, dispatch)
    }

    ws.onerror = () => {
      pollRoom(roomId, challengeName)
    }
  }, [])

  const pollRoom = useCallback(async (roomId: string, challengeName: string) => {
    const poll = async () => {
      const res = await fetch(`/api/rooms/${roomId}`)
      if (!res.ok) return
      const data = await res.json()
      const turns = data.turns as Turn[]

      if (data.status === "finished") {
        // Replay turns
        for (const t of turns) {
          dispatch({ type: "TURN", data: t })
        }
        dispatch({
          type: "OUTCOME",
          data: {
            outcome: data.outcome,
            totalTurns: turns.length,
            assignedSeverity: data.assignedSeverity,
            agreedSeverity: data.agreedSeverity,
            evidence: data.evidence,
            verification: data.verification,
            escrow: data.escrow,
            ipfs: data.ipfs,
          },
        })
      } else {
        for (const t of turns) {
          dispatch({ type: "TURN", data: t })
        }
        if (data.verification) dispatch({ type: "VERIFICATION", data: data.verification })
        if (data.escrow) dispatch({ type: "ESCROW", data: data.escrow })
        if (data.ipfs) dispatch({ type: "IPFS", data: data.ipfs })
        setTimeout(poll, 1000)
      }
    }
    poll()
  }, [])

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" })
  }, [])

  const currentStep = activeStepNumber(state.steps)

  // Determine what the right column should show
  const showAudit = currentStep === 6 || (state.auditText && !state.turns.length)
  const showTranscript = state.turns.length > 0 || (currentStep !== null && currentStep >= 8)

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-emerald-400">mnemo</span>
          <span className="text-zinc-500 text-lg ml-2 font-normal">private negotiation demo</span>
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Watch a prover and verifier negotiate a bug disclosure in real-time.
        </p>
      </header>

      {/* Pick phase — full width */}
      {state.phase === "pick" && (
        <ChallengePicker onSelect={handleStart} />
      )}

      {/* Running / Done — two-column layout */}
      {state.phase !== "pick" && (
        <div>
          {/* Top bar */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-zinc-200">
              {state.challengeName}
            </h2>
            {state.phase === "running" ? (
              <span className="flex items-center gap-2 text-sm text-amber-400">
                <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Negotiating...
              </span>
            ) : (
              <button
                onClick={handleReset}
                className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                &larr; Back to challenges
              </button>
            )}
          </div>

          {/* Two-column grid */}
          <div className="flex gap-6">
            {/* Left column — Pipeline */}
            <div className="w-[300px] flex-shrink-0">
              <div className="sticky top-8">
                <PipelineTracker steps={state.steps} />
              </div>
            </div>

            {/* Right column — Main content */}
            <div className="flex-1 min-w-0">
              {state.phase === "running" && (
                <>
                  {/* Audit panel when step 6 is active or audit has content */}
                  {showAudit && (
                    <div className="mb-4">
                      <AuditPanel
                        model={state.auditModel || "..."}
                        text={state.auditText}
                        status={state.auditStatus}
                        latencyMs={state.auditLatencyMs}
                      />
                    </div>
                  )}

                  {/* Live evidence during verification/escrow */}
                  {(state.verification || state.escrow) && (
                    <EvidencePanel
                      verification={state.verification}
                      escrow={state.escrow}
                      ipfs={state.ipfs}
                    />
                  )}

                  {/* Transcript during negotiation */}
                  {showTranscript && (
                    <div className="mt-4">
                      <Transcript turns={state.turns} />
                    </div>
                  )}

                  {/* Idle state before any content appears */}
                  {!showAudit && !showTranscript && !state.verification && !state.escrow && (
                    <div className="text-zinc-600 text-center py-16 font-mono text-sm">
                      Pipeline starting...
                    </div>
                  )}
                </>
              )}

              {state.phase === "done" && state.outcome && (
                <>
                  {/* Show completed audit if we have it */}
                  {state.auditText && (
                    <div className="mb-4">
                      <AuditPanel
                        model={state.auditModel || "unknown"}
                        text={state.auditText}
                        status="done"
                        latencyMs={state.auditLatencyMs}
                      />
                    </div>
                  )}
                  <Transcript turns={state.turns} />
                  <OutcomeDisplay outcome={state.outcome} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
