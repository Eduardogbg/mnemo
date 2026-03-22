import React, { useReducer, useCallback, useEffect, useRef } from "react"
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
  outcome: "ACCEPTED" | "REJECTED" | "EXHAUSTED" | "NO_VULNERABILITY"
  totalTurns: number
  assignedSeverity?: string
  agreedSeverity?: string
  evidence?: string
  verification?: VerificationData | null
  escrow?: EscrowData | null
  ipfs?: IpfsData | null
}

// ---------- Agent types ----------

type AgentStatus = "idle" | "scanning" | "analyzing" | "verifying" | "negotiating"

interface AgentLogEntry {
  message: string
  level: "info" | "warn" | "error"
  timestamp: number
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
  // Agent state
  agentStatus: AgentStatus
  agentProtocol?: string
  agentLogs: AgentLogEntry[]
  agentConnected: boolean

  // Room state
  phase: "watching" | "running" | "done"
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
  agentStatus: "idle",
  agentLogs: [],
  agentConnected: false,
  phase: "watching",
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
  // Agent actions
  | { type: "AGENT_CONNECTED" }
  | { type: "AGENT_STATUS"; status: AgentStatus; protocolId?: string }
  | { type: "AGENT_DISCOVERY"; protocolId: string; name: string; bounty: string }
  | { type: "AGENT_ROOM_CREATED"; roomId: string; challengeId: string }
  | { type: "AGENT_LOG"; message: string; level: "info" | "warn" | "error" }
  // Room actions
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
    // ── Agent actions ──
    case "AGENT_CONNECTED":
      return { ...state, agentConnected: true }

    case "AGENT_STATUS":
      return {
        ...state,
        agentStatus: action.status,
        agentProtocol: action.protocolId ?? state.agentProtocol,
      }

    case "AGENT_DISCOVERY":
      return {
        ...state,
        agentLogs: [
          ...state.agentLogs,
          { message: `Discovered protocol: ${action.name} (bounty: ${action.bounty})`, level: "info", timestamp: Date.now() },
        ],
      }

    case "AGENT_ROOM_CREATED":
      return {
        ...state,
        phase: "running",
        roomId: action.roomId,
        challengeName: action.challengeId,
        steps: makeInitialSteps(),
        auditModel: "",
        auditText: "",
        auditStatus: "running",
        turns: [],
        verification: null,
        escrow: null,
        ipfs: null,
        outcome: undefined,
        agentLogs: [
          ...state.agentLogs,
          { message: `Room created: ${action.roomId}`, level: "info", timestamp: Date.now() },
        ],
      }

    case "AGENT_LOG":
      return {
        ...state,
        agentLogs: [
          ...state.agentLogs,
          { message: action.message, level: action.level, timestamp: Date.now() },
        ].slice(-50), // keep last 50
      }

    // ── Room actions (same as before) ──
    case "START_ROOM":
      return {
        ...initialState,
        agentStatus: state.agentStatus,
        agentLogs: state.agentLogs,
        agentConnected: state.agentConnected,
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
      return { ...state, turns: [...state.turns, action.data] }

    case "VERIFICATION":
      return { ...state, verification: action.data }

    case "ESCROW":
      return { ...state, escrow: action.data }

    case "IPFS":
      return { ...state, ipfs: action.data }

    case "OUTCOME":
      return { ...state, phase: "done", outcome: action.data }

    case "REPUTATION":
      return {
        ...state,
        steps: addStepDetail(state.steps, 10, {
          [action.data.role]: `${action.data.value}`,
          tx: action.data.txHash,
        }),
      }

    case "RESET":
      return {
        ...initialState,
        agentStatus: state.agentStatus,
        agentLogs: state.agentLogs,
        agentConnected: state.agentConnected,
      }

    default:
      return state
  }
}

// ---------- Helpers ----------

function activeStepNumber(steps: PipelineStep[]): number | null {
  const running = steps.find((s) => s.status === "running")
  return running?.step ?? null
}

function as<T>(data: unknown): T {
  return data as T
}

