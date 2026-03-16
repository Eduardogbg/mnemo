# Mnemo Agent Harness — Architecture Design

> Design document for the runtime that manages agent turns, context reconstruction,
> and protocol enforcement inside a Phala TEE enclave.

## Table of Contents

1. [Overview](#1-overview)
2. [Build vs. Extend Decision](#2-build-vs-extend-decision)
3. [System Architecture](#3-system-architecture)
4. [Component Design](#4-component-design)
5. [LLM Interface Design](#5-llm-interface-design)
6. [Inter-Harness Communication](#6-inter-harness-communication)
7. [TEE Runtime](#7-tee-runtime)
8. [Turn Lifecycle](#8-turn-lifecycle)
9. [Trade-off Analysis](#9-trade-off-analysis)
10. [Open Questions](#10-open-questions)

---

## 1. Overview

The harness is the runtime that sits between the protocol state machine and the LLM.
Each negotiation has two harness instances (one per agent) coordinated by a shared
state manager. On every turn, the harness:

1. Reads the current DAG state (filtered for this agent's visibility)
2. Reconstructs the LLM prompt from visible nodes + private state
3. Calls the LLM (Venice API)
4. Parses the LLM response into a protocol action
5. Validates the action against protocol rules
6. Applies the action to the shared DAG (via the state manager)

The harness does NOT make decisions. The LLM decides what to do; the harness
enforces that the decision is legal and executes it.

---

## 2. Build vs. Extend Decision

### Option A: Extension on Pi's session DAG

Pi has the closest data model (JSONL DAG with `id`/`parentId`, fork/branch support,
extension state co-located with conversation state). Mnemo could be a Pi extension
that adds scope visibility, bilateral consent, and TEE enforcement.

**Why not:**
- Pi is single-agent, single-user. Its DAG is a conversation between one human and
  one LLM. Mnemo needs a DAG shared between two LLMs with per-agent visibility
  filtering. Retrofitting per-node visibility into Pi's session format requires
  modifying core session logic, not just writing an extension.
- Pi's extension hooks (`context`, `tool_call`, `appendEntry`) assume one LLM call
  per user input. Mnemo has an autonomous turn loop with no human in the loop during
  negotiation.
- Pi has no concept of bilateral consent or pending proposals.
- The session JSONL would need to be split into shared + private partitions, which
  breaks Pi's assumption that the session file is the single source of truth.

### Option B: Orchestration layer on LangGraph

LangGraph has checkpointing, forking via `update_state()`, and multi-agent support.
Mnemo's protocol could be modeled as a LangGraph graph with checkpoint-based scopes.

**Why not:**
- LangGraph checkpoints are opaque snapshots, not structured DAGs with node-level
  visibility. Implementing "skip closed-scope nodes" requires reaching into the
  checkpoint format rather than using the provided API.
- LangGraph's fork model is "branch from checkpoint with modified state." Mnemo's
  scope model is "open a transactional context that the owner can unilaterally retract,
  destroying all nested content." These are different primitives — LangGraph forks
  preserve both branches; Mnemo scope closures destroy one.
- LangGraph is Python-only. We want TypeScript for Phala SDK compatibility
  (`@phala/dstack-sdk` is TypeScript-native).
- Heavy dependency tree inside a TEE is an attack surface concern.

### Option C: Helm's two-tool discovery pattern

Expose protocol operations via `search()` + `call()` instead of individual tools.
This is an interface pattern, not an architecture — it can be adopted regardless of
the framework choice.

**Decision: adopt the pattern, not the framework.** (See Section 5.)

### Decision: Standalone harness

**Build a standalone, minimal harness in TypeScript.** Steal patterns, not frameworks:

| Pattern | Source | What we take |
|---------|--------|-------------|
| DAG with `id`/`parentId` | Pi | Node storage format |
| Extension state co-location | Pi | Private state stored alongside shared nodes |
| Two-tool discovery | Helm | Protocol operations exposed via search + call |
| Checkpoint prefix caching | LangGraph | Context reconstruction exploits KV cache prefixes |
| Speculative execute + rollback | Kimi D-Mail, Sherlock | The scope open/close pattern itself |

**Rationale:**
- The protocol is formally specified in Quint. The harness is a direct translation of
  `negotiation.qnt` + `context.qnt` into executable TypeScript. Adding a framework
  between the formal spec and the implementation creates a mapping layer that can
  introduce bugs the spec doesn't cover.
- The TEE environment is resource-constrained. A minimal harness with zero heavy
  dependencies fits better inside a CVM than LangGraph + LangChain + SQLAlchemy.
- The protocol is small. The entire state machine is ~360 lines of Quint. The harness
  (without LLM integration) is likely under 1,000 lines of TypeScript. Framework
  overhead dominates at this scale.

---

## 3. System Architecture

### Process Model

```
┌─ Phala CVM ──────────────────────────────────────────────────────┐
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    State Manager                             │ │
│  │                                                              │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │ │
│  │  │   DAG    │  │  Scopes  │  │  Consent  │  │  Session  │ │ │
│  │  │  Store   │  │  Table   │  │  Queue    │  │  Status   │ │ │
│  │  └──────────┘  └──────────┘  └───────────┘  └───────────┘ │ │
│  │                                                              │ │
│  │  API: applyAction(agent, action) -> Result                   │ │
│  │  API: getContext(agent) -> AgentContext                       │ │
│  │  API: getStatus() -> SessionStatus                           │ │
│  │                                                              │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                              │                                    │
│              ┌───────────────┴───────────────┐                   │
│              │                               │                   │
│  ┌───────────▼──────────┐     ┌──────────────▼─────────┐       │
│  │    Harness A          │     │    Harness B            │       │
│  │                       │     │                         │       │
│  │  ┌─────────────────┐ │     │ ┌─────────────────────┐ │       │
│  │  │  Private State   │ │     │ │  Private State       │ │       │
│  │  │  (goals, strat.) │ │     │ │  (goals, strat.)     │ │       │
│  │  └─────────────────┘ │     │ └─────────────────────┘ │       │
│  │                       │     │                         │       │
│  │  ┌─────────────────┐ │     │ ┌─────────────────────┐ │       │
│  │  │ Context Builder  │ │     │ │ Context Builder      │ │       │
│  │  └─────────────────┘ │     │ └─────────────────────┘ │       │
│  │                       │     │                         │       │
│  │  ┌─────────────────┐ │     │ ┌─────────────────────┐ │       │
│  │  │  Action Parser   │ │     │ │  Action Parser       │ │       │
│  │  └─────────────────┘ │     │ └─────────────────────┘ │       │
│  │                       │     │                         │       │
│  │  ┌─────────────────┐ │     │ ┌─────────────────────┐ │       │
│  │  │  LLM Client     │─┼──┐  │ │  LLM Client         │─┼──┐   │
│  │  └─────────────────┘ │  │  │ └─────────────────────┘ │  │   │
│  └──────────────────────┘  │  └─────────────────────────┘  │   │
│                             │                               │   │
└─────────────────────────────┼───────────────────────────────┼───┘
                              │                               │
                         HTTPS│                          HTTPS│
                              ▼                               ▼
                      ┌──────────────┐               ┌──────────────┐
                      │  Venice API  │               │  Venice API  │
                      │  (inference) │               │  (inference) │
                      └──────────────┘               └──────────────┘
```

### Why Three Processes, Not One

The state manager is a separate process (Docker container) from the two harnesses.
This enforces isolation at the OS level:

- **Harness A cannot read Harness B's private state.** They are separate processes
  with separate memory spaces. The state manager only returns agent-specific views.
- **The state manager is the single authority** on protocol rules. A compromised or
  buggy harness cannot corrupt the DAG — the state manager validates every action.
- **Maps to the Quint spec.** The state manager implements `negotiation.qnt`. Each
  harness implements `context.qnt` (for its own agent) plus the LLM integration.

An alternative is a single process with in-memory isolation (e.g., separate objects).
This works for a hackathon but loses the OS-level isolation guarantee. The three-process
model is correct; we can simplify to single-process for the prototype if needed.

### Why Not Two Processes (Agent Per Process, No State Manager)

If each agent manages its own copy of the DAG, they need to synchronize. This introduces
consensus problems: what if A applies a `closeScope` at the same time B sends a message
inside that scope? A central state manager with a single write lock eliminates this.
The protocol already assumes agents share the same head position (invariant 1 in the
formal spec: "heads lockstep"). A single state manager trivially enforces this.

---

## 4. Component Design

### 4.1 State Manager

Implements the negotiation state machine from `negotiation.qnt`. Holds all shared state.

```
Interface: StateManager

  // Query
  getContext(agent: Agent) -> AgentContext
  getStatus() -> SessionStatus
  getCurrentScope() -> ScopeId
  getPendingConsent() -> ConsentRequest | null

  // Mutation (all return Result<void, ProtocolError>)
  applyAction(agent: Agent, action: Action) -> Result

  // Action is one of:
  //   Message { content: string }
  //   OpenScope { data: string }
  //   CloseScope { scopeId: ScopeId }
  //   CancelConsent
  //   ProposePromote { scopeId: ScopeId }
  //   AcceptPromote
  //   RejectConsent
  //   ProposeCommit
  //   AcceptCommit
  //   Abort
```

**Internal data structures** (direct translation from `types.qnt`):

```
nodes:          Map<NodeId, Node>
scopes:         Map<ScopeId, Scope>
heads:          Map<Agent, NodeId>
currentScope:   ScopeId
status:         SessionStatus
pendingConsent: ConsentRequest | null
nextId:         number
```

**Concurrency model:** Single-threaded event loop (Node.js). Actions are serialized.
The turn coordinator (Section 4.4) ensures only one agent acts at a time.

**Persistence:** On every mutation, serialize state to the LUKS-encrypted Docker volume.
JSON is fine — the state is small (dozens of nodes, not thousands). On CVM restart,
deserialize from disk.

### 4.2 Context Builder

Implements `context.qnt`'s `buildContext()`. Runs inside each harness (not the state
manager) because it needs access to the agent's private state.

```
Interface: ContextBuilder

  buildPrompt(
    agentContext: AgentContext,   // from state manager (visible messages)
    privateState: PrivateState,  // local to this harness
    protocolHints: ProtocolHints // what actions are currently legal
  ) -> LLMMessage[]
```

The output is an array of messages in OpenAI chat format (system, user, assistant roles)
ready to send to Venice.

**Prompt structure:**

```
┌─────────────────────────────────────────────────────────┐
│ SYSTEM                                                   │
│                                                          │
│ You are Agent {A|B} in a Mnemo negotiation room.         │
│ {persona description from owner}                         │
│                                                          │
│ Available actions:                                       │
│   {list of currently legal actions with descriptions}    │
│                                                          │
│ Respond with exactly one action in the format:           │
│   <action type="..." ...>content</action>                │
├─────────────────────────────────────────────────────────┤
│ USER (reconstructed conversation)                        │
│                                                          │
│ [main] Agent A: "I have a dataset that might interest    │
│ you."                                                    │
│ [main] Agent B: "What domain?"                           │
│ [main] Agent A: "Financial derivatives, Q4 2025."        │
│   [scope-1, opened by A] Agent A reveals:                │
│   "Preview: 10,000 rows, columns: ticker, strike,       │
│    expiry, implied_vol, realized_vol"                     │
│   [scope-1] Agent B: "Interesting. What's your price?"   │
│     [scope-2, opened by B] Agent B reveals:              │
│     "$5,000 for the full dataset"                        │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ SYSTEM (private — only this agent sees this)             │
│                                                          │
│ Your private state:                                      │
│ - Goal: acquire dataset for under $3,000                 │
│ - Constraint: budget ceiling $4,500                      │
│ - Strategy: counter at $2,500, settle around $3,500      │
│ - Note from turn 3: A seems eager to sell, may accept    │
│   lower price                                            │
│                                                          │
│ Current protocol state:                                  │
│ - Active scope: scope-2 (owned by you)                   │
│ - Parent scope: scope-1 (owned by Agent A)               │
│ - You can: message, close_scope(2), propose_promote(2),  │
│   abort                                                  │
│ - You cannot: open_scope (max depth), close_scope(1)     │
│   (not owner)                                            │
└─────────────────────────────────────────────────────────┘
```

**Key design choices in context reconstruction:**

1. **Scope boundaries are explicit in the prompt.** The LLM sees `[scope-1, opened by A]`
   markers so it understands the transactional structure. Without these markers, the LLM
   cannot reason about which content is retractable.

2. **Legal actions are computed and listed.** Rather than forcing the LLM to understand
   all protocol rules, the harness computes which actions are currently legal and lists
   only those. This reduces the chance of the LLM attempting an illegal action.

3. **Private state is in a separate system message at the end.** This ensures the
   shared conversation is a strict prefix of the prompt. When a scope closes and nodes
   are removed, only the shared conversation portion changes — the system prompt prefix
   and the private state suffix are independent. This maximizes KV cache hit rate on
   the shared prefix.

4. **Closed-scope nodes are absent.** They are not present with a "redacted" marker.
   They are simply not there. The LLM sees a conversation that jumps from the scope
   entry point to whatever comes after, as if the scope never existed. This matches the
   Quint spec's `nodeVisible()` function.

### 4.3 Action Parser

Parses LLM output into a typed `Action` value.

```
Interface: ActionParser

  parse(raw: string) -> Result<Action, ParseError>
```

**Parsing strategy — XML tags with structured output fallback:**

Primary format (XML tags in free text):

```xml
I think we should counter-offer at a lower price.

<action type="message">
I appreciate the offer, but $5,000 is above our budget.
Would you consider $2,500 for the full dataset?
</action>
```

```xml
<action type="open_scope">
Here is a preview of our financial model showing
projected returns for this dataset.
</action>
```

```xml
<action type="close_scope" scope_id="2" />
```

```xml
<action type="propose_promote" scope_id="1" />
```

```xml
<action type="propose_commit">
Terms: Agent A delivers dataset (hash: 0xabc...) to Agent B.
Agent B pays $3,500 USDC to Agent A's wallet.
Delivery within 24 hours of commitment.
</action>
```

```xml
<action type="abort" />
```

**Why XML tags, not tool use or JSON:**

- **Tool use** requires the LLM provider to support function calling with the exact
  schema we need. Venice wraps open-weight models (DeepSeek, Qwen, Llama) whose tool
  calling support varies in quality. Structured XML is more robust across models.
- **JSON** is fragile in free-text output (unescaped quotes, trailing commas). XML
  tolerates surrounding prose naturally.
- **Special tokens** (e.g., `<|action|>`) require model fine-tuning. Not feasible for
  a hackathon.
- **Structured output / JSON mode** (Venice supports `response_format: { type: "json_object" }`)
  forces the entire response to be JSON, losing the agent's natural language reasoning
  that precedes the action. The reasoning is valuable as private state for future turns.

**Fallback behavior:**

If parsing fails (no valid `<action>` tag found):

1. First retry: re-prompt with "Your response must contain exactly one `<action>` tag.
   Here is what you said: {raw}. Please reformat."
2. Second retry: extract the most likely intent heuristically (e.g., if the response
   looks like a conversational message, wrap it as `Message`).
3. Third failure: the harness emits a default `Message` with the raw content, logged
   as a parse failure. The negotiation continues.

**Private reasoning extraction:**

Everything outside the `<action>` tag is captured as the agent's private reasoning
for this turn. It is stored in the node's `private_a` or `private_b` field and
included in future context reconstructions for that agent only.

```
LLM output:

  "Looking at Agent A's last message, they seem willing to negotiate.
   My budget allows up to $4,500 but I should start low.

   <action type="message">
   $5,000 is above what we can do. How about $2,500?
   </action>"

Parsed as:
  action = Message { content: "$5,000 is above what we can do. How about $2,500?" }
  private_reasoning = "Looking at Agent A's last message, they seem willing to
                       negotiate. My budget allows up to $4,500 but I should
                       start low."
```

### 4.4 Turn Coordinator

Manages the alternating turn loop. This is the top-level control flow.

```
Interface: TurnCoordinator

  run(config: NegotiationConfig) -> NegotiationResult
```

**Turn loop (pseudocode):**

```
initialize session (attestation, identity verification)
create root node in state manager

while status == Active:
    agent = nextAgent()          // alternating, or determined by pending consent

    // 1. Get visible context
    context = stateManager.getContext(agent)
    hints = computeLegalActions(agent, stateManager)

    // 2. Build prompt
    messages = contextBuilder.buildPrompt(context, privateState[agent], hints)

    // 3. Call LLM
    raw = await llmClient.chat(messages)

    // 4. Parse response
    { action, privateReasoning } = actionParser.parse(raw)

    // 5. Store private reasoning
    // (attached to the node created by the action, or to the current head
    //  if the action doesn't create a node — e.g., propose_promote)

    // 6. Apply action
    result = stateManager.applyAction(agent, action)

    if result.isError:
        // Action was illegal. Options:
        //   a) Re-prompt the LLM with error message (max 2 retries)
        //   b) Skip this agent's turn (dangerous — could deadlock)
        //   c) Force a default action (message with the LLM's raw text)
        handleIllegalAction(agent, action, result.error)

return stateManager.getFinalResult()
```

**Turn order:**

- During normal conversation: strict alternation (A, B, A, B, ...).
- When a bilateral proposal is pending: the next turn belongs to the non-proposing
  agent (they must accept, reject, or — if they are a scope owner — close their scope).
- After a scope close that cancels a pending proposal: turn returns to normal alternation,
  starting with the non-closing agent.

**Max turns:** Configurable safety limit (e.g., 50 turns). If reached, the coordinator
proposes abort to both agents. This prevents infinite negotiation loops.

### 4.5 LLM Client

Thin wrapper around Venice's OpenAI-compatible API.

```
Interface: LLMClient

  chat(messages: LLMMessage[]) -> string
  chatStream(messages: LLMMessage[]) -> AsyncIterator<string>
```

**Configuration:**

```
endpoint:    https://api.venice.ai/api/v1
model:       deepseek-v3.2  (cheapest: $0.40/1M input tokens)
apiKey:      from .env (injected into CVM via phala cvms create --env-file)
parameters:
  include_venice_system_prompt: false   // critical — no Venice system prompt injection
  temperature: 0.7                      // some creativity for negotiation
  max_tokens: 1024                      // cap response length
```

**Privacy considerations for prompts sent to Venice (standard inference):**

With standard Venice inference, the GPU processes plaintext prompts under policy-based privacy (anonymized, no logging). Venice also offers alpha E2EE/TEE inference with cryptographic guarantees; for production GPU-TEE, we use Redpill. To minimize information exposure with standard inference:

- Agent identities are referred to as "Agent A" and "Agent B" — no real identities.
- The system prompt does not mention the negotiation room ID, TEE attestation details,
  or on-chain identities.
- The conversation content itself is the unavoidable leak. The Venice assessment
  concluded this is acceptable because: (a) Venice strips identity metadata at the
  proxy, (b) each inference call is stateless — Venice sees individual turns, not
  the full negotiation DAG, (c) the real privacy enforcement is the TEE, not Venice.

**Error handling:**

- Network errors: retry with exponential backoff (max 3 retries).
- Rate limiting (`429`): backoff per `retry-after` header.
- Model errors: fall back to a secondary model (e.g., `llama-3.2-3b` for fast
  recovery).

---

## 5. LLM Interface Design — Exposing Protocol Operations

### Option A: Individual tools (function calling)

Define each protocol action as a tool:

```
tools: [
  { name: "message", parameters: { content: string } },
  { name: "open_scope", parameters: { data: string } },
  { name: "close_scope", parameters: { scope_id: number } },
  { name: "propose_promote", parameters: { scope_id: number } },
  { name: "propose_commit", parameters: { terms: string } },
  { name: "accept", parameters: {} },
  { name: "reject", parameters: {} },
  { name: "abort", parameters: {} },
  { name: "cancel_consent", parameters: {} },
]
```

**Pros:** Native tool calling is well-supported by frontier models. Structured output.
**Cons:** Venice routes to open-weight models with variable tool calling quality.
9 tools consumes context. The LLM might try to call multiple tools in one turn.

### Option B: Structured output (JSON mode)

Force the LLM to respond with JSON:

```json
{
  "reasoning": "They seem willing to negotiate...",
  "action": { "type": "message", "content": "How about $2,500?" }
}
```

**Pros:** Clean separation of reasoning and action. Easy to parse.
**Cons:** Forces `response_format: { type: "json_object" }` which some Venice models
may not support well. Loses the natural conversational flow of the reasoning.

### Option C: XML tags in free text (chosen)

As described in Section 4.3. The LLM writes natural prose (captured as private
reasoning) and embeds a single `<action>` tag.

**Pros:** Works with any model. Preserves natural reasoning. Robust parsing.
**Cons:** Requires a parser. LLM might omit the tag or produce malformed XML.

### Option D: Helm-style two-tool discovery

Expose only two tools: `search_actions()` and `do_action(type, params)`. The LLM
first searches to discover what's legal, then calls one.

**Pros:** O(1) context cost. The LLM explicitly asks what it can do before acting.
**Cons:** Doubles the LLM calls per turn (search + act). Adds latency. For a protocol
with only 9 possible actions, the discovery overhead isn't justified.

### Decision: Option C (XML tags) with Option D as enhancement

**Primary:** XML tags in free text. Simple, works with any model, captures reasoning.

**Enhancement for complex models:** If using a model with reliable tool calling, the
harness can optionally expose a single `negotiate` tool:

```
tools: [{
  name: "negotiate",
  parameters: {
    reasoning: string,     // private, stored as private_a/b
    action_type: enum,     // message | open_scope | close_scope | ...
    content: string?,      // for message, open_scope, propose_commit
    scope_id: number?,     // for close_scope, propose_promote
  }
}]
```

This is a single tool, not nine. The LLM always calls `negotiate` — the harness
dispatches based on `action_type`. This avoids the "which tool do I call?" ambiguity
while keeping structured output.

**The context builder includes a protocol state summary** listing legal actions
regardless of the parsing strategy. This is the key insight from Helm: don't make the
LLM memorize rules — tell it what's legal right now.

---

## 6. Inter-Harness Communication

### The Question

Two harnesses need to coordinate. They don't communicate directly — they share state
through the state manager. But what is the communication pattern?

### Architecture: Hub-and-Spoke via State Manager

```
                    ┌──────────────┐
                    │    State     │
          ┌────────│   Manager    │────────┐
          │        └──────────────┘        │
          │                                │
   getContext()                      getContext()
   applyAction()                     applyAction()
          │                                │
   ┌──────▼──────┐                 ┌───────▼─────┐
   │  Harness A  │                 │  Harness B  │
   └─────────────┘                 └─────────────┘
```

Harness A and Harness B never communicate directly. All coordination goes through the
state manager. This is essential because:

1. **The state manager enforces protocol rules.** If Harness A attempts an illegal
   action, the state manager rejects it. Harness B never sees it.
2. **The state manager controls visibility.** When Harness A calls `getContext(AgentA)`,
   it gets A's view (including A's private state from nodes). When Harness B calls
   `getContext(AgentB)`, it gets B's view. The state manager is the only component that
   holds the complete state.
3. **Serialization is trivial.** The state manager processes one action at a time.
   No concurrency issues, no distributed consensus.

### Transport Protocol

Within the same CVM, the harnesses communicate with the state manager over HTTP (Docker
Compose networking). The state manager exposes a REST API:

```
POST /action         { agent: "A"|"B", action: Action }  -> Result
GET  /context/:agent                                       -> AgentContext
GET  /status                                               -> SessionStatus
GET  /legal/:agent                                         -> LegalAction[]
```

**Why HTTP and not gRPC/WebSocket/shared memory:**

- HTTP is debuggable (curl from inside the CVM).
- The request rate is low (one request per agent turn — seconds apart).
- JSON payloads are small (kilobytes).
- No streaming needed — each request/response is atomic.

### External Communication (Entry/Exit)

Agents' owners (humans or other systems) interact with the Mnemo enclave from outside
the TEE:

```
┌─────────┐     HTTPS      ┌─────── CVM ──────────────────┐
│ Owner A │ ──────────────► │  API Gateway                  │
│         │ ◄────────────── │    ├─ POST /session/create    │
└─────────┘                 │    ├─ POST /session/:id/join  │
                            │    ├─ GET  /session/:id/status│
┌─────────┐     HTTPS      │    └─ GET  /session/:id/result│
│ Owner B │ ──────────────► │                               │
│         │ ◄────────────── │  (RA-TLS: TLS cert bound to  │
└─────────┘                 │   TEE attestation report)     │
                            └───────────────────────────────┘
```

The API gateway is a fourth container in the Docker Compose. It handles:
- Session creation and agent registration
- TEE attestation exchange (mutual verification before negotiation starts)
- ERC-8004 identity verification
- Injecting each agent's private configuration (goals, constraints, persona)
- Returning results after negotiation completes

**The owners do not interact during negotiation.** Once both agents are registered and
the session is active, the turn loop runs autonomously until commit or abort.

---

## 7. TEE Runtime

### Minimal Runtime Inside the CVM

```
┌─ docker-compose.yml ─────────────────────────────────────┐
│                                                           │
│  gateway:        (Node.js, ~200 LOC)                      │
│    - API for session lifecycle                            │
│    - RA-TLS termination                                   │
│    - ERC-8004 verification                                │
│                                                           │
│  state-manager:  (Node.js, ~600 LOC)                      │
│    - Protocol state machine                               │
│    - DAG storage                                          │
│    - Action validation                                    │
│    - Persistence to encrypted volume                      │
│                                                           │
│  harness-a:      (Node.js, ~400 LOC)                      │
│    - Context builder                                      │
│    - LLM client (Venice)                                  │
│    - Action parser                                        │
│    - Private state for Agent A                            │
│                                                           │
│  harness-b:      (Node.js, ~400 LOC)                      │
│    - Same image as harness-a, different env vars          │
│    - Private state for Agent B                            │
│                                                           │
│  (no redis — state is small enough for in-memory + disk)  │
│                                                           │
│  volumes:                                                 │
│    negotiation-data: (LUKS-encrypted, auto)               │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Total estimated code:** ~1,600 lines TypeScript (excluding tests).

### Dependencies

Minimal dependency tree for TEE security:

```
Runtime:
  - Node.js 22 (Alpine)          # base runtime
  - @phala/dstack-sdk             # key derivation, attestation
  - openai (npm)                  # Venice API client (OpenAI-compatible)

Dev only (not in container):
  - typescript
  - vitest (testing)
```

**No LangChain. No LangGraph. No heavyweight ORM.** Every additional dependency is
code running inside the TEE that we didn't write and didn't audit.

### Key Derivation

Each container derives its own keys via the dstack guest agent:

```
/mnemo/gateway/tls           -> TLS certificate for RA-TLS
/mnemo/state-manager/encrypt -> Encryption key for state persistence
/mnemo/harness-a/signing     -> Agent A's signing key (for on-chain settlement)
/mnemo/harness-b/signing     -> Agent B's signing key (for on-chain settlement)
```

These keys are deterministic (same app identity = same keys) and survive CVM restarts.

### Attestation Flow

Before negotiation begins:

```
1. Owner A connects to gateway via RA-TLS
   -> Verifies CVM is running expected Mnemo code (RTMR3 check)
   -> Submits Agent A's config (goals, constraints, persona, ERC-8004 identity)

2. Owner B connects to gateway via RA-TLS
   -> Same verification
   -> Submits Agent B's config

3. Gateway verifies both ERC-8004 identities on-chain

4. Gateway generates mutual attestation:
   -> CVM produces TDX quote with report_data = hash(agent_a_id || agent_b_id)
   -> Both owners can verify this quote

5. Session transitions to Active
   -> Turn loop begins
```

---

## 8. Turn Lifecycle

Complete lifecycle of a single agent turn:

```
  Turn Coordinator
       │
       │  1. Determine whose turn it is
       │
       ▼
  State Manager ──── getContext(agent) ────► AgentContext
       │                                     { messages: [...],
       │                                       private_state: [...] }
       │
       │  2. Also get legal actions
       │
  State Manager ──── getLegalActions(agent) ► LegalAction[]
       │                                     [message, open_scope, abort, ...]
       │
       ▼
  Context Builder ── buildPrompt() ─────────► LLMMessage[]
       │              (context + private       [system, user, system]
       │               state + legal actions)
       │
       ▼
  LLM Client ─────── chat(messages) ────────► raw string
       │              (Venice API call,         "I think we should...
       │               ~1-5 seconds)            <action type='message'>
       │                                        How about $2,500?
       │                                        </action>"
       ▼
  Action Parser ──── parse(raw) ────────────► { action: Message("How about..."),
       │                                        reasoning: "I think we should..." }
       │
       │  3. If parse fails: retry (max 2x)
       │
       ▼
  State Manager ──── applyAction(agent, action) ► Result<void, Error>
       │
       │  4. If action illegal: retry with error context (max 2x)
       │     If still failing: force Message with raw content
       │
       │  5. Store private reasoning on the new/current node
       │
       ▼
  State Manager ──── persist to disk
       │
       │  6. Check termination
       │     - status == Committed? -> return deal terms
       │     - status == Aborted?   -> return nothing (destroy state)
       │     - turn count > max?    -> force abort
       │
       ▼
  Next turn (other agent)
```

**Latency per turn:** Dominated by the Venice API call. Expected ~2-8 seconds
depending on model and response length. Everything else (context reconstruction,
parsing, state mutation) is <10ms.

**Total negotiation time:** For a 20-turn negotiation: ~1-3 minutes. Acceptable for
a hackathon demo.

---

## 9. Trade-off Analysis

### 9.1 Three Processes vs. Single Process

| | Three processes | Single process |
|---|---|---|
| **Isolation** | OS-level: harness A physically cannot read harness B's memory | Language-level: relies on encapsulation, a bug could leak |
| **Complexity** | Docker Compose networking, HTTP serialization | Simple function calls |
| **Debugging** | Harder (distributed logs) | Easier (single log stream) |
| **Performance** | HTTP overhead per turn (~1ms, negligible vs. LLM latency) | Zero overhead |
| **Spec fidelity** | Maps cleanly to formal spec's agent/state separation | Informal mapping |

**Recommendation:** Start with single process for hackathon prototype. The HTTP
interface can be internal function calls that return the same types. Migrate to
three processes for the demo if time permits — the interface is the same.

### 9.2 XML Tags vs. Tool Calling vs. JSON Mode

| | XML tags | Tool calling | JSON mode |
|---|---|---|---|
| **Model compatibility** | Any model | Varies by provider/model | Varies |
| **Reasoning capture** | Natural (prose outside tag) | Requires explicit `reasoning` param | Requires explicit field |
| **Parse reliability** | ~90% (need retries) | ~95% (model-dependent) | ~95% |
| **Context cost** | Low (instructions in system prompt) | Medium (tool schemas) | Low |
| **Venice support** | All models | Model-dependent | Model-dependent |

**Recommendation:** XML tags as primary, with a single-tool fallback for models that
support it. The parser should handle both.

### 9.3 Context Reconstruction: Full Replay vs. Diff

**Full replay** (chosen): On every turn, rebuild the entire prompt from root to head.

**Diff-based:** Only send the delta since the last turn (new message + updated
protocol state).

Full replay is correct and simple. The LLM is stateless — every call is independent.
Venice has no persistent session. The KV cache handles efficiency: the prefix (everything
before the new content) is cached at the inference provider. There is no benefit to
diff-based approaches with a stateless API.

### 9.4 State Manager: REST API vs. Function Calls vs. Message Queue

| | REST API | Function calls | Message queue |
|---|---|---|---|
| **When** | Multi-process | Single-process | Async patterns |
| **Ordering** | Synchronous (one action at a time) | Synchronous | Needs ordering guarantees |
| **Debugging** | curl-friendly | Breakpoints | Queue inspection |
| **Overhead** | ~1ms per call | ~0ms | ~1ms + broker |

**Recommendation:** Define the interface as TypeScript types. Implement as function
calls. Wrap in HTTP if/when we move to multi-process.

---

## 10. Open Questions

### 10.1 Who goes first?

The protocol spec doesn't define turn order — `step` in `negotiation.qnt` is
nondeterministic. For the harness, we need a rule. Options:
- **Always Agent A** (simple, arbitrary).
- **Configurable** (the session creator specifies).
- **Role-based** (e.g., the "buyer" always goes first).

Leaning toward: Agent A first, configurable.

### 10.2 How does the LLM learn the protocol?

The system prompt must teach the LLM about scopes, promotes, commits, etc. Two
approaches:
- **Minimal:** Just list available actions with one-line descriptions. Let the LLM
  figure out strategy.
- **Detailed:** Include a protocol primer explaining scopes, transactional semantics,
  consent model.

The detailed approach consumes more context but produces better decisions. For the
hackathon, context is cheap (DeepSeek V3.2 has 128K context). Include the primer.

### 10.3 What if the LLM never commits?

Agents could negotiate forever without reaching agreement. Mitigations:
- **Turn limit** (e.g., 50 turns). After limit: force abort.
- **Escalation prompt:** After N turns without progress, inject a system message
  urging resolution.
- **Owner intervention:** Allow owners to send a "wrap it up" signal that gets
  injected into the agent's next private state.

### 10.4 Private state initialization

Each agent's private state (goals, constraints, strategy) comes from the owner at
session creation. What format?

Leaning toward: free-form text. The owner writes natural language instructions, just
like a system prompt. The harness doesn't parse it — it passes it through to the LLM
as-is in the private state section of the prompt.

### 10.5 Commit terms format

When agents commit, they agree on deal terms. The protocol spec says "shared deal
terms, mutually approved." But what format?

Options:
- **Free text:** Each agent proposes terms in natural language. Both must approve the
  exact text.
- **Structured:** A JSON schema for deal terms (parties, obligations, amounts,
  deadlines). The harness validates the schema.

Leaning toward: free text for hackathon, structured for production. Free text is
simpler and lets the LLM express nuanced terms. Structured is better for on-chain
settlement (the escrow contract needs parseable amounts).

### 10.6 Scope close and the memory problem

After closing a scope, the LLM's next prompt doesn't contain the retracted content.
But the LLM weights may retain impressions from the previous turn (when the content
was visible). Venice's API is stateless (no persistent KV cache across calls), so the
model literally starts fresh each turn. But:

- If using a model with persistent memory/sessions (future Venice feature?), scope
  closure would need to invalidate the session.
- For the hackathon, this is a non-issue. Document it as a known limitation for
  production.

### 10.7 Single image or two images?

The Docker Compose has `harness-a` and `harness-b` as separate containers. Should
they be the same Docker image (configured via environment variables) or different?

**Same image** (recommended): reduces the build/deploy surface. `ROLE=agent-a` vs.
`ROLE=agent-b` environment variable determines which private state to load. The state
manager is a different image because it has different responsibilities.

---

## Appendix A: Mapping from Quint Spec to Harness Components

| Quint module | Harness component | Notes |
|---|---|---|
| `types.qnt` — `Agent`, `Node`, `Scope`, etc. | Shared TypeScript types | Direct 1:1 translation |
| `negotiation.qnt` — `message()`, `openScope()`, etc. | State Manager | Each action = one method |
| `negotiation.qnt` — preconditions (`status == Active`, etc.) | State Manager validation | Return `ProtocolError` if precondition fails |
| `negotiation.qnt` — `pendingConsent` | State Manager + Turn Coordinator | Coordinator routes turn to correct agent |
| `context.qnt` — `buildContext()` | Context Builder | Walk DAG, filter by visibility, format for LLM |
| `context.qnt` — `nodeVisible()` | Context Builder (or State Manager) | Filter closed-scope nodes |
| `context.qnt` — `pathToRoot()` | Context Builder | Walk parent pointers from head to root |
| `session.qnt` — lifecycle | Gateway + Turn Coordinator | Idle/Discovery/Handshake/Active/Done |
| `attestation.qnt` — mutual attestation | Gateway | Before session goes Active |
| `properties.qnt` — invariants | Test suite | Run invariant checks after each action in tests |

## Appendix B: Hackathon Scope Reduction

For the hackathon demo, cut:

1. **Multi-process architecture** -> Single Node.js process, in-memory state.
2. **Persistence** -> State lives in memory only. If CVM crashes, negotiation restarts.
3. **ERC-8004 verification** -> Hardcoded agent identities for demo.
4. **On-chain settlement** -> Log "would submit to Base" instead of actual transaction.
5. **Owner API** -> Hardcoded agent configs, no external API.
6. **Turn limits / escalation** -> Fixed 30-turn limit, then abort.

**What to keep:**
- The full protocol state machine (scopes, consent, cascade close).
- Context reconstruction with scope visibility.
- Venice API calls for real LLM inference.
- TEE deployment on Phala (even if simplified).
- The action parsing pipeline.

This gives a working demo of the novel primitive (scoped reveals with retraction)
without the infrastructure overhead of production features.
