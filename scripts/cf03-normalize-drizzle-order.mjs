import { readFile, writeFile } from "node:fs/promises";

function splitExports(source) {
  const matches = [...source.matchAll(/^export const\s+([A-Za-z_$][\w$]*)\s*=/gm)];
  if (matches.length === 0) {
    throw new Error("No exported declarations found to normalize");
  }

  const prefix = source.slice(0, matches[0].index);
  const blocks = matches.map((match, index) => ({
    name: match[1],
    content: source.slice(match.index, matches[index + 1]?.index ?? source.length).trim(),
  }));

  const names = blocks.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error("Duplicate exported declarations found while normalizing order");
  }

  return { prefix, blocks };
}

function normalizeOrder(generatedSource, canonicalSource) {
  const generated = splitExports(generatedSource);
  const canonical = splitExports(canonicalSource);
  const generatedByName = new Map(generated.blocks.map((block) => [block.name, block]));
  const canonicalNames = canonical.blocks.map(({ name }) => name);
  const canonicalNameSet = new Set(canonicalNames);

  const ordered = [];
  for (const name of canonicalNames) {
    const block = generatedByName.get(name);
    if (block) ordered.push(block);
  }

  // Keep genuinely new generated declarations visible to the drift check rather than
  // dropping them simply because the committed mapping does not know about them yet.
  for (const block of generated.blocks) {
    if (!canonicalNameSet.has(block.name)) ordered.push(block);
  }

  return `${generated.prefix.trimEnd()}\n\n${ordered.map(({ content }) => content).join("\n\n")}\n`;
}

const [generatedPath, canonicalPath] = process.argv.slice(2);
if (!generatedPath || !canonicalPath) {
  throw new Error(
    "Usage: node scripts/cf03-normalize-drizzle-order.mjs <generated.ts> <canonical.ts>",
  );
}

const [generatedSource, canonicalSource] = await Promise.all([
  readFile(generatedPath, "utf8"),
  readFile(canonicalPath, "utf8"),
]);

await writeFile(generatedPath, normalizeOrder(generatedSource, canonicalSource), "utf8");
console.log(`Normalized Drizzle declaration order in ${generatedPath} against ${canonicalPath}`);
