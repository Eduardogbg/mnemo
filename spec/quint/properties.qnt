// Mnemo Protocol — Safety Invariants (v3: post-critique)
// Strengthened with real checks; context module wired in.

module properties {

  import types.* from "./types"
  import negotiation.* from "./negotiation"
  import context.* from "./context"

  // ─── INV 1: Heads lockstep ─────────────────────────────────────
  // Both agents always share the same head.

  val heads_lockstep: bool = {
    (status == Active) implies (heads.get(AgentA) == heads.get(AgentB))
  }

  // ─── INV 2: Heads are valid ───────────────────────────────────

  val heads_are_valid: bool = {
    (status == Active) implies (
      nodes.keys().contains(heads.get(AgentA))
    )
  }

  // ─── INV 3: Head/scope consistency ────────────────────────────
  // The node at head belongs to the current scope (or to main/promoted).

  val head_scope_consistent: bool = {
    (status == Active) implies (
      val headNode = nodes.get(heads.get(AgentA))
      headNode.scope_id == currentScope or
      headNode.scope_id == MAIN_SCOPE
    )
  }

  // ─── INV 4: Nesting limit ─────────────────────────────────────

  val nesting_limit: bool = {
    scopes.keys().forall(sid =>
      scopeDepth(sid, scopes) <= 2
    )
  }

  // ─── INV 5: Scope owner alternation ───────────────────────────
  // A nested scope's owner differs from its parent scope's owner.

  val scope_owner_alternation: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.parent_scope == MAIN_SCOPE) or
      not(scopes.keys().contains(s.parent_scope)) or
      (s.owner != scopes.get(s.parent_scope).owner)
    })
  }

  // ─── INV 6: Scope graph well-formedness ───────────────────────
  // parent_scope is MAIN_SCOPE or exists in scopes map.
  // entry_node exists in nodes map (unless scope is closed and nodes deleted).

  val scope_graph_valid: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.parent_scope == MAIN_SCOPE or scopes.keys().contains(s.parent_scope)) and
      (s.status == ScopeClosed or nodes.keys().contains(s.entry_node) or s.entry_node == NO_NODE)
    })
  }

  // ─── INV 7: Closed scopes have no nodes ───────────────────────
  // If a scope is closed, no node in the map belongs to it.
  // (Real destruction, not just hiding.)

  val closed_scope_no_nodes: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.status != ScopeClosed) or
      nodes.keys().forall(nid => nodes.get(nid).scope_id != sid)
    })
  }

  // ─── INV 8: Closed scopes have no reveal_data ─────────────────

  val closed_scope_no_reveal: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.status != ScopeClosed) or (s.reveal_data == "")
    })
  }

  // ─── INV 9: Close cascades ────────────────────────────────────
  // If a scope is closed, all nested scopes are also closed.

  val close_cascades: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.status == ScopeClosed) implies (
        scopes.keys().forall(child =>
          not(isNestedIn(child, sid, scopes)) or
          scopes.get(child).status != ScopeOpen
        )
      )
    })
  }

  // ─── INV 10: Promotion hygiene ─────────────────────────────────
  // After promotion, no node has scope_id == promoted scope.

  val promotion_hygiene: bool = {
    scopes.keys().forall(sid => {
      val s = scopes.get(sid)
      (s.status != ScopePromoted) or
      nodes.keys().forall(nid => nodes.get(nid).scope_id != sid)
    })
  }

  // ─── INV 11: Commit is clean ──────────────────────────────────

  val commit_is_clean: bool = {
    (status == Committed) implies (
      pendingConsent == [] and
      scopes.keys().forall(sid => scopes.get(sid).status != ScopeOpen)
    )
  }

  // ─── INV 12: Abort destroys state ─────────────────────────────

  val abort_destroys_state: bool = {
    (status == Aborted) implies (
      nodes.keys() == Set() and scopes.keys() == Set()
    )
  }

  // ─── INV 13: Active sessions have nodes ───────────────────────

  val active_has_nodes: bool = {
    (status == Active) implies (nodes.keys().size() > 0)
  }

  // ─── INV 14: Current scope is valid ───────────────────────────

  val current_scope_valid: bool = {
    (status == Active) implies (
      currentScope == MAIN_SCOPE or
      (scopes.keys().contains(currentScope) and
       scopes.get(currentScope).status == ScopeOpen)
    )
  }

  // ─── INV 15: No closed-scope content in context ───────────────
  // The headline claim: context reconstruction never includes
  // messages from closed scopes.

  val context_no_closed_scope_content: bool = {
    (status == Active) implies (
      val headId = heads.get(AgentA)
      val ctx = buildContext(AgentA, headId, nodes, scopes)
      // Every message in the context must NOT come from a closed scope node
      // We check indirectly: no message in ctx matches a message stored
      // in a node belonging to a closed scope
      val closedScopeMessages = nodes.keys().fold(Set(), (acc, nid) => {
        val node = nodes.get(nid)
        val inClosed = scopes.keys().exists(sid =>
          node.scope_id == sid and scopes.get(sid).status == ScopeClosed
        )
        if (inClosed and node.message != "") acc.union(Set(node.message))
        else acc
      })
      // Context messages should not contain any closed-scope message
      ctx.messages.foldl(true, (acc, m) =>
        acc and not(closedScopeMessages.contains(m))
      )
    )
  }

  // ─── Collected ─────────────────────────────────────────────────

  val all_invariants: bool = {
    heads_lockstep and
    heads_are_valid and
    head_scope_consistent and
    nesting_limit and
    scope_owner_alternation and
    scope_graph_valid and
    closed_scope_no_nodes and
    closed_scope_no_reveal and
    close_cascades and
    promotion_hygiene and
    commit_is_clean and
    abort_destroys_state and
    active_has_nodes and
    current_scope_valid and
    context_no_closed_scope_content
  }
}
