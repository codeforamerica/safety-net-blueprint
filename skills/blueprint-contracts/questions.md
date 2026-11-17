# Finding the architecture

The goal of the conversation is a sketch of the architecture: the domains, the kinds of contract each needs, and how they fit together. Don't run down a list of questions. Get the developer to tell the story of the work, probe what they say, and keep a sketch you play back and correct together.

This way of working comes from Domain-Driven Design practice, not from the blueprint: Domain Storytelling (Hofer and Schwentner) and Event Storming (Brandolini) both find domains by walking through real cases. Say so if the developer asks.

## 1. Get the story

By now you know what it's for and for whom, and you've shared the prior art ([field-knowledge.md](field-knowledge.md)). Ask for **one concrete case, start to finish**: "Walk me through one time this happens. Who starts it, and what happens next?" Keep asking "then what?" until the case is over. Then ask for a second case that goes differently: one that fails, takes too long, or needs an exception.

Cases from different fields, to show the range: a person's income is checked when they apply for help; a resident applies for a building permit and gets an inspection; a clinic books a patient and reminds them.

## 2. Probe what you hear

Listen for these, and follow each one up before moving on. Each points to part of the architecture.

| When you hear | Probe | It points to |
|---|---|---|
| A thing that's kept and looked at later ("the request", "the permit") | "Who creates it? Who changes it? Does it exist without the thing it belongs to?" | Records and their API |
| The same word from two kinds of people ("income", "case") | "Does it mean the same thing to both? Would they want the same information about it?" | A boundary between two domains, if not |
| Different people, different rules, or different vocabulary for one part of the story | "Who's responsible for this part? Do they work with the people in the earlier part, or separately?" | A separate domain |
| A step that changes where something stands ("then it's approved") | "What stages does it go through? Who's allowed to move it? Can it go back? What if nothing happens?" | A lifecycle |
| A person or thing that's sometimes free and sometimes busy ("a free driver", "an available inspector") | "What stages do they go through? What makes them free again?" | A lifecycle of its own, not just a status |
| Something done that doesn't move it on ("the driver marks arrived"), or the system acting on its own ("it's assigned automatically") | "Who or what does that? What does it start?" | A move in the lifecycle, named like the others |
| "The closest", "the first", "whoever's free" | "If several qualify, which one wins? What does 'closest' mean here?" | Rules, with a tie-break |
| An amount worked out from other things ("the total", "the fee") | "What goes into it? Is any of it a policy rule, or is it just adding up?" | Rules: the blueprint works out amounts only in a ruleset |
| Waiting, or a deadline | "How long can that take? What happens when time runs out? Does the clock stop while waiting on someone?" | Deadlines in the lifecycle, and an asynchronous request if it's waiting on another system |
| A decision ("if they qualify", "if it's under the limit") | "How is that decided? Where does the rule come from? Does it change over time or from place to place? Could it decide with only part of the information?" | Rules |
| Someone else finding out ("then the reviewer sees it", "a notice goes out") | "Who actually needs to know? Does this part wait for them, or carry on?" | An event, if someone really uses it; a command if this part needs their answer to go on |
| Something starting because of something elsewhere | "What starts this? Is that in this system or another one?" | A reaction to another domain's event |
| Information coming from somewhere else | "Where does that come from? Who runs that system? Does it answer right away? What if it's down or doesn't know?" | An outside system behind an adapter |
| A screen showing several things at once | "What does that person need to see together?" | A composed view |
| Something set up ahead of time ("the list of sources", "the fee schedule") | "Who changes that, and how often?" | Configuration |
| An organization other than the developer's | "Do they use this, run part of it, or might they want to run or change it themselves?" | Where each part sits, and overlay points |
| Private or regulated information | "Who may see it? Who decides that? Does anyone act for someone else?" | Who may do what, and a gap to flag |

Probe in the developer's words, not the blueprint's. Say "stages," not "state machine," until they use the term themselves.

When something doesn't fit the story, ask about it rather than smoothing it over. The gaps in a story are where the hard parts of the design are.

## 3. Play back the sketch

After every few answers, show the sketch so far in plain words, and ask what's wrong with it. For a permit system, it might sound like:

> Here's what I'm hearing. There are two parts with different people and rules: **permits**, where applications move from submitted to approved or denied, and **inspections**, which inspectors schedule and record. Permits asks inspections for an inspection and carries on; inspections announces the result, and permits reacts to it. The fee is a rule that differs by permit type. Who runs inspections is still open. What's wrong with that?

Start the first sketch from the prior art, and say which parts came from where. The sketch names:
- the domains and what each owns
- for each, the kinds of contract it needs, and what the developer said that calls for each
- how the domains connect: a command, an event, or an asynchronous request ([shapes.md](shapes.md))
- what sits outside, and who runs each part
- what's still open

Corrections to the sketch are the most useful answers you'll get. Keep revising until the developer recognizes it as their system.

## 4. Check what the story didn't cover

Before writing the scope, make sure these came up. Ask about any that didn't:

- **Where each part sits, and who runs it:** one organization's own system, a product others use, a shared service, or something a customer might run, own or replace. Parts can differ, and "not decided yet" is an answer; keep the options open in the sketch.
- **Who might adapt it:** whether others might take any part and change it for their own use. That decides where overlay points go.
- **Whether it's built on someone else's contracts,** such as the safety-net contracts.
- **Whether requirements differ** by program, product or type, like permit types or benefits programs.
- **What needs counting or reporting,** each as the time from one thing happening to another, or a count of something, with a target if there is one. Each depends on announcing those things.
- **Who acts in it,** and whether the system keeps a record of each kind of person (a driver it assigns work to) or only knows them when they act (a customer placing an order).
- **What might grow,** such as more stores, more customer organizations or more programs, and whether to make room for it now.
- **Whether any part uses AI,** and whether the AI suggests, acts, or does a task like transcription ([ai-services.md](reference/docs/architecture/cross-cutting/ai-services.md), a draft).
- **What will implement it:** an existing workflow or rules engine configured to match, a simple backend built to the contracts, or a mix ([shapes.md](shapes.md), section 5). "Not decided" is fine.

When the developer doesn't know an answer, say what each option would mean for the sketch, recommend one, and mark it open.
