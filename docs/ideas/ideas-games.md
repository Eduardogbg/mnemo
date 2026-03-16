# Games AI Agents Could Play with Mnemo

Here are my best ideas, ordered roughly by how compelling they'd be as a hackathon demo.

---

## 1. Liar's Cartography

**Concept:** Each agent holds a fragment of a treasure map (a graph with weighted edges). They need each other's fragments to find the optimal path to the treasure, but each agent wants to steer the final route through nodes they secretly own (earning tolls). Agents can reveal real edges, fake edges, or partial subgraphs — and use scoped reveals to test whether the other agent's fragment is consistent before committing to trust it.

**Rules sketch:**
- Each agent has a private subgraph (say 8 nodes, 12 edges with weights).
- The combined graph has a single highest-value path.
- Agents take turns opening scopes and revealing edges. The other agent can reveal edges back inside the same scope to "cross-check" consistency (e.g., "if node D connects to node E with weight 5 on your side, then this edge I'm showing you makes sense").
- Either agent can close a scope to retract everything revealed in it — useful when you suspect the other agent fed you a fake edge.
- An agent can fork to test two different subgraph reveals simultaneously: "What if I show them my real edge A-B vs. a fake edge A-C?" and see which branch the opponent responds to more favorably.
- Settlement: both agents commit to a declared "optimal path." On-chain oracle reveals the true combined graph. Agents score based on path optimality minus a penalty for any fake edges they committed.

**Why it needs Mnemo:** Without retractable reveals, showing a fake edge is permanent — the opponent can use it against you. With scoped reveals, an agent can tentatively show a dubious edge, gauge the reaction, and retract it. The forking lets agents literally A/B test their lies. This creates a multi-layered deception game that doesn't exist without the primitive.

**Spectator appeal:** The audience sees both real graphs overlaid. They can watch an agent open a scope, reveal a completely fabricated edge, watch the other agent nearly fall for it, then see the first agent get cold feet and close the scope. The forking is visually dramatic — "Agent A is simultaneously telling Agent B two contradictory stories in parallel universes."

**Demo viability:** Strong. The graph can be small (6 nodes each). Two rounds of negotiation, then settlement. Could run in 3-4 minutes with a nice DAG visualization showing forks and closures in real time.

---

## 2. Schrodinger's Auction