function handleRoomWsMessage(
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

// ---------- Agent Status Display ----------

const AGENT_STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; glow: string }> = {
  idle: { label: "Scanning registry", color: "text-zinc-400", glow: "" },
  scanning: { label: "Polling registry", color: "text-amber-400", glow: "glow-amber" },
  analyzing: { label: "Analyzing contract", color: "text-blue-400", glow: "" },
  verifying: { label: "Running forge verification", color: "text-violet-400", glow: "" },
  negotiating: { label: "In negotiation", color: "text-emerald-400", glow: "glow-green" },
}

function AgentStatusBar({ status, protocol, logs, connected }: {
  status: AgentStatus
  protocol?: string
  logs: AgentLogEntry[]
  connected: boolean
}) {
  const cfg = AGENT_STATUS_CONFIG[status]
  const recentLogs = logs.slice(-5)

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connected ? (status === "idle" ? "bg-zinc-500" : "bg-emerald-400 animate-pulse") : "bg-red-400"} ${cfg.glow}`} />
          <span className="text-xs font-mono text-zinc-400">Autonomous Agent</span>
        </div>
        <span className={`text-xs font-mono ${cfg.color}`}>
          {connected ? cfg.label : "Disconnected"}
          {protocol && status !== "idle" && (
            <span className="text-zinc-600 ml-2">({protocol})</span>
          )}
        </span>
      </div>

      {recentLogs.length > 0 && (
        <div className="space-y-0.5 max-h-24 overflow-y-auto">
          {recentLogs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] font-mono">
              <span className="text-zinc-600 flex-shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={
                log.level === "error" ? "text-red-400" :
                log.level === "warn" ? "text-amber-400" :
                "text-zinc-500"
              }>
                {log.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Component ----------

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const roomWsRef = useRef<WebSocket | null>(null)

  // Connect to agent WebSocket on mount
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws/agent`
    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        dispatch({ type: "AGENT_CONNECTED" })
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as { type: string; data: unknown }

        switch (msg.type) {
          case "agent_status": {
            const d = msg.data as { status: AgentStatus; protocolId?: string }
            dispatch({ type: "AGENT_STATUS", status: d.status, protocolId: d.protocolId })
            break
          }
          case "agent_discovery": {
            const d = msg.data as { protocolId: string; name: string; bounty: string }
            dispatch({ type: "AGENT_DISCOVERY", protocolId: d.protocolId, name: d.name, bounty: d.bounty })
            break
          }
          case "agent_room_created": {
            const d = msg.data as { roomId: string; challengeId: string }
            dispatch({ type: "AGENT_ROOM_CREATED", roomId: d.roomId, challengeId: d.challengeId })

            // Auto-connect to the room's WebSocket
            if (roomWsRef.current) {
              roomWsRef.current.close()
            }
            const roomWs = new WebSocket(`ws://${window.location.host}/ws/${d.roomId}`)
            roomWsRef.current = roomWs
            roomWs.onmessage = (ev) => {
              const roomMsg = JSON.parse(ev.data) as { type: string; data: unknown }
              handleRoomWsMessage(roomMsg, dispatch)
            }
            break
          }
          case "agent_log": {
            const d = msg.data as { message: string; level: "info" | "warn" | "error" }
            dispatch({ type: "AGENT_LOG", message: d.message, level: d.level })
            break
          }
        }
      }

      ws.onclose = () => {
        // Reconnect after 3s
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
      roomWsRef.current?.close()
    }
  }, [])

  // Manual room creation (fallback — also connects to room WS)
  const handleManualStart = useCallback(async (challengeId: string, challengeName: string) => {
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

    if (roomWsRef.current) roomWsRef.current.close()
    const ws = new WebSocket(`ws://${window.location.host}/ws/${roomId}`)
    roomWsRef.current = ws
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as { type: string; data: unknown }
      handleRoomWsMessage(msg, dispatch)
    }
  }, [])

  const handleReset = useCallback(() => {
    if (roomWsRef.current) {
      roomWsRef.current.close()
      roomWsRef.current = null
    }
    dispatch({ type: "RESET" })
  }, [])

  const currentStep = activeStepNumber(state.steps)
  const showAudit = currentStep === 6 || (state.auditText && !state.turns.length)
  const showTranscript = state.turns.length > 0 || (currentStep !== null && currentStep >= 8)

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-950">
      {/* Top accent line */}
      <div className="h-[2px] bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500/0" />

      {/* Nav bar */}
      <nav className="border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-emerald-400">mnemo</span>
            </h1>
            <span className="text-zinc-600 text-sm font-normal hidden sm:inline">
              autonomous vulnerability discovery
            </span>
          </div>
          <div className="flex items-center gap-3">
            {state.phase === "running" && (
              <span className="flex items-center gap-2 text-xs font-mono text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full ring-1 ring-amber-400/20">
                <span className="inline-block w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse glow-amber" />
                Live
              </span>
            )}
            {state.phase === "done" && (
              <span className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full ring-1 ring-emerald-400/20">
                <span className="inline-block w-1.5 h-1.5 bg-emerald-400 rounded-full glow-green" />
                Complete
              </span>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Agent status bar — always visible */}
        <AgentStatusBar
          status={state.agentStatus}
          protocol={state.agentProtocol}
          logs={state.agentLogs}
          connected={state.agentConnected}
        />

        {/* Watching phase — agent is idle, show challenge picker for manual trigger */}
        {state.phase === "watching" && (
          <div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-400/10 flex items-center justify-center ring-1 ring-emerald-400/20 flex-shrink-0">
                  <span className="text-emerald-400 text-lg">&#9881;</span>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-zinc-200 mb-1">Autonomous Agent Active</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    The researcher agent is polling the on-chain registry for newly registered protocols.
                    When a protocol registers, the agent will autonomously scan its contracts, run an LLM audit,
                    verify with forge, and open a negotiation room if a vulnerability is found.
                  </p>
                  <p className="text-xs text-zinc-600 mt-2">
                    You can also manually trigger an audit below for testing.
                  </p>
                </div>
              </div>
            </div>
            <ChallengePicker onSelect={handleManualStart} />
          </div>
        )}

        {/* Running / Done — two-column layout */}
        {state.phase !== "watching" && (
          <div>
            {/* Room status bar */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 px-5 py-3 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-400/10 flex items-center justify-center ring-1 ring-emerald-400/20">
                  <span className="text-emerald-400 text-sm font-bold">#</span>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-zinc-200">
                    {state.challengeName}
                  </h2>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {state.roomId ? `room:${state.roomId}` : ""}
                  </span>
                </div>
              </div>
              {state.phase === "done" && (
                <button
                  onClick={handleReset}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg ring-1 ring-zinc-700"
                >
                  Back to agent
                </button>
              )}
            </div>

            {/* Two-column grid */}
            <div className="flex gap-6">
              {/* Left column — Pipeline */}
              <div className="w-[300px] flex-shrink-0">
                <div className="sticky top-20">
                  <PipelineTracker steps={state.steps} />
                </div>
              </div>

              {/* Right column — Main content */}
              <div className="flex-1 min-w-0 space-y-4">
                {state.phase === "running" && (
                  <>
                    {showAudit && (
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 overflow-hidden">
                        <AuditPanel
                          model={state.auditModel || "..."}
                          text={state.auditText}
                          status={state.auditStatus}
                          latencyMs={state.auditLatencyMs}
                        />
                      </div>
                    )}

                    {(state.verification || state.escrow) && (
                      <EvidencePanel
                        verification={state.verification}
                        escrow={state.escrow}
                        ipfs={state.ipfs}
                      />
                    )}

                    {showTranscript && (
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-5">
                        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4">
                          Negotiation Transcript
                        </h3>
                        <Transcript turns={state.turns} />
                      </div>
                    )}

                    {!showAudit && !showTranscript && !state.verification && !state.escrow && (
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 py-16">
                        <div className="text-zinc-600 text-center font-mono text-sm">
                          Pipeline starting...
                        </div>
                      </div>
                    )}
                  </>
                )}

                {state.phase === "done" && state.outcome && (
                  <>
                    {state.auditText && (
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 overflow-hidden">
                        <AuditPanel
                          model={state.auditModel || "unknown"}
                          text={state.auditText}
                          status="done"
                          latencyMs={state.auditLatencyMs}
                        />
                      </div>
                    )}
                    {state.turns.length > 0 && (
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-lg shadow-black/20 p-5">
                        <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4">
                          Negotiation Transcript
                        </h3>
                        <Transcript turns={state.turns} />
                      </div>
                    )}
                    <OutcomeDisplay outcome={state.outcome} />
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
