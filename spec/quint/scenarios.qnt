// Mnemo Protocol — Test Scenarios (v3: post-critique)
// Includes edge cases identified by gpt-5.2 review.

module scenarios {

  import types.* from "./types"
  import negotiation.* from "./negotiation"

  // ─── Scenario 1: Simple message exchange + commit ──────────────

  run simpleCommitTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(message(AgentB, "msg2"))
      .then(proposeCommit(AgentA))
      .then(acceptCommit(AgentB))
      .then(all {
        assert(status == Committed),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 2: Open scope, close (retract with real deletion) ─
  // After close: nodes inside scope are GONE from the map.

  run openCloseDeletesTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(openScope(AgentA, "secret1"))
      .then(message(AgentB, "msg2"))
      .then(closeScope(AgentA, 2))
      .then(all {
        assert(currentScope == MAIN_SCOPE),
        assert(heads.get(AgentA) == 1),
        assert(scopes.get(2).status == ScopeClosed),
        assert(scopes.get(2).reveal_data == ""),
        // Nodes 3 (reveal) and 4 (msg) should be deleted
        assert(not(nodes.keys().contains(3))),
        assert(not(nodes.keys().contains(4))),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 3: Open scope, promote, commit ──────────────────

  run openPromoteCommitTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(openScope(AgentA, "secret1"))
      .then(message(AgentB, "msg2"))
      .then(proposePromote(AgentA, 2))
      .then(acceptPromote(AgentB))
      .then(proposeCommit(AgentA))
      .then(acceptCommit(AgentB))
      .then(all {
        assert(status == Committed),
        assert(scopes.get(2).status == ScopePromoted),
        // Promoted nodes should have been reparented to MAIN_SCOPE
        assert(nodes.get(3).scope_id == MAIN_SCOPE),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 4: Nested scopes — cascade close ────────────────
  // A opens scope, B counter-reveals inside (alternating owners).
  // A closes outer scope — both scopes destroyed, nodes deleted.
  //
  // init:          node 0, nextId=1
  // msg(A):        node 1, nextId=2
  // openScope(A):  scope 2, node 3, nextId=4
  // openScope(B):  scope 4, node 5, nextId=6  (B != A: alternation OK)
  // msg(A):        node 6, nextId=7
  // closeScope(A, 2): cascades

  run nestedScopeCascadeTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(openScope(AgentA, "secret1"))
      .then(openScope(AgentB, "secret2"))
      .then(message(AgentA, "msg2"))
      .then(closeScope(AgentA, 2))
      .then(all {
        assert(scopes.get(2).status == ScopeClosed),
        assert(scopes.get(4).status == ScopeClosed),
        assert(scopes.get(2).reveal_data == ""),
        assert(scopes.get(4).reveal_data == ""),
        assert(currentScope == MAIN_SCOPE),
        assert(heads.get(AgentA) == 1),
        // All scope nodes deleted
        assert(not(nodes.keys().contains(3))),
        assert(not(nodes.keys().contains(5))),
        assert(not(nodes.keys().contains(6))),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 5: B closes inner scope, A's outer survives ─────

  run innerScopeCloseTest = {
    init
      .then(openScope(AgentA, "secret1"))
      .then(openScope(AgentB, "secret2"))
      .then(closeScope(AgentB, 3))
      .then(all {
        assert(scopes.get(1).status == ScopeOpen),
        assert(scopes.get(3).status == ScopeClosed),
        assert(currentScope == 1),
        assert(heads.get(AgentA) == 2),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 6: Abort mid-scope ──────────────────────────────

  run abortMidScopeTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(openScope(AgentA, "secret1"))
      .then(doAbort(AgentB))
      .then(all {
        assert(status == Aborted),
        assert(nodes.keys() == Set()),
        assert(scopes.keys() == Set()),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 7: Reject promote, then close ───────────────────

  run rejectPromoteTest = {
    init
      .then(openScope(AgentA, "secret1"))
      .then(message(AgentB, "msg1"))
      .then(proposePromote(AgentA, 1))
      .then(rejectConsent(AgentB))
      .then(closeScope(AgentA, 1))
      .then(all {
        assert(status == Active),
        assert(scopes.get(1).status == ScopeClosed),
        assert(currentScope == MAIN_SCOPE),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 8: CONSENT-FREEZE FIX — closeScope overrides pending ─
  // B proposes promote on A's scope. A closes scope anyway.
  // This was the DoS bug: previously A was blocked.

  run consentFreezeFixTest = {
    init
      .then(openScope(AgentA, "secret1"))
      .then(message(AgentB, "msg1"))
      .then(proposePromote(AgentB, 1))
      // A closes their scope even though B's promote is pending
      .then(closeScope(AgentA, 1))
      .then(all {
        assert(scopes.get(1).status == ScopeClosed),
        assert(pendingConsent == []),
        assert(currentScope == MAIN_SCOPE),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 9: cancelConsent — proposer withdraws ────────────

  run cancelConsentTest = {
    init
      .then(message(AgentA, "msg1"))
      .then(proposeCommit(AgentA))
      .then(cancelConsent(AgentA))
      .then(all {
        assert(pendingConsent == []),
        assert(status == Active),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }

  // ─── Scenario 10: Abort while consent pending ─────────────────

  run abortWhileConsentPendingTest = {
    init
      .then(openScope(AgentA, "secret1"))
      .then(proposePromote(AgentA, 1))
      .then(doAbort(AgentB))
      .then(all {
        assert(status == Aborted),
        assert(nodes.keys() == Set()),
        assert(pendingConsent == []),
        nodes' = nodes, heads' = heads, scopes' = scopes,
        currentScope' = currentScope, status' = status,
        pendingConsent' = pendingConsent, nextId' = nextId,
      })
  }
}
