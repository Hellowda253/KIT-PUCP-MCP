import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { syncSkills } from "../scripts/lib/skill-sync.js";

test("skill sync previews changes and only overwrites differing files explicitly", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "pucp-skill-sync-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const repositoryRoot = path.join(temporary, "repo");
  const destination = path.join(temporary, "client-skills");
  const sourceSkill = path.join(repositoryRoot, "skills", "pucp-academic");
  const installedSkill = path.join(destination, "pucp-academic");
  await Promise.all([
    mkdir(sourceSkill, { recursive: true }),
    mkdir(installedSkill, { recursive: true })
  ]);
  await writeFile(path.join(sourceSkill, "SKILL.md"), "new", "utf8");
  await writeFile(path.join(installedSkill, "SKILL.md"), "old", "utf8");

  const preview = await syncSkills({ repositoryRoot, destinations: [destination], dryRun: true });
  assert.equal(preview.changed, 1);
  assert.equal(await readFile(path.join(installedSkill, "SKILL.md"), "utf8"), "old");

  await assert.rejects(
    syncSkills({ repositoryRoot, destinations: [destination] }),
    /use --force/iu
  );
  const applied = await syncSkills({ repositoryRoot, destinations: [destination], force: true });
  assert.equal(applied.changed, 1);
  assert.equal(await readFile(path.join(installedSkill, "SKILL.md"), "utf8"), "new");
});

test("package exposes an explicit skill synchronization command", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts["sync-skills"], "node scripts/sync-skills.js");
});
