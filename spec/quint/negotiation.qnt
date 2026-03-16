// Mnemo Protocol — Core Negotiation State Machine (v3: post-critique)
//
// Agent actions:
//   message        — unilateral, send a shared message
//   open_scope     — unilateral, reveal data and open a transactional scope
//   close_scope    — unilateral (owner only), retract scope; OVERRIDES pending consent
//   cancel_consent — unilateral (proposer only), withdraw own proposal
//   promote        — bilateral, make scope content permanent in parent scope
//   commit         — bilateral, finalize the deal
//   abort          — unilateral, destroy all state
//
// Key fixes from gpt-5.2 critique:
//   - closeScope overrides pendingConsent (no consent-freeze DoS)
//   - closeScope actually deletes nodes + wipes reveal_data (destroy, not hide)
//   - cancelConsent lets proposer withdraw own proposal
//   - Nested scope owner must differ from parent scope owner (alternation)

module negotiation {

  import types.* from "./types"

  // ─── State ─────────────────────────────────────────────────────

  var nodes: NodeId -> Node
  var heads: Agent -> NodeId
  var scopes: ScopeId -> Scope
  var currentScope: ScopeId
  var status: SessionStatus
  var pendingConsent: List[ConsentRequest]
  var nextId: int

  // ─── Initialization ────────────────────────────────────────────

