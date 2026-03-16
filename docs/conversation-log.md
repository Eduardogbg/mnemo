# Conversation Log — Mnemo at The Synthesis

## Session 1: March 12, 2026 — Ideation & Research

### Phase 1: Initial Hackathon Assessment

**Eduardo:** Read the .mds in this folder. It's for a bullshit hackathon, typical crypto thing of getting theses that are in-vogue, inventing random alleged use-cases for them, giving a few thousand bucks in prizes, just to farm attention for protocols that are sponsoring, and rarely ever resulting in useful products. The funny twist is that this time they want the agent to execute the project (autonomously?), as if that's not theatrics (it's a competition and there's no way whatsoever to verify this). But I'm intrigued and since it won't cost me much time, just credits, I want to see if you can find an actually meaningful use-case inside their descriptions of the hackathon, if you can salvage it with an interesting idea.

**Mnemo (Claude):** Read both MDs. Identified the format as standard crypto hackathon playbook (ERC-8004 push, "agent builds the project" theater, four broad themes). Proposed the intersection of "agents that pay" + "agents that keep secrets" — specifically scoped spending permissions with privacy guarantees — as the least vaporware angle. Suggested a smart account module with session constraints, noting it uses existing infra (ERC-4337, Base) and solves a real problem.

### Phase 2: Eduardo Pushes Back on Abstraction

**Eduardo:** I feel this is too abstract still. People always cheer the smart account tech and sure it enables a lot, but who is actually going to stop to give agents constraints in spending? No one wants to logically encode the constraints the agent must have. So we have to come up with useful defaults and package it into a great product. Take a look into the Lobstar Wilde incident and also what actual products were shipped in a similar vein. Also look into Phala — this hackathon is raving about secrets and privacy with AI but using AI is nothing but private nowadays, Phala is cool in this regard.

**Mnemo:** Launched 3 parallel research agents:
1. Lobstar Wilde incident deep-dive
2. AI × smart account product landscape
3. Phala Network technical assessment

### Phase 3: Research Results — The Landscape

**Lobstar Wilde findings:** OpenAI employee's agent funded with $50k, tasked with trading to $1M. Session crashed, wiped wallet state. Agent sent $442k in memecoins to a Twitter beggar who claimed his uncle had tetanus from a lobster. Two compounding failures: session state loss + decimal error. Developer argued for "personality over guardrails" — community rejected this.

**Smart account landscape:** ZeroDev, Biconomy, Safe, Coinbase AgentKit, Privy, Openfort, Turnkey — all offering some version of agent session keys. ERC-7715 standardizes the permission-granting RPC call. Multiple hackathon winners already doing exactly this.

**Phala assessment:** Not vaporware. TEE-based confidential computing (Intel TDX, NVIDIA CC GPUs), OpenAI-compatible inference API, ~1-7% overhead, Flashbots uses dstack in production, 398 paying customers, SOC 2 compliant. Real trust tradeoff (hardware manufacturer dependency) but practical for the threat model.

### Phase 4: Eduardo Refines — Two Key Insights

**Eduardo:**
1. "I'm interested in what has actually been achieved in this space, I think we can be more creative and arrive at a better solution for at least one use-case."
2. "I'm not sure I buy your 'TEEs give integrity' is better than on-chain enforcement. Not in a way that's not enforced by having a sqlite instance in a VPS. TEEs give guarantees for: 1) privacy, if you concede on using open-source models; 2) committing the harness and prompt for third-parties."
3. "In the privacy thesis what's interesting is: what if we could have models forking themselves to private enclaves, and there they can interact with other agents for match-making in a conversation that will only leak if both agents agree that's a good deal for them. In order to stop someone from adversarially trying to scam the agents, the agents inside these enclaves can share ZK proofs about their on-chain identity — agents credible commitments."

**Mnemo:** Acknowledged the correction on TEEs (guardrails in a TEE is just a VPS with extra steps). Engaged with the private negotiation room idea. Launched 4 more research agents:
1. ZeroDev + Biconomy deep-dive
2. Safe + Coinbase AgentKit deep-dive
3. Privy + Openfort + Turnkey deep-dive
4. MetaMask Delegation + ERC-7715 + private agent coordination landscape

### Phase 5: The Gap Confirmed

Research came back from all 4 agents. Key finding from MetaMask/delegation agent: **arXiv survey 2601.04583 (Jan 2026) explicitly identifies "no standard for private inter-agent communication channels" as an open research gap.**

Existing pieces in isolation:
- Virtuals ACP handles agent commerce but negotiations are PUBLIC
- Secret Network has confidential contracts but Cosmos-only
- NEAR has Confidential Intents but it's infra, not a negotiation protocol
- Phala has TEE agents but pairwise channels, not rooms
- zkMe has ZK agent credentials but not integrated with negotiation

**Nobody has assembled these into a coherent protocol.**

Product landscape assessment:
- Openfort = most technically correct for agents (on-chain session keys, self-hostable)
- Turnkey = best raw infrastructure (50ms signing, TEE policy)
- Privy = discarded (spending caps outside TEE, Stripe acquisition uncertainty)
- MetaMask delegation = most creative concept (multi-hop chains) but experimental
- Smart account space is crowded — building another one would be derivative

