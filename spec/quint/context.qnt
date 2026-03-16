// Mnemo Protocol — Agent Context Reconstruction (v2: Scope Model)
//
// Builds an agent's LLM prompt by walking the DAG from root to head,
// skipping nodes that belong to closed scopes.

module context {

  import types.* from "./types"

  // ─── Types ─────────────────────────────────────────────────────

  type AgentContext = {
    messages: List[Content],
    private_state: List[Content],
  }

  // ─── Scope visibility ─────────────────────────────────────────

  // A node is visible if its scope is MAIN_SCOPE, or ScopeOpen, or ScopePromoted
  pure def nodeVisible(node: Node, ss: ScopeId -> Scope): bool = {
    if (node.scope_id == MAIN_SCOPE) true
    else if (ss.keys().contains(node.scope_id))
      ss.get(node.scope_id).status != ScopeClosed
    else false
  }

  // ─── Path from root to head ────────────────────────────────────
  // Bounded unrolling — 16 steps to match simulation depth of 20.

  pure def pathToRoot(nodeId: NodeId, ns: NodeId -> Node): List[NodeId] = {
    val n0  = nodeId
    val p0  = if (ns.keys().contains(n0))  ns.get(n0).parent  else NO_NODE
    val p1  = if (p0  != NO_NODE and ns.keys().contains(p0))  ns.get(p0).parent  else NO_NODE
    val p2  = if (p1  != NO_NODE and ns.keys().contains(p1))  ns.get(p1).parent  else NO_NODE
    val p3  = if (p2  != NO_NODE and ns.keys().contains(p2))  ns.get(p2).parent  else NO_NODE
    val p4  = if (p3  != NO_NODE and ns.keys().contains(p3))  ns.get(p3).parent  else NO_NODE
    val p5  = if (p4  != NO_NODE and ns.keys().contains(p4))  ns.get(p4).parent  else NO_NODE
    val p6  = if (p5  != NO_NODE and ns.keys().contains(p5))  ns.get(p5).parent  else NO_NODE
    val p7  = if (p6  != NO_NODE and ns.keys().contains(p6))  ns.get(p6).parent  else NO_NODE
    val p8  = if (p7  != NO_NODE and ns.keys().contains(p7))  ns.get(p7).parent  else NO_NODE
    val p9  = if (p8  != NO_NODE and ns.keys().contains(p8))  ns.get(p8).parent  else NO_NODE
    val p10 = if (p9  != NO_NODE and ns.keys().contains(p9))  ns.get(p9).parent  else NO_NODE
    val p11 = if (p10 != NO_NODE and ns.keys().contains(p10)) ns.get(p10).parent else NO_NODE
    val p12 = if (p11 != NO_NODE and ns.keys().contains(p11)) ns.get(p11).parent else NO_NODE
    val p13 = if (p12 != NO_NODE and ns.keys().contains(p12)) ns.get(p12).parent else NO_NODE
    val p14 = if (p13 != NO_NODE and ns.keys().contains(p13)) ns.get(p13).parent else NO_NODE
    [p14, p13, p12, p11, p10, p9, p8, p7, p6, p5, p4, p3, p2, p1, p0, n0].select(id => id != NO_NODE)
  }

  // ─── Build context ─────────────────────────────────────────────

  pure def buildContext(
    agent: Agent,
    headId: NodeId,
    ns: NodeId -> Node,
    ss: ScopeId -> Scope
  ): AgentContext = {
    val path = pathToRoot(headId, ns)
    val messages = path.foldl([], (acc, nid) =>
      if (ns.keys().contains(nid)) {
        val node = ns.get(nid)
        if (nodeVisible(node, ss) and node.message != "")
          acc.concat([node.message])
        else
          acc
      } else acc
    )
    val privState = path.foldl([], (acc, nid) =>
      if (ns.keys().contains(nid)) {
        val node = ns.get(nid)
        val p = match agent {
          | AgentA => node.private_a
          | AgentB => node.private_b
        }
        if (p != "") acc.concat([p]) else acc
      } else acc
    )
    { messages: messages, private_state: privState }
  }

  // ─── Properties ────────────────────────────────────────────────

  // Closed scope content doesn't appear in context
  pure def closedScopeInvisible(
    headId: NodeId,
    ns: NodeId -> Node,
    ss: ScopeId -> Scope
  ): bool = {
    val path = pathToRoot(headId, ns)
    path.foldl(true, (acc, nid) =>
      if (ns.keys().contains(nid)) {
        val node = ns.get(nid)
        acc and nodeVisible(node, ss)
      } else acc
    )
  }
}
