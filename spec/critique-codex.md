**Scope model: big mismatches + underspecified semantics**
- “Destroys all content” is not what your spec does. `closeScope` explicitly keeps nodes (“Nodes stay in DAG”) and only flips scope status. See `spec/quint/negotiation.qnt:151` and the fact that `Scope` permanently stores `reveal_data` in state (`spec/quint/types.qnt:51-58`). In `spec/protocol.md:18` and `spec/protocol.md:82` you claim destruction/deletion from the shared state machine; you’ve actually modeled *hiding*, not deletion. That’s not a pedantic difference in a TEE threat model (crash dumps, side channels, “buggy context builder” classes of failure).
- You call it a “Conversation DAG” (`spec/protocol.md:110-113`), but the Quint model is a synchronized linear chain: every `message`/`openScope` sets *both* heads to the same new node (`spec/quint/negotiation.qnt:78-79`, `spec/quint/negotiation.qnt:117-118`). That’s not “branches”; it’s a stack-like “current scope” transcript with rollback. If DAG/branch structure matters for your claims, it’s not present here.
- `commit(terms)` exists in prose (`spec/protocol.md:84`), but there are no terms in the formal model: `ConsentOp.CommitOp` carries nothing (`spec/quint/types.qnt:25-28`). So the “deal” is semantically empty in Quint; you cannot state or verify *any* property about correctness of settlement, consistency of terms with promoted content, etc.
- “Promote makes scope content permanent on main” is false as implemented. `acceptPromote` moves nodes to the *parent scope* (`spec/quint/negotiation.qnt:198-206`). If you promote a nested scope, content becomes permanent in the enclosing scope, not main. Your table claims “on main” (`spec/protocol.md:83`) without distinguishing top-level vs nested promotes.

**Consent model: you violate your own principle and introduce an obvious DoS**
- You state: “you can always … retract your own reveals” (`spec/protocol.md:89`, reinforced by “owner can always close their own scope” at `spec/protocol.md:35`). Then you immediately contradict it: “While a bilateral operation is pending, unilateral operations are blocked” (`spec/protocol.md:94`). The Quint model enforces that block: `closeScope` requires `pendingConsent == []` (`spec/quint/negotiation.qnt:133`).
  - Consequence: the non-owner can freeze the owner’s ability to retract by proposing a promote on the current scope (`spec/quint/negotiation.qnt:165-186`). That’s a protocol-level hostage mechanic, not “structural consent”.
  - “But abort exists” is not a clean escape hatch; abort is a nuke. If your principle is “I can retract my reveal”, forcing abort to regain safety is a design failure.
- There is no “cancel my own proposal” operation. If I propose promote/commit and regret it, I must wait for the other party to reject, or abort. That’s brittle and creates silly negotiation dead-ends.

**Nesting limit = 2: too restrictive for real negotiation, and your justification doesn’t match the implementation**
- With max depth 2 (`spec/protocol.md:61-62`, enforced in `spec/quint/negotiation.qnt:95`), you cannot express repeated alternating counter-reveals beyond one back-and-forth without forcing promote/close between each round. Real negotiations routinely do: reveal → counter-reveal → revised reveal → revised counter-reveal (especially for price/terms).
- Your implementation also allows the *same* agent to open the nested scope (nothing prevents A from opening a sub-scope inside A’s scope). That undermines the “two layers for counter-reveal” story (`spec/protocol.md:56-59`) and creates asymmetric “extra retract granularity” for one party.
- Your “nesting limit” check is fragile in the formalization: `scopeDepth` is not recursive and can’t detect depth > 2 if it ever arises (`spec/quint/types.qnt:69-77`). `nesting_limit` therefore isn’t a real invariant; it’s “we assume we never create deeper scopes” (`spec/quint/properties.qnt:38-41`). Same issue with `isNestedIn` assuming direct parenthood (`spec/quint/negotiation.qnt:54-59`).

**KV-cache friendliness: claim only holds under narrow conditions you don’t actually guarantee**
- The “prefix after close” property (`spec/protocol.md:162-170`) depends on a strong stack discipline: once you enter a scope, all subsequent messages are in that scope until you close/promote. Your model enforces that via a single global `currentScope`, but this comes at the cost of expressivity (see below).
- In any realistic harness, the prompt will include dynamic metadata (current scope, pending consent, allowed ops). That metadata typically lives near the top of the prompt and changes on close/promote/consent, breaking prefix caching even if the transcript prefix is stable. Your formal model doesn’t include any of this, so the cache claim is basically untested handwaving.
- If you ever add a more realistic behavior (“close inner scope but continue the outer conversation after it”), you will excise a *middle* chunk, not trim a suffix. That breaks the prefix-cache story immediately.

