# Agentic Harness Landscape — Forking, Rollback & History Rewriting

> Research compiled 2026-03-12. Focus: frameworks with conversation forking, rewinding, or speculative execution.

---

## Key Finding

**No existing framework combines forking/rollback with privacy guarantees.** All treat conversation history as mutable for efficiency or UX, but none enforce that rolled-back state is cryptographically inaccessible to a counterparty. This confirms the gap identified in arXiv 2601.04583.

---

## 1. Kimi CLI — D-Mail / Steins;Gate (Moonshot AI)

**Closest conceptual match to Mnemo's forking primitive.**

- **Repo:** [github.com/MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli) (7.1k stars, Apache-2.0, Python/TypeScript)
- **Built by:** Moonshot AI

### How D-Mail works

1. System inserts `CHECKPOINT {id}` markers wrapped in `<system>` tags at key conversation points
2. When the agent decides a path was wrong, it invokes the `dmail` tool targeting a checkpoint ID
3. All messages after that checkpoint are **deleted**
4. A summary D-Mail message is appended — the agent's "past self" sees everything before the checkpoint + the condensed lesson, but none of the removed work
5. Conversation continues from there

### Key quote from their docs
> "Unlike the show, D-Mails don't alter the filesystem or external systems, only compress recent message history into a single, condensed message."

### Use cases (from their docs)
- Large files: D-Mail before reading, provide only relevant excerpts to past self
- Failed code: Revert to before the attempt, supply the working solution without replaying debugging
- Web searches: Compress results or redirect toward better queries

### Relevance to Mnemo
The D-Mail pattern is exactly "speculative execute, then rewind with summary." For negotiation: Agent A reveals pricing in a fork → deal fails → TEE rewinds to before the reveal, counterparty never sees it. **Critical difference:** Kimi is single-agent (messages itself). Mnemo needs this across two agents where the TEE enforces both sides roll back.

**Source code:** `src/kimi_cli/soul/context.py` (history/checkpoints), `src/kimi_cli/tools/dmail/` (tool impl)

---

## 2. Pi Harness (Mario Zechner / badlogic)

**Best technical pattern for tree-structured conversation state. 22.5k stars, genuinely good.**

