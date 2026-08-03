# Hermes home fixture layout

`test/unit/profiles.test.ts` builds each Hermes home it needs at runtime — via
`mkdtempSync` plus the `seedDefault`/`seedNamed` helpers in that file — rather
than checking in static fixture directories here, so that every test starts
from a clean, disposable directory and there is nothing under this path for
tests to accidentally mutate or leak between runs. This file documents the
shape those helpers produce, since it mirrors the layout of a real
`~/.hermes` on the target machine (§5.4, §6.3.2):

```
<hermesHome>/                     the "default" profile — the root itself
  SOUL.md                         may be the bare Hermes scaffold (not real)
                                   or start with a `# Name — tagline` heading (real)
  profiles/
    <id>/                         a named profile, always "real" per §5.4 —
      SOUL.md                     it only exists because the user ran
                                   `hermes profile create <id>`
    .DS_Store                     non-directory entries under profiles/ are
                                   ignored by enumerateProfiles
```

`enumerateProfiles(hermesHome)` returns `default` first (pointing at
`hermesHome` itself), then named profiles sorted alphabetically by id. See
`src/main/hermes/profiles.ts` for the realness rule this layout exists to test.
