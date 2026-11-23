---
"@codeforamerica/blueprint-core": patch
---

Before, an operation generated for a state machine action was tagged from its path, so a document's actions could land in a section of their own, and its summary repeated the resource's name, as in "Pause transcription session". Now it takes the tags of its resource's own operations, and the action's words as its summary, as in "Pause". (#548)