- **Repo:** [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono) (22,562 stars, 2,386 forks, MIT, TypeScript)
- **Built by:** Mario Zechner. Also used inside OpenClaw (Armin Ronacher [wrote about it](https://lucumr.pocoo.org/2026/1/31/pi/))

### Architecture
Monorepo with clean layered design:
- **`pi-ai`** — Unified LLM API (Anthropic, OpenAI, Google, xAI, Groq, etc.). Handles streaming, tool calling via TypeBox schemas, cross-provider context handoff (e.g., Anthropic thinking traces → `<thinking>` tags for OpenAI).
- **`pi-agent-core`** — Agent loop: tool execution, validation, event streaming. Only ~4 files.
- **`pi-tui`** — Retained-mode terminal UI with differential rendering.
- **`pi-coding-agent`** — The CLI app. Session management, extensions, tools, themes.

System prompt is <1,000 tokens with only **4 core tools**: `read`, `write`, `edit`, `bash`. Genuinely minimalist — most competitors stuff 10-20 tools. Terminal-Bench 2.0 results show this works competitively.

### Session Format (JSONL DAG)
Each entry has:
- `id` — unique identifier (8-char hex)
- `parentId` — reference to parent (null for root)
- `type` — message, custom_message, compaction, branch_summary, thinking_level_change
- `timestamp`, `role`

Multiple entries can share the same `parentId`, creating branch points.

**Fork vs. Tree navigation:**
- **`/fork`** creates a *new session file* from a given entry point. Clean divergent conversation with `parentSession` linking back.
- **`/tree`** moves the leaf *within the same file*. Can attach a branch summary to condense the abandoned path before switching. Lightweight.

### Extension System (~25 event hooks)
The most complete extension API in any coding agent:
- **Event hooks:** `session_start`, `session_fork`, `context` (modify LLM messages before sending), `tool_call` (intercept/block tool execution), `tool_result` (modify outputs), `input` (transform user input), `before_agent_start`, `turn_start/end`, compaction lifecycle, etc.
- **Register:** new tools (with TypeBox schemas), slash commands, keyboard shortcuts, CLI flags, custom model providers (with OAuth)
- **Persist state:** `appendEntry(customType, data)` — stored in session JSONL but invisible to LLM. **Key insight (Armin Ronacher): extension state is versioned and forkable alongside the conversation.**
- **UI control:** dialogs, notifications, overlays, custom editors, footer/header widgets
- **Inter-extension communication** via shared EventBus

**Philosophy on MCP:** Pi explicitly rejects MCP as "overkill for most use cases" with "significant context overhead." A single popular MCP server can consume 7-9% of context window before work begins.

### What's actually good
1. **The session DAG is a real primitive.** Not just save/load — tree with navigation, forking, summarization of abandoned branches.
2. **Extension state co-located with session state.** When you fork, extension state forks too. When you rewind, extension state restores. Most agents treat extension state as global singletons.
3. **The minimalism is genuine.** 4 tools, <1,000 token system prompt. Each omission has a stated rationale.
4. **Cross-provider context handoff.** Switching models mid-session with automatic context transformation.
5. **Progressive JSON parsing** for streaming tool calls. Diffs appear as they generate.

### Limitations
- YOLO mode by default — no safety rails (valid for solo devs, not for adversarial multi-agent)
- No MCP limits ecosystem integration
- No sub-agents (manual via bash)
- Single-author opinion lock-in

### Relevance to Mnemo
Pi's JSONL DAG with `id`/`parentId` is the cleanest proven format for tree-structured conversation state. The `BranchSummaryEntry` concept maps to failed negotiation forks. Extension state co-location means when agents fork a negotiation, their private state forks too. **Adapt:** Pi's forks are visible to the user; in Mnemo, forks need per-agent visibility controls.

### Oh-My-Pi (can1357)
Fork of Pi adding hash-anchored edits (Hashline), subagents, LSP integration. Has `/branch` and `/fork` commands. Hashline gives every file line a content-hash anchor — edits are rejected if hashes don't match, preventing corruption. Interesting as a state integrity primitive.
- **Repo:** [github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)

### pi_agent_rust (Dicklesworthstone/pi_agent_rust)

**Rust rewrite of Pi. Impressive claims, skepticism warranted.**

- **Repo:** [github.com/Dicklesworthstone/pi_agent_rust](https://github.com/Dicklesworthstone/pi_agent_rust) (530 stars, 55 forks, Rust)
- **Built by:** Jeffrey Emanuel. Solo contributor, 2,395 commits in 5 weeks (~68/day).

**Performance claims (probably real, expected for Rust vs Node):**
- 4.95x faster session resume at 1M tokens (250ms vs 1,238ms)
- 12.14x lower memory (67.5MB vs 820.4MB)
- Benchmark methodology is rigorous (CPU governor locked, turbo disabled, p95/p99 reported)

**Security model (architecturally sound):**
- `#![forbid(unsafe_code)]` project-wide
- Extensions run in embedded QuickJS VM with capability-gated hostcalls
- Trust lifecycle: `pending → acknowledged → trusted → killed`
- Three policy profiles: safe / balanced / permissive
- Kill-switch with audit logs

**Red flags:**
- 68 commits/day for 35 days — not humanly possible without heavy AI generation
- 76 source files including `hostcall_trace_jit.rs`, `flake_classifier.rs` — over-engineering
- Custom async runtime (`asupersync`), custom Rich port (`rich_rust`) — NIH syndrome
- PAC-Bayes safety bounds, CUSUM regime-shift detection — graduate-level ML in a CLI agent
- `BENCHMARK_COMPARISON_BETWEEN_RUST_VERSION_AND_ORIGINAL__GPT.md` — GPT in the filename
- 105MB repo for a CLI tool
- Zero external contributors, 1 open issue

**Extension compatibility:** 224/224 vendored pass (differential oracle testing). But unvendored corpus (777 extensions) not yet validated.

**Honest assessment:** Technically impressive solo project showing what AI-assisted development produces in 5 weeks. Benchmarks are real, conformance testing is real, but complexity wildly exceeds requirements. Unsustainable maintenance burden.

**Relevance to Mnemo:** The capability-gated hostcall model and trust lifecycle are the right patterns for multi-agent negotiation rooms. The policy profiles (safe/balanced/permissive) map to room-level permission settings. Skip everything else.

---

## 3. LangGraph (LangChain)

**Most mature programmatic checkpoint/fork API.**

- **Docs:** [docs.langchain.com/oss/python/langgraph](https://docs.langchain.com/oss/python/langgraph/use-time-travel)
- **Open source:** Yes (LangChain ecosystem)

### Key features
- **Checkpointing:** Every graph step saved as `StateSnapshot`, organized into threads. Backends: SQLite, Postgres, DynamoDB, Couchbase.
- **Time Travel:** Rewind to any prior checkpoint and replay with modified state.
- **Forking:** `update_state()` creates a new checkpoint branching from a specified point. Original history intact.

```python
history = list(graph.get_state_history(config))
before_step = next(s for s in history if s.next == ("target_node",))
fork_config = graph.update_state(before_step.config, values={"topic": "new_value"})
fork_result = graph.invoke(None, fork_config)
```

- **Selective re-execution:** Nodes before checkpoint are cached; nodes after re-execute.

### Relevance to Mnemo
Good orchestration layer but no privacy concept. Could build Mnemo's forking on top of LangGraph's checkpoint system, but need to add: (a) per-agent state isolation, (b) TEE enforcement of rollback, (c) commitment/escrow integration.

---

## 4. LATS — Language Agent Tree Search (ICML 2024)

**Academic: Monte Carlo Tree Search over conversation trees.**

- **Paper:** [arxiv.org/abs/2310.04406](https://arxiv.org/abs/2310.04406)
- **Repo:** [github.com/lapisrocks/LanguageAgentTreeSearch](https://github.com/lapisrocks/LanguageAgentTreeSearch)

Uses MCTS (selection, expansion, evaluation, simulation, backpropagation, reflection) over LLM-generated conversation trees. Exploits the property that you can "reset to any step by copy-pasting historical text input."

### Relevance to Mnemo
A negotiation agent could use tree search to evaluate "what if I reveal X?" vs "what if I reveal Y?" before committing. But LATS is a reasoning pattern, not privacy infrastructure — operates within a single agent's context.

---

## 5. Sherlock (Microsoft Research)

**Speculative execution + selective rollback for multi-node agent workflows.**

- **Paper:** [arxiv.org/abs/2511.00330](https://arxiv.org/abs/2511.00330)

### Mechanism
- Proceeds to subsequent workflow nodes without waiting for verifier results (speculative execution)
- If verification fails (similarity below threshold), affected nodes roll back and recompute
- Uses counterfactual fault injection to identify error-prone nodes

**Performance:** 18.3% accuracy gain, up to 48.7% faster than non-speculative execution.

### Relevance to Mnemo
Architecturally similar — "proceed speculatively, roll back if verification fails" maps to "reveal info speculatively, roll back if negotiation fails." Proves the pattern works at scale for multi-node workflows. Paper only (not open source).

---

## Comparison

| Framework | Forking | Rollback | Tree State | Multi-Agent | Privacy | License |
|-----------|---------|----------|------------|-------------|---------|---------|
| **Kimi D-Mail** | Checkpoint-based | Revert + summarize | Linear with rewind | No | No | Apache-2.0 |
| **Pi** | JSONL tree | Branch switch | DAG (id/parentId) | No | No | Apache-2.0 |
| **LangGraph** | update_state() | Time travel | Checkpoints | Yes | No | Open source |
| **LATS** | MCTS tree | Backtrack | Search tree | No | No | Academic |
| **Sherlock** | No | Selective rollback | DAG workflow | Yes (workflow) | No | Paper only |

---

## 6. Helm (Ben Gubler / bgub)

**Elegant skills framework with two-tool discovery pattern.**

- **Repo:** [github.com/bgub/helm](https://github.com/bgub/helm) (57 stars, 0 forks, TypeScript, v0.2.0)
- **Blog:** [bengubler.com/posts/2026-02-25-introducing-helm](https://www.bengubler.com/posts/2026-02-25-introducing-helm)
- **Built by:** Ben Gubler. 2 weeks old.

### Core Insight
Inspired by Cloudflare's code mode for their MCP server: they reduced 2,500+ API endpoint tools to just 2, cutting token usage by 99.9%. Helm generalizes this.

### Architecture
Instead of stuffing N tools into context, expose just two:
- **`search(query)`** — discover available operations (returns names, signatures, descriptions)
- **`call(operation, args)`** — execute a specific operation with typed arguments

O(1) context cost regardless of how many capabilities exist.

### Key features
- **Skills** defined via `defineSkill()` with name, description, and typed operations
- **Builder pattern** — skills compose via `.use()` chains. TypeScript infers full type signature at each step.
- **Permission system** — per-operation levels (`allow`/`ask`/`deny`). Resolution hierarchy: exact match > wildcard > skill default > global default. `ask` level invokes `onPermissionRequest()` for runtime approval.
- **MCP exposure** — exposes itself as an MCP server, so any MCP-compatible agent can use it
- **Library, not framework** — use inside any agent

### Limitations
- Very early (57 stars, 0 forks, 2 weeks old, v0.2.0)
- No conversation/session management — skills layer only
- Built-in skills are basic (filesystem, git, grep, file editing)
- Zero dependencies = lean but untested

### Relevance to Mnemo
The two-tool pattern maps well to negotiation room capabilities. Instead of frontloading all actions into context, agents discover what's available (`make_offer`, `reveal_info`, `request_escrow`, `fork_conversation`) via search. The per-operation permission model maps to room rules: "reveal identity" (allow), "request escrow" (ask room admin), "access counterparty history" (deny).

---

## Comparison

| Framework | Forking | Rollback | Tree State | Multi-Agent | Privacy | Maturity |
|-----------|---------|----------|------------|-------------|---------|----------|
| **Kimi D-Mail** | Checkpoint-based | Revert + summarize | Linear with rewind | No | No | 7.1k stars |
| **Pi** | JSONL tree | Branch switch | DAG (id/parentId) | No | No | 22.5k stars |
| **pi_agent_rust** | JSONL tree (Pi compat) | Branch switch | DAG | No | No | 530 stars, solo |
| **LangGraph** | update_state() | Time travel | Checkpoints | Yes | No | Mature ecosystem |
| **LATS** | MCTS tree | Backtrack | Search tree | No | No | Academic |
| **Sherlock** | No | Selective rollback | DAG workflow | Yes (workflow) | No | Paper only |
| **Helm** | No | No | No | No | No | 57 stars, 2 weeks |

---

## Patterns Worth Stealing for Mnemo

1. **Kimi's D-Mail** — Cleanest "speculative execute → rewind with summary" pattern. Adapt for two-party negotiation where TEE enforces both sides roll back.
2. **Pi's JSONL DAG** — Proven format for tree-structured conversation state. `id`/`parentId` linking, `BranchSummaryEntry` for abandoned paths. Extension state co-located with conversation — when you fork, extension state forks too.
3. **Pi's extension hooks** — `context` hook (modify messages before LLM), `tool_call` interception (enforce negotiation rules), `appendEntry()` for persisting metadata alongside conversation (commitment logs, escrow state).
4. **Helm's two-tool discovery** — `search()` + `call()` for room capabilities instead of context-stuffing. Per-operation permissions for room rules.
5. **pi_agent_rust's capability model** — Trust lifecycle (`pending → acknowledged → trusted → killed`) for agent admission. Policy profiles (safe/balanced/permissive) as room-level settings. Kill-switch with audit logs.
6. **LangGraph's checkpoint API** — Most mature programmatic interface for forking state. Could serve as orchestration layer.
7. **Sherlock's speculative execution** — Proves the pattern works for multi-node workflows with verification gates → maps to negotiation rounds with commitment gates.

---

## Sources

- [Pi Mono — GitHub](https://github.com/badlogic/pi-mono)
- [Pi Session Docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [Oh-My-Pi — GitHub](https://github.com/can1357/oh-my-pi)
- [Mario Zechner's Blog Post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Armin Ronacher on Pi](https://lucumr.pocoo.org/2026/1/31/pi/)
- [Kimi CLI — GitHub](https://github.com/MoonshotAI/kimi-cli)
- [Kimi CLI D-Mail Docs](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/tools/dmail/dmail.md)
- [Kimi CLI Sessions Docs](https://moonshotai.github.io/kimi-cli/en/guides/sessions.html)
- [Kimi CLI Technical Deep Dive](https://llmmultiagents.com/en/blogs/kimi-cli-technical-deep-dive)
- [LangGraph Time Travel Docs](https://docs.langchain.com/oss/python/langgraph/use-time-travel)
- [LangGraph Persistence Docs](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LATS Paper (ICML 2024)](https://arxiv.org/abs/2310.04406)
- [LATS GitHub](https://github.com/lapisrocks/LanguageAgentTreeSearch)
- [Sherlock Paper](https://arxiv.org/abs/2511.00330)
- [Helm — GitHub](https://github.com/bgub/helm)
- [Introducing Helm](https://www.bengubler.com/posts/2026-02-25-introducing-helm)
- [pi_agent_rust — GitHub](https://github.com/Dicklesworthstone/pi_agent_rust)
- [Jeffrey Emanuel on X](https://x.com/doodlestein/status/2024526138102435934)
