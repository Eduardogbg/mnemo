# Pi Extension System — Technical Assessment for Mnemo

> Research compiled 2026-03-12. Evaluating whether Mnemo's 2-agent negotiation harness
> could be built as two Pi instances with a shared extension.

**Feasibility rating: 2/5 — Technically possible but fighting the framework.**

---

## Executive Summary

Pi's extension system is the most capable in any coding agent. It has the right
primitives (DAG sessions, custom entries, context hooks, headless mode) and the right
philosophy (minimalist, forkable state). But Pi is fundamentally a single-agent,
single-user system. Every architectural assumption — one session file, one LLM call per
user input, one agent's view of context — runs counter to Mnemo's two-agent shared-DAG
model. Building Mnemo on Pi would mean using Pi's excellent extension hooks to work
around Pi's incompatible session model. The effort exceeds building standalone.

---

## 1. Extension API Surface

### What Pi gives us

Pi's extension API has ~25 event hooks spanning the full agent lifecycle. The ones
relevant to Mnemo:

| Hook | What it does | Mnemo relevance |
|------|-------------|-----------------|
| `context` | Modify `AgentMessage[]` before LLM call | Could implement `buildContext()` — filter closed-scope nodes |
| `before_agent_start` | Inject messages, modify system prompt | Could inject protocol state, legal actions |
| `tool_call` | Intercept/block tool execution, return `{ block: true, reason }` | Could enforce protocol rules (block illegal actions) |
| `tool_result` | Modify tool results after execution | Could redact information based on scope visibility |
| `before_provider_request` | Inspect/replace the raw API payload | Last-chance context filtering before LLM sees it |
| `session_before_fork` / `session_fork` | Hook into fork operations | Could map to scope open/close |
| `input` | Transform user input before processing | Could intercept the other agent's messages |

### Can an extension intercept/modify context before the LLM?

**Yes.** The `context` hook receives `{ type: "context", messages: AgentMessage[] }` and
returns `{ messages: AgentMessage[] }`. The extension runner chains handlers:
`structuredClone(messages)` -> handler 1 -> handler 2 -> final messages sent to LLM.

This is powerful. An extension could walk the DAG, identify closed-scope nodes, and
strip them from the message array before the LLM sees them. This is exactly Mnemo's
`buildContext()`.

**Limitation:** The hook receives already-built messages. Pi's `buildSessionContext()`
has already walked the DAG and assembled messages. The extension would need to reverse-
engineer which messages belong to which scopes (by parsing scope markers or maintaining
a parallel index). It cannot modify the DAG walk itself — only filter the output.

### Can an extension add custom tools?

**Yes.** `pi.registerTool()` takes a full tool definition with TypeBox schema, execute
function, and optional custom rendering. Tools are LLM-callable immediately after
registration.

For Mnemo, this means we could register negotiation tools:

```typescript
pi.registerTool({
  name: "negotiate",
  parameters: Type.Object({
    action_type: StringEnum(["message", "open_scope", "close_scope", ...]),
    content: Type.Optional(Type.String()),
    scope_id: Type.Optional(Type.Number()),
  }),
  execute: async (id, params, signal, onUpdate, ctx) => {
    // Validate against protocol rules
    // Apply to shared state manager
    // Return result
  }
});
```

This works well. The `negotiate` tool maps cleanly to our single-tool design from
`harness-design.md` Section 5.

### Can an extension intercept tool call results?

**Yes.** The `tool_result` hook lets you modify `{ content, details, isError }`. Omitted
fields preserve current values. This could redact scope-sensitive information from tool
results, though this is less relevant for Mnemo (our tools are protocol actions, not
file operations).

---

## 2. Session Format — JSONL DAG

### Structure

Each session is a JSONL file. Entries have `id` (unique) and `parentId` (reference to
parent, null for root). Multiple entries can share the same `parentId`, creating branch
points. Entry types: `message`, `custom`, `custom_message`, `compaction`,
`branch_summary`, `model_change`, `thinking_level_change`, `label`, `session_info`.

### Can an extension modify the DAG structure?

**No direct mutation.** The session manager exposes a read-only interface to extensions
(`ReadonlySessionManager`). Extensions can:
- `getEntries()` — read all entries
- `getBranch()` — read current branch
- `getLeafId()` — read current leaf

Extensions can **append** entries (`pi.appendEntry(customType, data)`) but cannot delete,
reorder, or reparent existing entries. The DAG is append-only.

