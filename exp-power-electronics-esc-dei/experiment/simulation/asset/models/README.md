# Unlock-reward model

Drop the unlocked-component `.glb` here and point the sim at it.

1. Put your file in this folder, e.g. `asset/models/reward.glb`
2. In `js/main.js`, set the `UNLOCK_MODEL` constant to its path
   (search for `const UNLOCK_MODEL =`).

Until a file exists, the unlock card shows a procedural placeholder — the
sim never breaks on a missing model. GLTF + DRACO-compressed `.glb` are
both supported.
