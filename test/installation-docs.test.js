import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8").catch(
    () => ""
  );
}

test("installation docs let agents install from a repository URL safely", async () => {
  const [agents, installation, readme, gitignore] = await Promise.all([
    text("AGENTS.md"),
    text("docs/installation.md"),
    text("README.md"),
    text(".gitignore")
  ]);

  assert.ok(agents, "AGENTS.md must exist");
  assert.ok(installation, "docs/installation.md must exist");
  assert.match(agents, /Codex.*Antigravity.*Claude/is);
  assert.match(agents, /rutas? absolutas?/i);
  assert.match(agents, /copia de seguridad/i);
  assert.match(agents, /\.env\.local/);
  assert.match(agents, /credenciales.*chat/is);
  assert.match(agents, /no.*repetir.*contraseña/is);
  assert.match(agents, /bloque `env`.*petición expresa/is);
  assert.match(agents, /npm run doctor/);
  assert.match(agents, /initialize.*tools\/list/is);

  assert.match(readme, /Instala PUCP-MCP desde este repositorio/i);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Claude Desktop/);
  assert.match(installation, /actualización/i);
  assert.match(installation, /desinstalación/i);
  assert.match(installation, /no.*borra.*caché/is);
  assert.match(installation, /credenciales.*chat.*política.*privacidad/is);
  assert.match(installation, /Codex.*esquema.*verificado/is);
  assert.match(installation, /Antigravity.*esquema.*verificado/is);
  assert.match(installation, /Claude Code.*no probado/is);
  assert.match(installation, /Claude Desktop.*no probado/is);

  assert.match(gitignore, /^\*\.log$/m);
  assert.match(gitignore, /^\*\.backup$/m);
  assert.match(gitignore, /^\*\.bak$/m);
  assert.doesNotMatch(gitignore, /\*\.log\\n/);
});
