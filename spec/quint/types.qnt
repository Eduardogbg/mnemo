// Mnemo Protocol — Shared Types (v2: Scope Model)

module types {

  // ─── Identifiers ───────────────────────────────────────────────

  type Agent = AgentA | AgentB

  type NodeId = int
  type ScopeId = int

  pure val NO_NODE: NodeId = -1
  pure val MAIN_SCOPE: ScopeId = 0   // main conversation, not inside any scope

  // ─── Session Status ────────────────────────────────────────────

  type SessionStatus = Active | Committed | Aborted

  // ─── Scope Status ──────────────────────────────────────────────

  type ScopeStatus = ScopeOpen | ScopeClosed | ScopePromoted

  // ─── Bilateral Operations ─────────────────────────────────────

  type ConsentOp =
    | PromoteOp(ScopeId)     // promote a scope to main
    | CommitOp               // finalize the deal

  type ConsentRequest = {
    proposer: Agent,
    op: ConsentOp,
  }

  // ─── Content ───────────────────────────────────────────────────

  type Content = str

  // ─── DAG Node ──────────────────────────────────────────────────

  type Node = {
    id: NodeId,
    parent: NodeId,           // NO_NODE for root
    scope_id: ScopeId,        // which scope this node belongs to
    message: Content,         // shared message content ("" if none)
    private_a: Content,       // A's private reasoning ("" if none)
    private_b: Content,       // B's private reasoning ("" if none)
  }

  // ─── Scope Metadata ───────────────────────────────────────────

  type Scope = {
    id: ScopeId,
    owner: Agent,             // who opened this scope (revealed)
    parent_scope: ScopeId,    // enclosing scope (MAIN_SCOPE = top level)
    entry_node: NodeId,       // node where scope was opened
    status: ScopeStatus,
    reveal_data: Content,     // the sensitive data that opened the scope
  }

  // ─── Helpers ───────────────────────────────────────────────────

  pure def otherAgent(a: Agent): Agent = {
    match a {
      | AgentA => AgentB
      | AgentB => AgentA
    }
  }

  // Scope nesting depth: 0 = main, 1 = top-level scope, 2 = nested scope
  pure def scopeDepth(sid: ScopeId, scopes: ScopeId -> Scope): int = {
    if (sid == MAIN_SCOPE) 0
    else {
      val s = scopes.get(sid)
      if (s.parent_scope == MAIN_SCOPE) 1
      else 2
    }
  }
}
