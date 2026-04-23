// Debug harness removed — workflow-2 regression was caused by FeatureTree
// eagerly executing the first (empty) sketch feature and erroring before
// reaching the one with the rectangle. Fixed by skipping empty sketches
// in the executor; extrude still fails with a clear error if it references
// one. This file is intentionally empty.
