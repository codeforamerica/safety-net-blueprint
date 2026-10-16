# @codeforamerica/blueprint-rules-engine

## 0.2.0

### Minor Changes

- 9268474: **Breaking:** a fact built with `&&`, `||`, `!` or `? :` now gets the state its result actually rests on, as Fact Graph's All, Any and Switch do. Before, a fact's state was read off its dependency list before evaluation — any defaulted input made it `placeholder`, any missing one made it `missing` — even when that input did not decide the answer. Now `false && x` is `complete` whatever `x` is; a defaulted `true` settles an `||` as a `placeholder`; a defaulted `false` does not settle an `&&` while another operand is missing, so the result is `missing`. A conditional whose condition is missing stays `missing`. Errors are unchanged: a wrong-type input still errors every fact that reads it.
  
  Facts that used to come back `missing` or `placeholder` may now come back `complete` or `placeholder`. If you branch on a fact's state, check those branches.
