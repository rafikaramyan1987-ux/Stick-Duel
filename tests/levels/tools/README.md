Dev tools for level design (not run in CI): `W=<world> npx vitest run -c vitest.levels.config.ts tests/levels/tools/traps.test.ts`
measures the strongest single-shot trap per level (cap lifted), `ID=<level> T=<target> … aim.test.ts` shows what
each candidate shot at a target does, `rest.test.ts` lists arenas that do not come to rest. They write to the
scratch paths in the files; adjust as needed.