**This is a fundamental problem for Mnemo.** When a scope closes, Mnemo needs to
**delete** nodes from the DAG (invariant 7: "closed scopes have no nodes"). Pi's DAG
is immutable — you can only add, never remove. An extension would need to maintain a
parallel "logical DAG" in custom entries and use the `context` hook to reconstruct the
correct view, while Pi's actual DAG retains all entries including "deleted" ones.

### Can an extension add custom entry types?

**Yes.** `pi.appendEntry("mnemo-scope", { scopeId, owner, status })` stores a custom
entry in the JSONL. Custom entries (`type: "custom"`) do NOT participate in LLM context
by default. They are invisible to the LLM unless the extension explicitly injects them
via the `context` hook.

`custom_message` entries DO participate in LLM context and can have a `display` flag
for TUI rendering.

### Can an extension filter which entries the LLM sees?

**Yes, via the `context` hook.** But the filtering happens at the message level (after
`buildSessionContext()` has already assembled messages), not at the DAG walk level. The
extension receives `AgentMessage[]` and returns a filtered `AgentMessage[]`.

For Mnemo, this means: Pi walks the DAG and builds messages. Then our extension strips
messages belonging to closed scopes. This works but is **redundant** — Pi builds context
we immediately throw away, then we rebuild it our way. We're paying for two context
reconstructions per turn.

---

## 3. Custom Entry Types and State Persistence

### How `appendEntry()` works

```typescript
pi.appendEntry("mnemo-scope-state", {
  scopes: [...],
  currentScope: 0,
  pendingConsent: null,
  heads: { A: "node-5", B: "node-5" }
});
```

This appends a `{ type: "custom", customType: "mnemo-scope-state", data: {...} }` entry
to the JSONL. The entry has an `id` and `parentId` like all entries, placing it in the
DAG.

### Is it truly invisible to the LLM?

**Yes.** `buildSessionContext()` filters to message-type entries only. Custom entries
(`type: "custom"`) are excluded from the message array. The LLM never sees them unless
the extension explicitly injects their content via the `context` hook.

### Can this store protocol state?

**Yes, and this is one of Pi's genuine strengths.** We could store:
- Scope table (id, owner, parent_scope, status, entry_node)
- Current scope pointer
- Pending consent state
- Agent heads
- Per-node scope_id mappings

On `session_start`, the extension reconstructs state by iterating entries:

```typescript
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "mnemo-scope-state") {
      protocolState = entry.data;
    }
  }
});
```

The state is versioned in the JSONL alongside conversation entries. This is better than
a separate state file.

---

## 4. Fork Semantics — Does Extension State Fork?

### Armin Ronacher's claim

The harness-landscape.md quotes Armin: "extension state is versioned and forkable
alongside the conversation." This is derived from his blog post describing how custom
messages are "maintained in session files."

### What actually happens mechanically

**Forking** (`/fork`): Creates a **new JSONL file** from a given entry point, with
`parentSession` linking back. The new file contains the path from root to the fork
point. Custom entries on that path are included.

**Branching** (`/tree`): Moves the leaf pointer within the same file. The `getBranch()`
call walks from the new leaf to root, collecting entries on that path. Custom entries
on the branch path are included; custom entries on abandoned branches are not.

**So yes, extension state "forks" in the sense that:** if you stored a custom entry at
position X in the DAG, and you fork from X, the new session includes that entry. If you
stored it at position Y (after X), and you fork from X, the Y entry is not in the fork.

**This is passive co-location, not active state management.** The extension must
reconstruct its state by replaying custom entries from root to current leaf. There is no
"snapshot and restore" — it's event sourcing. This works for Mnemo's protocol state,
which is inherently event-sourced (each action produces a new state).

### The catch for Mnemo

Pi forks are single-user operations. When Pi forks, it creates a new session for the
same user/agent. Mnemo needs a "fork" where two agents share the same scope but see
different views. Pi's fork creates divergent sessions; Mnemo's scopes create divergent
*views* of the same session. These are different operations.

---

## 5. Multi-Instance Coordination

### The proposed architecture

Two Pi instances (one per agent) share state through a shared backend:

```
┌─────────┐         ┌──────────────┐         ┌─────────┐
│  Pi A   │◄───────►│  State Mgr   │◄───────►│  Pi B   │
│  (ext)  │  HTTP   │  (Redis/API) │  HTTP   │  (ext)  │
└─────────┘         └──────────────┘         └─────────┘
```

Each Pi instance runs a Mnemo extension that:
1. On turn start: fetches shared state from the state manager
2. In `context` hook: filters messages based on this agent's visibility
3. On tool call (`negotiate`): validates action, pushes to state manager
4. Appends state snapshot as custom entry for fork/resume support

### What the extension needs to do on each turn