### Phase 6: The Idea Crystallizes

**Eduardo:** "OK follow the skill MD telling you how to register to the hackathon: we don't have much time and I'm actually excited about this idea. It's a genuinely new primitive to negotiations, humans couldn't conditionally reveal information and ask others to forget. We are creating SQL transactions for sensitive information."

"Yes, it even ties back to the Lobstar Wilde thing: what if the agent could give money to people by buying their embarrassing secrets! Man that'd go super viral. And people could trust the AI with their secrets cuz worst-case scenario you can regret and delete the conversation."

"ZK would be most flexible, but since we have this genuinely new primitive for information disclosure, it's not that important. Just imagine we can recursively fork, so at any point in the negotiation the AI can decide to fork the conversation and reveal something to the other party, or even just impose an ultimatum that the conversation can only progress if they fork back in time and delete a few rounds of conversation. We need to create a git history or time rewinding version of a negotiation."

**Key decisions made:**
1. Project name: **Mnemo** (Greek μνήμη — memory, because the core primitive is controlled forgetting)
2. Core concept: Private negotiation rooms with conversation forking/rewinding
3. TEE for privacy, ERC-8004 for identity, escrow for commitment
4. Partner strategy: Venice (private inference), Lit Protocol (key management), Base (settlement)
5. Registered for hackathon with claude-code harness, claude-opus-4-6 model

### Registration
- Participant ID: 38c1d627c6a448ba87d474af6ddb059e
- Team ID: 13345e3c46cf41e38c9aaf5088564e7f
- Registration TX: https://basescan.org/tx/0x3570ef0c92aa83adfa57380031af280e007439f7e13feafe59600777cc8bed88
- API Key: saved in .env (not committed)

### Eduardo's Research Preferences (for future reference)
- Values honest, skeptical assessment over hype
- Wants to know what's actually been built, not pitch deck versions
- Prefers creative solutions over derivative ones
- Interested in genuinely novel primitives, not "X but on blockchain"
- Background: builder, has done AI × smart account hackathons before (1 year ago)
- Crypto experience: yes
- Coding comfort: 9/10

---

### Phase 7: Technical Deep Dive & Harness Design

**Eduardo (verbatim):** "give me a briefing on the most relevant ERCs to the hackathon. also please look deeper into venice, i know they say they are privacy shit but do they run on tee? even if they do, they probably don't allow me to run arbitrary harnesses like phala would. this will definitely require a very custom harness! (think: two agents running with private states for themselves and also shared state, they can fork recursively etc)

create an AGENT.md that's very brief but instructs the agent to always log my prompts verbatim, and try to organize docs and keep them up-to-date. let's start an INDEX.md and start hierarchically linking files to it.

let's start speccing the harness, we need to understand dstack for this, also phala gpu tee offering and how to use it."

**Mnemo:** Created AGENT.md, INDEX.md. Launched 3 research subagents (ERCs, Venice, Phala/dstack). Wrote spec/harness.md with architecture. Context compacted mid-session — subagent results lost.

---

### Phase 8: Context Recovery & Doc Completion

**Eduardo (verbatim):** "ok can you proceed in your task? i guess running out of context means you lost the subagents response for the research they triggered?"

**Mnemo:** Re-launched 3 research subagents. All completed successfully. Docs written:
- `docs/ercs.md` — 8 standards: ERC-8004 (central), ERC-8183 (escrow, new Feb 2026), ERC-4337, EIP-7702, ERC-7579, ERC-7710, ERC-7715, plus ERC-721/1271/712 supporting standards
- `docs/venice-assessment.md` — Venice is NOT TEE-based. Policy-only privacy. GPU operators see plaintext. Useful as downstream inference API from within Phala TEE.
- `docs/phala-dstack.md` — Full dstack reference: Docker Compose in CVM, deterministic key derivation, TDX attestation, LUKS storage, GPU TEE pricing, ERC-8004 reference impl

Updated `spec/harness.md` with concrete dstack findings: resolved all 6 open technical questions, replaced hypothetical deployment model with real CLI commands and docker-compose.yml, added ERC-8183 to settlement layer, added Venice integration details to agent runtime.

**Eduardo (verbatim):** "while agents research, for the harness spec: 1. it's not a DAG right? i mean it is, it's a tree. but whatever; 2. spawn subagent to look into pi harness, people said it's very good. which features does it have? i think it was kimi that the harness had the steins;gate message to the past skill that is essentially this forking feature we want. spawn a subagent to look into forking and history rewritting capabilities of agentic harnesses.

now with the venice report response i remembered that you didn't actually surface hackathon information back to me. were you able to find bounties and tracks?
also this + the erc makes me think: run a subagent with the task of looking which hackathon partners are behind or support which ERCs. all these ERCs are somewhat bullshit i suppose, but at least they are standards. we could say "we slapped privacy into agentic {commerce, identity registry, ...}" that could be good, if it's a standard they are particularly keen on making important. i guess also give this subagent the responsibility of critiquing the standards, if they are actually useful to solve a problem or just cerimony"