  action init = all {
    nodes' = Map(0 -> {
      id: 0,
      parent: NO_NODE,
      scope_id: MAIN_SCOPE,
      message: "",
      private_a: "",
      private_b: "",
    }),
    heads' = Map(AgentA -> 0, AgentB -> 0),
    scopes' = Map(),
    currentScope' = MAIN_SCOPE,
    status' = Active,
    pendingConsent' = [],
    nextId' = 1,
  }

  // ─── Helpers ───────────────────────────────────────────────────

  pure def isOpen(sid: ScopeId, ss: ScopeId -> Scope): bool = {
    if (sid == MAIN_SCOPE) true
    else if (ss.keys().contains(sid)) ss.get(sid).status == ScopeOpen
    else false
  }

  // With max depth 2, nesting is always direct.
  pure def isNestedIn(child: ScopeId, parent: ScopeId, ss: ScopeId -> Scope): bool = {
    if (child == MAIN_SCOPE) false
    else if (not(ss.keys().contains(child))) false
    else ss.get(child).parent_scope == parent
  }

  // Owner of the current scope (or AgentA as default for main)
  pure def currentScopeOwner(cs: ScopeId, ss: ScopeId -> Scope): Agent = {
    if (cs == MAIN_SCOPE) AgentA  // no owner for main; value unused
    else ss.get(cs).owner
  }

  // ─── UNILATERAL: message ───────────────────────────────────────

  action message(agent: Agent, content: Content): bool = all {
    status == Active,
    pendingConsent == [],
    val parentId = heads.get(agent)
    val newNode = {
      id: nextId,
      parent: parentId,
      scope_id: currentScope,
      message: content,
      private_a: "",
      private_b: "",
    }
    all {
      nodes' = nodes.put(nextId, newNode),
      heads' = heads.set(agent, nextId).set(otherAgent(agent), nextId),
      scopes' = scopes,
      currentScope' = currentScope,
      status' = status,
      pendingConsent' = pendingConsent,
      nextId' = nextId + 1,
    }
  }

  // ─── UNILATERAL: open_scope ────────────────────────────────────
  // Reveal sensitive data, opening a new scope.
  // Max nesting: 2 levels. Nested scope owner must differ from parent.

  action openScope(agent: Agent, data: Content): bool = all {
    status == Active,
    pendingConsent == [],
    scopeDepth(currentScope, scopes) < 2,
    // Enforce owner alternation: can't nest inside your own scope
    (currentScope == MAIN_SCOPE) or (scopes.get(currentScope).owner != agent),
    val parentId = heads.get(agent)
    val newScopeId = nextId
    val newNodeId = nextId + 1
    val newScope = {
      id: newScopeId,
      owner: agent,
      parent_scope: currentScope,
      entry_node: parentId,
      status: ScopeOpen,
      reveal_data: data,
    }
    val newNode = {
      id: newNodeId,
      parent: parentId,
      scope_id: newScopeId,
      message: data,
      private_a: "",
      private_b: "",
    }
    all {
      nodes' = nodes.put(newNodeId, newNode),
      heads' = heads.set(agent, newNodeId).set(otherAgent(agent), newNodeId),
      scopes' = scopes.put(newScopeId, newScope),
      currentScope' = newScopeId,
      status' = status,
      pendingConsent' = pendingConsent,
      nextId' = nextId + 2,
    }
  }

  // ─── UNILATERAL: close_scope ───────────────────────────────────
  // Owner retracts their scope. ACTUALLY DELETES nodes inside it and
  // wipes reveal_data (not just hiding). Cascades to nested scopes.
  // OVERRIDES pending consent — owner can always retract.

  action closeScope(agent: Agent, scopeId: ScopeId): bool = all {
    status == Active,
    // NO pendingConsent guard — owner can ALWAYS close their scope
    scopeId != MAIN_SCOPE,
    scopes.keys().contains(scopeId),
    scopes.get(scopeId).owner == agent,
    scopes.get(scopeId).status == ScopeOpen,
    val scope = scopes.get(scopeId)
    val entryNode = scope.entry_node
    // Collect scope IDs to destroy (this scope + any nested)
    val scopesToDestroy = scopes.keys().filter(sid =>
      sid == scopeId or isNestedIn(sid, scopeId, scopes)
    )
    // Delete all nodes belonging to destroyed scopes
    val survivingNodeKeys = nodes.keys().filter(nid =>
      not(scopesToDestroy.contains(nodes.get(nid).scope_id))
    )
    val survivingNodes = survivingNodeKeys.fold(Map(), (acc, nid) =>
      acc.put(nid, nodes.get(nid))
    )
    // Wipe scope records: set status to Closed and clear reveal_data
    val updatedScopes = scopes.keys().fold(scopes, (acc, sid) =>
      if (scopesToDestroy.contains(sid))
        acc.set(sid, { ...acc.get(sid), status: ScopeClosed, reveal_data: "" })
      else
        acc
    )
    val parentScope = scope.parent_scope
    all {
      nodes' = survivingNodes,
      heads' = heads.set(AgentA, entryNode).set(AgentB, entryNode),
      scopes' = updatedScopes,
      currentScope' = parentScope,
      status' = status,
      // Auto-cancel any pending consent (owner retraction takes priority)
      pendingConsent' = [],
      nextId' = nextId,
    }
  }

  // ─── UNILATERAL: cancel_consent ────────────────────────────────
  // Proposer withdraws their own proposal.

  action cancelConsent(agent: Agent): bool = all {
    status == Active,
    pendingConsent.length() == 1,
    val req = pendingConsent[0]
    all {
      agent == req.proposer,
      nodes' = nodes,
      heads' = heads,
      scopes' = scopes,
      currentScope' = currentScope,
      status' = status,
      pendingConsent' = [],
      nextId' = nextId,
    }
  }

  // ─── BILATERAL: promote ────────────────────────────────────────
  // Make scope content permanent in its parent scope.
  // (If parent is main, content becomes permanent on main.
  //  If parent is another scope, content joins that scope.)

  action proposePromote(agent: Agent, scopeId: ScopeId): bool = all {
    status == Active,
    pendingConsent == [],
    scopeId != MAIN_SCOPE,
    scopes.keys().contains(scopeId),
    scopes.get(scopeId).status == ScopeOpen,
    currentScope == scopeId,
    // Nested scopes must be resolved first
    scopes.keys().forall(sid =>
      not(isNestedIn(sid, scopeId, scopes)) or
      scopes.get(sid).status != ScopeOpen
    ),
    all {
      nodes' = nodes,
      heads' = heads,
      scopes' = scopes,
      currentScope' = currentScope,
      status' = status,
      pendingConsent' = [{ proposer: agent, op: PromoteOp(scopeId) }],
      nextId' = nextId,
    }
  }

  action acceptPromote(agent: Agent): bool = all {
    status == Active,
    pendingConsent.length() == 1,
    val req = pendingConsent[0]
    all {
      agent == otherAgent(req.proposer),
      match req.op {
        | PromoteOp(scopeId) =>
            val scope = scopes.get(scopeId)
            val updatedScopes = scopes.set(scopeId, { ...scope, status: ScopePromoted })
            // Reparent nodes to parent scope
            val updatedNodes = nodes.keys().fold(nodes, (acc, nid) =>
              val node = acc.get(nid)
              if (node.scope_id == scopeId)
                acc.set(nid, { ...node, scope_id: scope.parent_scope })
              else
                acc
            )
            all {
              nodes' = updatedNodes,
              heads' = heads,
              scopes' = updatedScopes,
              currentScope' = scope.parent_scope,
              status' = status,
              pendingConsent' = [],
              nextId' = nextId,
            }
        | _ => all {
            nodes' = nodes, heads' = heads, scopes' = scopes,
            currentScope' = currentScope, status' = status,
            pendingConsent' = pendingConsent, nextId' = nextId,
          }
      }
    }
  }

  // ─── BILATERAL: commit ─────────────────────────────────────────
  // Finalize the deal. Must be on main (no open scopes).

  action proposeCommit(agent: Agent): bool = all {
    status == Active,
    pendingConsent == [],
    currentScope == MAIN_SCOPE,
    scopes.keys().forall(sid => scopes.get(sid).status != ScopeOpen),
    all {
      nodes' = nodes,
      heads' = heads,
      scopes' = scopes,
      currentScope' = currentScope,
      status' = status,
      pendingConsent' = [{ proposer: agent, op: CommitOp }],
      nextId' = nextId,
    }
  }

  action acceptCommit(agent: Agent): bool = all {
    status == Active,
    pendingConsent.length() == 1,
    val req = pendingConsent[0]
    all {
      agent == otherAgent(req.proposer),
      match req.op {
        | CommitOp => all {
            nodes' = nodes,
            heads' = heads,
            scopes' = scopes,
            currentScope' = currentScope,
            status' = Committed,
            pendingConsent' = [],
            nextId' = nextId,
          }
        | _ => all {
            nodes' = nodes, heads' = heads, scopes' = scopes,
            currentScope' = currentScope, status' = status,
            pendingConsent' = pendingConsent, nextId' = nextId,
          }
      }
    }
  }

  // ─── UNILATERAL: abort ─────────────────────────────────────────
  // Destroy all state. Works even with pending consent.

  action doAbort(agent: Agent): bool = all {
    status == Active,
    all {
      nodes' = Map(),
      heads' = Map(AgentA -> NO_NODE, AgentB -> NO_NODE),
      scopes' = Map(),
      currentScope' = MAIN_SCOPE,
      status' = Aborted,
      pendingConsent' = [],
      nextId' = nextId,
    }
  }

  // ─── BILATERAL: reject consent ─────────────────────────────────

  action rejectConsent(agent: Agent): bool = all {
    status == Active,
    pendingConsent.length() == 1,
    val req = pendingConsent[0]
    all {
      agent == otherAgent(req.proposer),
      nodes' = nodes,
      heads' = heads,
      scopes' = scopes,
      currentScope' = currentScope,
      status' = status,
      pendingConsent' = [],
      nextId' = nextId,
    }
  }

  // ─── Step: nondeterministic choice ─────────────────────────────

  action step = {
    nondet agent = Set(AgentA, AgentB).oneOf()
    nondet content = Set("msg1", "msg2", "msg3").oneOf()
    nondet data = Set("secret1", "secret2").oneOf()
    nondet scopeTarget = scopes.keys().union(Set(MAIN_SCOPE)).oneOf()
    any {
      message(agent, content),
      openScope(agent, data),
      closeScope(agent, scopeTarget),
      cancelConsent(agent),
      proposePromote(agent, scopeTarget),
      acceptPromote(agent),
      proposeCommit(agent),
      acceptCommit(agent),
      doAbort(agent),
      rejectConsent(agent),
    }
  }
}
