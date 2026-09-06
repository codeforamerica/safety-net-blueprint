# Cross-file vocabulary reference

`main.ecore` and `shared-types.ecore` are original, hand-authored files, not vendored from any
third-party project. They exist solely to test `parseVocabulary()`'s cross-file custom-type
resolution: an attribute's `eType` pointing at a custom type declared in a *different* `.ecore`
file, rather than the same one.

The shape itself (a relative-path-qualified `eType`, e.g.
`ecore:EEnum ./shared-types.ecore#//priorityLevel`) is a confirmed real Corticon output, seen in
the vendored DC Medicaid/CHIP fixture's own `Household.state` attribute
(`Vocabulary/Rule Vocabulary.ecore`) and in `InsuranceSalesProcess.ecore`
(`HOUDAAHMAD/InsuranceSalesProcess`, referenced but not vendored). Neither real occurrence
actually exercises a successful cross-file lookup, though: DC Medicaid's own reference points at
a sample project (`NY State Assistance`) that was never vendored, so the file it points to simply
doesn't exist on disk. This fixture reconstructs the same real shape with both files present, so
the successful-resolution path itself has real test coverage, not just the not-found fallback.

`shared-types.ecore` declares `priorityLevel` only as a standalone `eClassifiers[xsi:type=ecore:EEnum]`
classifier, with no `customDataTypeList` sibling. This matters: every real cross-file `eType`
reference found in either real source above (`ecore:EEnum <path>#//name`) points at an `EEnum`
classifier, never at a `customDataTypeList` entry — so a fixture that also gave `priorityLevel` a
`customDataTypeList` entry in the same file would let the lookup coincidentally succeed via the
*other*, same-file-only resolution path without ever exercising real cross-file resolution at all.