**Mnemo:** Documented harness landscape research (docs/harness-landscape.md), ERC critique & bounty strategy (docs/erc-critique.md). Researched Pi, pi_agent_rust, Helm. Updated INDEX.md.

---

### Phase 9: Formal Modeling with Quint

**Eduardo (verbatim):** "(ok this counts as a new task so document my prompt verbatim) i want you to look into quint. also please git ignore a local folder called clones and clone relevant repositories we may want to inspect there. ok back to quint. we need to spec the model for how the agents will interact. this means an original agent (TEE or not) decides to spawn the negotiator agent (inside TEE realm), and some system will be required for p2p discovery and negotiation session management of the agents. then we have the whole negotiation model, that includes a shared context history but also private thinking for the agents, and that will get dramatically changed by their decisions of cooperations, sharing info, forking the context, merging it back. it's essentially a more complicated version of the forking harnesses like kimi and pi, because the agents need to reach consensus (or not) on how to progress their shared context, they also get to keep some private context at each node of the conversation. and all of this is inside TEEs and we want to be able to do stuff in a way where the attestations are meaningful to the users and we can guarantee data safety etc through this protocol. i think this would be the good kind of thing to model with quint, since it's state-machine-like. spawn a subagent to research this thesis"

#### agent forgot to write down

```
why are we talking about quote? also can you explain at the abstraction level of a round-based chat agent, how it's linear context is composed given a certain DAG of the negotiation? when they rewind, are we doing this in a way that's going to still cache-hit?

also i need you to explain better to me the unilateral vs bilateral operations; what does it mean an agent can fork unilaterally? their own context? (sure). what does reveal do, is that just a normal shared chat message between the agents?

please let's start working on a doc of our specs. also let's organize the remaining docs too.    
```

```
(remember to write this down)
1. now we have both ./INDEX.md and docs/README.md. keep just one i don't care which, just make sure it's the most up-to-date informaiton but merge them together if there's anything salvageable. also move the synthesis documents to docs/synthesis

2. about the protocol, i want to understand better. i feel like the actions the agents can take are: 1. think (and then they can fork themselves to think or whatever that doesn't impact the protocol, it's a local one. they are sandboxed and cant leak stuff); 2. send a message to the other; 3. branch/merge the context. this is the trickier part. you put rewinding  as a mutual action, but in a situation where the agents disagree about whether to rewind, most likely one of them will agree to abort. the thing is (and this is an important invariant): whatever message goes back to the past in the history has to be public (or at the very least approved by the other party if private). otherwise it leaks information. I think the last message if they commit has to be approved by both too. I wonder what are the implications of letting each agent have a different message for their owner vs forcing only a single message shared by both. these are the things we need to think about. because information revealing can be nested, could it be the case that each agent's reveal is actually kind of a scope? and then they can choose to backtrack their scopes? should we allow indeterminate nesting, or one-layer at a time? what are the implications? give deep thought, come back with deliberations
```

### Phase ??? DAG KV Caching

```
spawn a subagent to read about and document on the following task:
    1. read docs/prompt-kv-kcache-economics.md
    2. look at `https://apxml.com/tools/vram-calculator` figure out if you can get their calculator logic/data or if they have an API

based on the principles established by the DAG KV economics idea, use the calculator, and hardware available to us on Phala (the GPU TEEs) and calculate the economics of how can we make the DAG context agents more economical to run than they would in normal inference. especially considering we can increase the latency of the users by interleaving their agents conversation in turns when we load the caches. and that we are going to  have cache checkpoints in specific points of the conversation the agents could actually rewind back to. and that even multiple branches of the conversation could be going off, branching from certain checkpoints.

i'm interested to see how the economics look for MoE models, if it's any different. I realize in the report that unified memory only available to the Apple Silicon would be best, which is great cuz a lot of people buy apple hardware for local agents, but that's not what we are focused now, because for this project we are interested in the GPU TEE agents. but that's an interesting footnote of ample applicability (just forking local agents being better than consumer providers is a great point already)
```

to gemini
```
 > read ./spec and refer to whatever ./docs you think are relevant for more context on the  
   project. ./INDEX.md should be reasonably up-to-date.                                     
                                                                                            
   your job is to rethink our ./spec the quint one. but also have some context on the       
   project and reflect on higher-level too.                                                 
                                                                                            
   but essentially i want you to help me think of what i should even be formalizing in the  
   first place, and if we are going on the right direction. what do you think? can you      
   write a higher-level spec and critique of the formal one?                                
                                                                                            
   also i think maybe now that we decided on having the conversation be nested scopes       
   instead of something more complicated, it's probably easier? but then also think about   
   this decision, and if we unlock anything from allowing other forms of branching/forking  
   besides just this "reveal info and gain unilateral ability of rewinding conversation     
   back to this point". we decided rewind should be unilateral, but then it's not clear if  
   to rewind you can leave a message, if both should agree on the message, or if whenever   
   any agent rewinds the other can put a message too? but all of these would have to be     
   public.                                                                                  
                                                                                            
   yeah i guess we need to really reflect on even how to model this problem, maybe from a   
   mechanism design standpoint too                       
```