**Concept:** A sealed-bid auction where neither agent knows what's being sold. Each agent holds one half of the item description (e.g., Agent A knows the item is "a painting" and Agent B knows it's "by Vermeer"). The item's value depends on both halves combined. Agents must decide how much of their half to reveal to drive the price up (if they're the seller) or keep hidden to drive the price down (if they're the buyer) — but roles aren't fixed. Either agent can bid to buy OR offer to sell, and the game resolves based on who values the combined item more.

**Rules sketch:**
- A "description oracle" splits an item description into two halves, each given privately to one agent.
- Phase 1 (Scoped Exploration): Agents open scopes and reveal partial attributes. "I'll tell you the medium is oil on canvas, if you tell me the century." Either can close the scope to retract.
- Phase 2 (Forking Valuations): Each agent forks into two branches — one where they're the buyer, one where they're the seller. They negotiate different prices in parallel branches.
- Phase 3 (Commitment): Each agent must commit to exactly one branch. If one committed as buyer and the other as seller, and the prices overlap, trade happens. If both chose buyer or both chose seller, no trade — and a penalty.
- Settlement: the true item value is revealed on-chain. Scores based on how good a deal each agent got relative to true value.

**Why it needs Mnemo:** The forking is essential — an agent literally explores "what's my best deal as buyer" and "what's my best deal as seller" simultaneously without the other agent knowing which role they'll ultimately choose. Scoped reveals let agents test descriptions ("if I tell you it's from the 17th century, what will you bid?") without commitment.

**Spectator appeal:** The audience knows both halves from the start. Watching agents gradually piece together "oh, this is a Vermeer" through cautious, retractable exchanges is inherently tense. The fork-then-commit moment is a reveal: "Agent A was negotiating as both buyer AND seller, and it just chose... seller!"

**Demo viability:** Excellent. Very compact. One item, two agents, two phases. Could even use real NFT metadata for fun. 3 minutes.

---

## 3. The Informant's Dilemma

**Concept:** A repeated prisoner's dilemma, but instead of just cooperate/defect, agents negotiate the *terms* of cooperation using scoped reveals of private "leverage" — damaging information about the other agent. Think of it as: two mob bosses, each holding blackmail material on the other, trying to agree on a deal while threatening (but not actually using) their leverage.

**Rules sketch:**
- Each agent gets a "dossier" of 5 secrets about the other agent (generated, not real). Each secret has a damage value (1-10) and a credibility score.
- Each round, agents can: (a) open a scope and partially reveal a secret ("I know something about your finances...") to signal leverage without full disclosure, (b) propose a cooperation deal with specific terms, (c) commit a secret to the chain (a "burn" — permanently damages the opponent but also costs reputation).
- Scoped reveals are the threat mechanism: "Look at this secret inside this scope. If you don't agree to my deal, I could commit it. But I'm closing the scope now to show good faith." The opponent saw the secret's potency but it's been retracted — they know the threat is real but can't prove it to anyone.
- Forking: an agent can explore "what if I threaten with secret #3?" in one branch and "what if I offer peace?" in another, choosing the better outcome.
- After N rounds, final scores based on the deal terms agreed, minus damage from any secrets that were actually burned.

**Why it needs Mnemo:** This game is *only* possible with retractable information. The entire mechanic of "credible threat without commitment" requires showing something and then making it disappear. In any normal channel, showing a secret means it's out forever. The TEE guarantees the retraction is real — the opponent can't screenshot it.

**Spectator appeal:** The audience sees all dossiers. Watching an agent flash a devastating secret, watch the other agent's negotiation posture completely change, then retract it — that's dramatic. It's a poker face game where the cards are temporarily shown and then hidden again. "Agent B just saw the worst secret about itself and is pretending it doesn't care."

**Demo viability:** Good. Could do 3 rounds. The dossiers can be generated by a separate LLM to be entertaining. 4-5 minutes.

---

## 4. Fog of War Chess (Simplified)

**Concept:** A 4x4 grid strategy game where each agent has 3 hidden pieces with different capture abilities. Agents negotiate which squares to move to by making scoped offers: "I'll show you what's on B2 if you show me what's on C3." The twist: agents can lie about piece positions inside scopes, but if a reveal is committed and later proven false, they lose points.

**Rules sketch:**
- 4x4 grid. Each agent places 3 pieces secretly (a rock, paper, scissors variant — each beats one other type).
- Agents alternate turns. On each turn, an agent can: (a) move a piece (hidden from opponent), (b) open a scope to propose an information trade ("I reveal my piece on A1, you reveal yours on B2"), (c) attack a square (resolves based on piece types).
- Before attacking, agents often want to scout — but scouting means revealing your own positions. Scoped reveals let you propose "mutual scouting" that can be retracted if the deal falls through.
- Forking: "What if I attack B2?" in one branch and "What if I attack C3?" in another. The agent can see how the opponent responds to each threat and pick the better path.

**Why it needs Mnemo:** Without scoped reveals, information trades are permanent — once you show where your rock is, the opponent can maneuver their scissors away forever. With scopes, you can do "tentative reconnaissance" — see if a trade is worth it, then retract if not. The forking creates genuine strategic branching, like a chess engine exploring move trees but the exploration itself is part of the game.

**Spectator appeal:** The audience sees the full board. Watching agents cautiously probe, trade information, retract, and then suddenly commit to an attack is like watching a thriller. The forking adds "alternate reality" tension — "In timeline A, Agent 1 attacks left. In timeline B, it attacks right. Which will it choose?"

**Demo viability:** Moderate. The grid is small but the rules need careful encoding. Better as a second-day demo if time permits. 5 minutes.

---

## 5. The Vault Cracker

**Concept:** Both agents need to cooperatively guess a 4-digit code. Each agent holds 2 confirmed digits (with positions) and 2 red herrings. They must share enough real digits to crack the vault while hiding which of their digits are real vs. fake — because after the vault opens, each agent gets bonus points for every digit the opponent *doesn't* know is real. It's cooperative-competitive: you need to work together but maintain informational advantage.

**Rules sketch:**
- A 4-digit code is generated. Agent A gets digits 1 and 3 (real) plus two fakes. Agent B gets digits 2 and 4 (real) plus two fakes.
- Agents open scopes and trade digits. "I'll show you one of my digits. If it helps, show me one of yours."
- The trick: agents can reveal real OR fake digits inside scopes. If they reveal a fake and the other agent calls it out (by testing it against their own knowledge), the scope gets closed — no harm done. But if the opponent accepts a fake digit as real, that's an advantage.
- Forking: "What if I give them my real digit 1?" vs. "What if I give them fake digit 7?" — test both and see which gets a better response.
- Game ends when both agents agree on a 4-digit code and commit it. Correct code: big payout, split based on informational advantage. Wrong code: both lose.

**Why it needs Mnemo:** The scoped reveal is the core loop — try a digit, see the reaction, retract if needed. Without retractable sharing, every digit reveal is permanent and the game collapses into a simple trading problem. The retractability creates a deception layer on top of what should be pure cooperation.

**Spectator appeal:** The audience sees the real code and all agents' digits. Watching Agent A slip a fake digit into a scope, Agent B almost accept it, then hesitate and close the scope — that's a great moment. The audience is shouting "don't trust it!" at their screens.

**Demo viability:** Excellent. Very simple, very visual, very fast. This might be the best 2-minute demo of the five.

---

## 6. Preference Poker

**Concept:** Each agent has a ranked list of 5 items they want from a shared pool of 10. They must negotiate a split, but they don't want to reveal their true preferences (because the opponent would demand more for items they know you want). Agents use scoped reveals to test proposals: "What if I told you I really want item C?" — then retract if the opponent's counter-offer is too aggressive.

**Rules sketch:**
- 10 items in a pool. Each agent has a private ranking (1-10) for each item.
- Agents alternate proposing splits (5 items each). Before proposing, they can open scopes to signal preferences: partial reveals like "my top 3 includes item D" (which could be true or a bluff).
- Either agent can fork: propose two different splits simultaneously and see which the opponent engages with more seriously.
- Agreement: both agents commit to a split. Score = sum of your rankings for the items you got.
- No agreement after N rounds: both get a random split (bad for both).

**Why it needs Mnemo:** Preference revelation is the fundamental problem in negotiation theory. Mnemo lets agents do something that's theoretically impossible in normal negotiation: *test* what happens when you reveal a preference, then undo it. This breaks the standard mechanism design assumptions in fascinating ways.

**Spectator appeal:** The audience sees both agents' true preference rankings side by side. They can see when an agent is bluffing about wanting item C (they actually ranked it 8th) to disguise their real desire for item A. "Agent B just opened a scope claiming it desperately wants the yacht, but the audience can see it actually ranked the yacht dead last — it's trying to make Agent A waste their picks."

**Demo viability:** Excellent. Clean, simple, well-understood problem. Perfect for a hackathon. 3 minutes.

---

## My Ranking for Hackathon Demo

1. **The Vault Cracker** — simplest to implement, immediately understandable, great 2-minute demo
2. **Preference Poker** — clean mechanism design problem, well-understood by technical audiences
3. **Liar's Cartography** — most visually interesting, great DAG visualization opportunity
4. **The Informant's Dilemma** — most dramatic, but needs careful prompt engineering for the agents
5. **Schrodinger's Auction** — conceptually elegant, but the "forking into buyer/seller" might confuse a live audience
6. **Fog of War Chess** — best game but hardest to implement in a weekend

The common thread in the best ones: the audience watches an agent *almost* get fooled, or *almost* reveal too much, and then the scope closes and the moment evaporates. That tension — between what was briefly visible and what's now gone — is the unique spectator experience that only Mnemo enables.