```
1. before_agent_start:
   - Fetch shared DAG from state manager (HTTP)
   - Fetch legal actions for this agent
   - Inject protocol state into system prompt

2. context hook:
   - Receive Pi's auto-built messages (from local session)
   - DISCARD them entirely
   - Replace with messages built from shared DAG
   - Apply scope visibility filtering
   - Add private state section

3. tool_call hook (negotiate tool):
   - Validate action against protocol rules (or delegate to state manager)
   - POST action to state manager
   - If rejected: return { block: true, reason }

4. tool_result hook:
   - Append state snapshot as custom entry
   - Inject "other agent's response" for next turn
```

### Critical problem: Pi's session is the wrong data model

Each Pi instance maintains its own JSONL session. But the negotiation conversation is
**shared** — when Agent A sends a message, Agent B must see it. With two separate Pi
sessions, we need to:

1. Keep both sessions in sync (every shared message must appear in both)
2. Maintain per-agent private entries (only in that agent's session)
3. Handle scope closures (delete from both sessions — but Pi sessions are append-only)

The `context` hook solves visibility (we can show each agent the right messages). But
the underlying sessions diverge. Pi A's session has A's tool calls and thinking. Pi B's
session has B's. Neither has the full shared conversation.

**Options:**
- **(a) Use Pi sessions as local caches only.** The state manager holds the real DAG.
  The `context` hook discards Pi's session-built messages entirely and substitutes
  messages from the state manager. Pi's session becomes vestigial — we use it only for
  extension state persistence.
- **(b) Mirror messages.** After each turn, inject the other agent's message into this
  agent's Pi session via `pi.sendMessage()`. Both sessions contain the full shared
  conversation. Private state stays in custom entries. But this creates duplicate
  entries and the sessions still can't represent scope closures (append-only).

**Option (a) is the only viable approach.** But it means we're using Pi as a shell:
the session DAG, context building, and fork semantics are all bypassed. We use Pi for:
tool registration, the agent loop, headless mode, and the extension lifecycle. That's
~20% of Pi's value.

---

## 6. The `context` Hook as `buildContext()`

### Can the context hook implement Mnemo's context reconstruction?

**Yes, technically.** The hook receives `AgentMessage[]` and returns `AgentMessage[]`.
We can:

```typescript
pi.on("context", async (event, ctx) => {
  // Ignore Pi's built messages
  // Fetch shared DAG from state manager
  const sharedState = await fetch(`${STATE_MGR}/context/${agentId}`);
  const { visibleNodes, privateState, legalActions } = sharedState;

  // Build Mnemo-style context
  const messages: AgentMessage[] = [];
  messages.push(buildSystemPrompt(legalActions));
  for (const node of visibleNodes) {
    messages.push(nodeToMessage(node));
  }
  messages.push(buildPrivateStateMessage(privateState));

  return { messages };
});
```

### What this gives us

- Full control over what the LLM sees
- Scope-based filtering (skip closed-scope nodes)
- Per-agent visibility (each Pi instance's hook fetches its own view)
- Protocol state injection (legal actions, scope markers)

### What it costs

- Pi's native context building is wasted (we discard it)
- Pi's session DAG is not the source of truth (state manager is)
- Compaction, branch summaries, model change handling — all Pi features that operate
  on the session — are irrelevant because we bypass the session
- The extension is doing all the interesting work; Pi is just providing the LLM call
  plumbing and tool execution loop

---

## 7. Headless/API Mode

### Can Pi run without a TUI?

**Yes, three ways:**

1. **JSON mode** (`pi --mode json "prompt"`): Streams all events as JSONL to stdout.
   Read-only, single-shot.

2. **RPC mode** (`pi --mode rpc`): Full bidirectional JSON-RPC over stdin/stdout.
   Supports `prompt`, `steer`, `follow_up`, `get_state`, `fork`, `compact`, `bash`,
   `set_model`, etc. The extension UI sub-protocol handles dialog requests.

3. **SDK** (`createAgentSession(options)`): Programmatic TypeScript API. Returns an
   `AgentSession` with `prompt()`, `steer()`, `followUp()`, `subscribe()`. Supports
   in-memory sessions, custom tools, and extension loading.

### For Mnemo's autonomous turn loop

The **SDK mode** is the right choice. We'd create two `AgentSession` instances, each
with the Mnemo extension loaded, and drive them in an alternating loop:

```typescript
const sessionA = await createAgentSession({
  tools: [negotiateTool],
  customTools: [],
  sessionManager: SessionManager.inMemory(),
  // ... model config
});

const sessionB = await createAgentSession({ /* similar */ });

while (status === "active") {
  const agent = nextAgent();
  const session = agent === "A" ? sessionA : sessionB;
  const result = await session.prompt("Your turn. Decide your next action.");
  // Process result, update shared state
}
```

### Limitation: The "user message" assumption

Pi's agent loop expects a user message to trigger each turn. In Mnemo, there's no user —
the turn coordinator drives both agents. We'd need to inject a synthetic "user message"
each turn (e.g., "Your turn. The other agent said: ..."). This is awkward but workable.

The `input` hook can transform these synthetic messages, and `before_agent_start` can
inject additional context. But we're fighting Pi's human-in-the-loop assumption.

---

## 8. Key Limitation: Single-Agent Architecture

### The core problem

Pi assumes one conversation between one human and one LLM. Every component reflects this:

| Pi assumption | Mnemo requirement | Conflict |
|---------------|-------------------|----------|
| One session file | Shared DAG with per-agent views | Need external state manager |
| One agent sees everything | Per-agent visibility filtering | Extension must override context |
| Human triggers turns | Autonomous turn loop | Synthetic user messages |
| Fork = new session | Scope = filtered view of same session | Different primitives |
| Append-only DAG | Delete on scope close | Can't represent in Pi's model |
| One LLM call per input | Alternating agents | Two Pi instances needed |
| Extension state = local | Protocol state = shared | External sync required |

### How hard is "two Pi instances sharing the same DAG but with different visibility"?

**Hard enough that you'd be building a custom system with Pi as a dependency rather than
building on Pi.**

The shared state manager is Mnemo-specific (not Pi). The context reconstruction is
Mnemo-specific (the `context` hook overrides Pi's). The turn coordination is Mnemo-
specific. The protocol validation is Mnemo-specific. What Pi contributes:

1. The agent loop (call LLM, execute tools, handle streaming) — ~200 lines
2. Tool registration with TypeBox schemas — convenience, not essential
3. Headless SDK — saves writing our own stdin/stdout or HTTP wrapper
4. Extension lifecycle (load, error handling, event bus) — nice but not critical

We could get (1) by calling the Venice API directly. We could get (2) with 50 lines of
TypeBox. We could get (3) with a simple Node.js HTTP server. (4) is irrelevant for a
2-extension system.

---

## Specific Technical Blockers

### Blocker 1: Append-only DAG vs. scope deletion

Pi's JSONL is append-only. Mnemo's invariant 7 requires that closed scopes have no
nodes. An extension cannot delete entries from Pi's session. The workaround (maintain a
parallel logical DAG, ignore Pi's physical DAG) means Pi's session format provides no
value.

**Severity: High.** This alone means we can't use Pi's session as the source of truth.

### Blocker 2: No shared state between Pi instances

Two Pi instances have no native coordination mechanism. The `/control` extension Armin
mentioned is one Pi sending prompts to another — not shared state. For Mnemo, we need
both agents to operate on the same DAG with atomic actions. This requires an external
state manager, which is the majority of Mnemo's architecture.

**Severity: High.** The external state manager is ~600 LOC regardless of whether we
use Pi.

### Blocker 3: User-message-triggered turns

Pi's agent loop expects `prompt(userMessage)` to start each turn. In Mnemo's autonomous
negotiation, there's no user. We'd inject synthetic messages each turn, which pollutes
the conversation with "Your turn" noise. The `input` hook can transform these, but it's
a hack.

**Severity: Medium.** Workable but ugly.

### Blocker 4: Context hook ordering

The `context` hook fires after Pi builds context from its session. We'd discard Pi's
context and substitute our own. But if other extensions (accidentally loaded) also modify
context, the chain becomes unpredictable. We'd need to ensure our extension runs last
and is the sole authority.

**Severity: Low.** Solvable by controlling extension loading order.

### Blocker 5: Extension state is local, not shared

`appendEntry()` stores data in the local Pi session. Two Pi instances can't see each
other's custom entries. Protocol state (scopes, consent, heads) must be shared. The
state manager is the only option, which means `appendEntry()` is useful only for local
recovery/debugging, not for protocol coordination.

**Severity: Medium.** Reduces the value of Pi's state co-location feature.

---

## What Pi Gives Us for Free vs. What We'd Build

### Free from Pi

| Feature | LOC saved | Notes |
|---------|-----------|-------|
| Agent loop (LLM call, tool execution, streaming) | ~200 | But we override context building |
| Tool registration with TypeBox schemas | ~50 | Convenience only |
| Headless SDK / RPC mode | ~150 | Nice but a simple HTTP server suffices |
| Retry with exponential backoff | ~30 | Trivial to implement |
| Extension lifecycle & error handling | ~100 | Overkill for 1 extension |
| Model switching / provider abstraction | ~300 | Useful if we want to swap models |
| **Total** | **~830** | |

### Must build regardless

| Component | LOC estimate | Why Pi can't do this |
|-----------|-------------|---------------------|
| State manager (shared DAG, scopes, consent) | ~600 | Pi is single-agent |
| Context reconstruction (scope filtering) | ~200 | Override Pi's via hook |
| Action parser (XML tags) | ~100 | Mnemo-specific format |
| Turn coordinator | ~150 | Two-agent alternation |
| Protocol validation | ~200 | Mnemo-specific rules |
| Inter-instance HTTP transport | ~100 | Two Pi instances need sync |
| Synthetic user message injection | ~50 | Pi expects human input |
| **Total** | **~1,400** | |

### Standalone build (no Pi)

| Component | LOC estimate |
|-----------|-------------|
| State manager | ~600 |
| Context builder | ~200 |
| Action parser | ~100 |
| Turn coordinator | ~150 |
| LLM client (Venice, OpenAI-compatible) | ~80 |
| Protocol validation | ~200 |
| HTTP API (gateway) | ~150 |
| **Total** | **~1,480** |

**The delta is ~80 lines.** Pi saves ~830 LOC but forces ~1,400 LOC of workarounds and
glue. Standalone requires ~1,480 LOC of straightforward code that maps 1:1 to the Quint
spec. The Pi approach introduces a dependency (22k-star project, 170 releases, frequent
breaking changes) for negligible LOC savings.

---

## Comparison: Pi Extension vs. Standalone TypeScript

| Dimension | Pi extension approach | Standalone TypeScript |
|-----------|----------------------|---------------------|
| **LOC** | ~1,400 (extension + state mgr) + Pi dependency | ~1,480 (complete) |
| **Complexity** | High — fighting framework assumptions | Low — direct spec translation |
| **Dependencies** | Pi + its deps (inside TEE = risk) | `openai` npm package only |
| **Spec fidelity** | Indirect mapping through hooks | Direct 1:1 Quint -> TS |
| **Debugging** | Extension hooks, two Pi instances, state mgr | Simple function calls |
| **Hackathon risk** | Pi updates could break extension API | No external risk |
| **Demo appeal** | "Built on Pi" — name recognition | "Built from scratch" — shows depth |
| **Future flexibility** | Locked to Pi's session model | Full control over data model |
| **Context efficiency** | Double context build (Pi's + ours) | Single context build |
| **TEE footprint** | Pi + all dependencies | Minimal |

---

## The One Scenario Where Pi Makes Sense

If Mnemo's negotiation needed a **coding agent inside the room** — e.g., agents
negotiate over a code change, where one agent reads/edits files and the other reviews —
then Pi's tools (read, write, edit, bash) and context management become genuinely useful.
The negotiation harness would be an extension that adds protocol semantics on top of
Pi's existing coding capabilities.

But Mnemo's current design has agents negotiating over data/deals, not code. The LLM's
only tool is `negotiate` (protocol actions). Pi's file tools are irrelevant.

---

## Verdict

**Don't build Mnemo as a Pi extension.**

Pi is genuinely excellent software. Its extension API is the most complete in any coding
agent. The session DAG and custom entry system are the right primitives. But the single-
agent assumption is load-bearing — it's not a surface constraint you can work around with
hooks. It's baked into the session format (one JSONL, append-only, no visibility
filtering), the agent loop (one LLM, user-triggered turns), and the state model (local
session = source of truth).

The honest engineering assessment: building on Pi would produce a worse system with more
code, more complexity, and more dependencies than building standalone. Use Pi's patterns
(DAG with id/parentId, extension state co-location, minimalist tool set). Don't use Pi
the framework.

**Feasibility: 2/5.**
- 1/5 for the DAG/session model (fundamental mismatch)
- 3/5 for the extension hooks (powerful but bypassed)
- 4/5 for headless/SDK mode (works well)
- 2/5 for multi-instance coordination (not designed for this)
- 1/5 for scope deletion (append-only is a blocker)

---

## Sources

- [Pi Mono — GitHub](https://github.com/badlogic/pi-mono)
- [Pi Extension Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi Session Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [Pi SDK Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi JSON Mode Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/json.md)
- [Pi RPC Mode Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi Example Extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [Pi Agent Core — agent-loop.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts)
- [Pi Agent Core — agent.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent.ts)
- [Pi Session Manager](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- [Pi Extension Types](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [Armin Ronacher on Pi](https://lucumr.pocoo.org/2026/1/31/pi/)