**Invariants: most are vacuous, and the ones you need aren’t stated**
- “Scope ownership” invariant is literally `true` (`spec/quint/properties.qnt:27-33`). You are not checking anything.
- “Privacy” invariants don’t model privacy. They only assert `message != private_a/private_b` (`spec/quint/properties.qnt:13-21`), but (1) you never write non-empty private fields anywhere in the transition system, so this always passes, and (2) even if you did, inequality is not a noninterference guarantee.
- You never formalize your headline claim: “No information leaks backward” (`spec/protocol.md:96-100`). `properties.qnt` doesn’t import or reason about `context.buildContext` at all. So your simulation/invariant runs cannot possibly catch a context reconstruction bug that leaks closed-scope content.
- Critical missing invariants (examples):
  - Heads consistency: `heads[A] == heads[B]` (your model *assumes* lockstep but never asserts it).
  - Head/scope consistency: `nodes[head].scope_id == currentScope` in `Active`.
  - Scope graph well-formedness: `parent_scope` exists (or is main), no cycles, and `entry_node` exists and is in the parent scope.
  - Post-close deletion (if you really mean “destroy”): closed scope has no remaining nodes / no remaining `reveal_data`. Right now it absolutely does.
  - Promotion hygiene: after promotion, no node remains with `scope_id == promotedScopeId` (you do re-tag nodes, but you never assert you did it correctly).

**Context reconstruction module: bounded + wrong property + not wired into verification**
- `pathToRoot` is hard-bounded to 8 steps (`spec/quint/context.qnt:28-40`), but your suggested randomized runs go to 20 steps (`spec/protocol.md:228-229`). That means any “context” reasoning silently drops history for many traces. If context matters to security, this is broken by construction.
- `closedScopeInvisible` is not “closed scope content doesn’t appear”; it returns `false` if *any* node on the path is invisible (`spec/quint/context.qnt:75-88`). That’s basically “all nodes on the path are visible”, which is a different statement—and still not used anywhere.

**Scenarios: they don’t hit the dangerous stuff**
- You test happy paths and a few scope operations (`spec/quint/scenarios.qnt`), but you never test:
  - The consent-freeze bug: one agent proposes promote, the other tries to `closeScope` (should be allowed by your prose principle, but is forbidden).
  - Abort while consent pending (allowed in Quint; is it intended?).
  - Nested promote sequences (inner promote then outer promote) and whether semantics match your prose.
  - Any relationship between `buildContext` output and scope closure (the thing you claim enforces privacy).

**Real-world negotiation patterns you cannot express**
- Multi-round bargaining with sensitive offers each round (depth=2 + single `currentScope` forces “resolve this reveal now or abort” dynamics).
- Parallel/independent contingencies (“I’ll show you A and B in separate compartments; you can accept one without the other”). You have exactly one active compartment.
- Selective retention: “I retract the secret but keep the non-sensitive derived statement/result.” You only have promote-all or destroy-all.
- Timeouts / silence / retry: consent is a global mutex with no cancellation or expiry; that’s not how real negotiation protocols survive network/agent failures.

**Concrete improvements (not cosmetic)**
- Decide what “destroy” means and model it: if closed means “deleted”, then actually remove nodes and wipe `reveal_data` from state on close (or explicitly rename the concept to “logically inaccessible” and stop claiming deletion).
- Fix the consent model so it matches your stated principle:
  - Allow the scope owner to `closeScope` even when `pendingConsent` is non-empty (and define what happens to the pending request—likely auto-cancel).
  - Add `cancelConsent(proposer)` and/or consent IDs + timeouts.
- Make nesting and scope relations real invariants:
  - Implement recursive depth and cycle checks; stop baking “max depth 2” into helper semantics (`scopeDepth`, `isNestedIn`) because that makes your invariants self-fulfilling.
  - If you truly want “two-party counter-reveal”, enforce alternation (inner owner must differ from outer owner) or justify why same-owner nesting is valid.
- If KV-cache friendliness is a core selling point, you need to constrain the prompt format:
  - Keep all dynamic metadata *after* the transcript (or in tool metadata / out-of-band fields) so the transcript prefix stays cacheable.
  - Explicitly forbid patterns that excise middle segments—or admit you can’t have both expressivity and pure prefix-trimming.
- Wire context reconstruction into verification:
  - Add invariants over `buildContext(...)` that guarantee no closed-scope node message appears.
  - Remove (or parameterize) the 8-step bound, or assert a hard protocol-level bound on transcript length that matches it.

If you want, I can rewrite the *actual* security claims you can honestly make given “the other agent already saw the secret” and “agents can output private summaries”, because right now `spec/protocol.md` overclaims confidentiality in ways you cannot enforce cryptographically or procedurally.%   