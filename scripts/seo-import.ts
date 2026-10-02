/**
 * The SEO audit's findings into the desk's database.
 *
 *   node --env-file=work/dev.env --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/seo-import.ts
 *   node --env-file=.env --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/seo-import.ts --dir /opt/balkaris-desk/work/seo-audit
 *
 *   --dir <folder>     where the audit's files are (default: work/seo-audit beside this repository)
 *   --audit <file>     the audit's summary JSON (default: <dir>/audit.json)
 *
 * It reads the files the audit left in the git-ignored work/seo-audit/
 * (keywords/keywords.csv, keywords/clusters.csv, audit.json,
 * chrome/ai-checks.json, chrome/serp.json, offsite/profiles.json) and writes
 * them into the database DESK_DB names, through src/cc/seo/import.ts. Run it
 * twice and the second run changes nothing; a person's decisions are never
 * overwritten. Prints one line per table, counts only.
 *
 * Nothing it reads is in this repository: the repository is public, and the
 * audit's queries, figures and names live only in the database.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

if (!process.env.DESK_DB) {
  console.error("DESK_DB is not set: run with --env-file pointing at the desk's environment (work/dev.env on a workstation, .env on the box).");
  process.exit(2);
}

const dir = path.resolve(arg("dir") ?? path.join(root, "work", "seo-audit"));
const audit = arg("audit") ? path.resolve(arg("audit")!) : undefined;

const { importAll } = await import("../src/cc/seo/import.ts");
const done = importAll(dir, { audit });
console.log(`Imported from ${dir}:`);
for (const l of done.lines) console.log(`  ${l}`);
