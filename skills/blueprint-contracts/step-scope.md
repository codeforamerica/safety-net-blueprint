# Step: scope

The developer knows what they want to build, but not necessarily in the blueprint's terms. Find out what they're building by asking about it in plain words, then tell them what it needs from the blueprint. They shouldn't need to know words like "state machine" or "overlay" to answer.

The result is one file, `scope.md`, in their project: the system's domains, how they connect, the kinds of contract each needs and why, the stories walked through, the decisions, and the gaps. It's written for the developer to recognize and for the build step to build the contracts from. Nothing gets built in this step.

## Steps

0. **Open with what the blueprint is.** Before any question, tell the developer what the blueprint does and doesn't do, so they aren't facing a blank page. Use this, in your own words if the conversation calls for it, and keep it this short:

   > The blueprint is a way to describe a **backend** as contracts before writing its code. Its tools check the contracts, run a working mock of the API from them, and generate a client your screens or other systems can call. Your developers then build the real backend to match.
   >
   > The contracts can describe the records a system keeps, the stages they go through, the rules it applies, what it tells other systems, and more, so they fit pretty much any kind of backend.
   >
   > It doesn't build screens, sign-in, or the production backend. In this conversation, I'll ask about what you want to build and work out which contracts it needs. Before we design anything, I'll look at how others already do this kind of thing, so we start from what exists.

   Then ask what they want to build, offering examples to react to instead of an open prompt: "What do you want to build? For example: a service that verifies someone's income, a system for applying for and tracking permits, or an API other organizations call to check something." If what they describe is mostly screens, reports or a one-off script, say the blueprint covers only the backend part, and ask whether there is one.

1. **Find prior art first.** Once you know what they want to build and for whom, and before asking for the story, follow [field-knowledge.md](field-knowledge.md): look for standards and existing designs for this kind of system, and the blueprint's own research when the subject is near it. Give the developer a short summary of what others do, and ask whether they know of others.
2. **Find the architecture.** Follow [questions.md](questions.md): get the developer to walk through a real case, probe what they say for domains and the kinds of contract each needs, and play back a sketch of how the pieces fit until they recognize it. Start the sketch from the prior art, and research again when a new part comes up. Don't guess at answers; when they don't know, say what each option would mean and mark it open.
3. **Work out the shape.** Follow [shapes.md](shapes.md): the shape of each domain, the domain boundaries, what each one needs and how they connect, using the architecture patterns the blueprint codifies. Read the doc it names before recommending something, so the reason you give is the blueprint's, not a guess. Stay at the level of shape: which kinds of contract, not how each is written.
4. **Say what the blueprint doesn't cover.** Check their answers against [coverage.md](coverage.md). Say plainly what they'd have to build themselves or decide without the blueprint's help. Don't make up a blueprint answer for a gap.
5. **Tell them, and recommend.** Say what kind of thing it is and what it needs, with a reason for each contract tied to something they said. When a choice is theirs, give your recommendation, why, and the cost of not taking it, then wait.
6. **Write `scope.md`** from [scope-template.md](scope-template.md) once they agree. Show it to them before saving.

## What this step adds to the blueprint

These aren't in the blueprint's docs. When a recommendation rests on one, say so.

- Where each part sits and who runs it: one organization's system, a product others use, a shared service, or a part customers might run or own ([shapes.md](shapes.md), section 1).
- Finding domains by walking through cases, from Domain Storytelling and Event Storming ([questions.md](questions.md)).
- Researching prior art before the story, and when to research again ([field-knowledge.md](field-knowledge.md)).
- The list of gaps ([coverage.md](coverage.md)) and the three choices for reusing a safety-net domain.
- `scope.md` itself, as the system-level layer above the blueprint's per-domain architecture docs.
