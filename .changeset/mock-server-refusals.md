---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a refused request said `No guard clause passed for creating a Transcript. Not met: …`. Now it reads as a sentence: `Can't create a transcript. It requires that the transcript's profile exists.`, and a missing role reads `Only system can update a transcript entry on this transcript.` (#470)
