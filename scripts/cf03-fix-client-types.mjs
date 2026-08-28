import { readFile, writeFile } from "node:fs/promises";

const path = "src/components/features/dashboard/dashboard-view.tsx";
const before = '                      prefix={kpi.prefix || ""}\n';
const after = '                      prefix={"prefix" in kpi ? kpi.prefix : ""}\n';

const source = await readFile(path, "utf8");
if (!source.includes(before)) {
  if (source.includes(after)) {
    console.log("CF03 dashboard KPI type fix is already applied.");
    process.exit(0);
  }
  throw new Error(`Expected dashboard KPI prefix expression not found in ${path}`);
}

await writeFile(path, source.replace(before, after), "utf8");
console.log("Applied CF03 dashboard KPI type fix.");
