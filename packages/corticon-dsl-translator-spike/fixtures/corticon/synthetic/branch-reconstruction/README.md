# Branch reconstruction

`branch-example.erf` is an original, hand-authored file, not vendored from any third-party project.

The only real `BranchContainer` examples found during the spike's research (see issue #388) live in third-party
repositories (`HOUDAAHMAD/CorticonAutoCommAprilCanada`, `HOUDAAHMAD/InsuranceSalesProcess`) with no license —
no `LICENSE` file and no license field from the GitHub API, meaning default "all rights reserved" applies.
Vendoring their actual file content into this repo isn't appropriate.

What *is* fair to reuse is the confirmed real XML **schema** itself — a `BranchContainer` node's shape
(a `<condition>` holding a parsed boolean expression, plus a `<branches>` list, each holding a target
`nextStep` activity, a `label`, and a `viewExpressions`) is a structural fact about the Corticon file format,
not a copyrightable expression. `branch-example.erf` reconstructs that same confirmed shape using an
entirely original scenario (unrelated entity/attribute names, a different business domain) so this fixture
is our own original work product, not a derivative of the third-party files.
