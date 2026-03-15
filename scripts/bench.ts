// scripts/bench.ts
import { parseScenarioFile } from '../src/bench/scenario.ts';
import { ScenarioRunner } from '../src/bench/runner.ts';
import { formatJsonReport, formatMarkdownReport, type ScenarioResult } from '../src/bench/reporter.ts';
import { ProgressDisplay } from '../src/bench/display.ts';

const scenarioPath = Deno.args[0];
if (!scenarioPath) {
  console.error('Usage: deno run scripts/bench.ts <scenario.yaml> [--output-dir <dir>]');
  Deno.exit(1);
}

const outputDirIdx = Deno.args.indexOf('--output-dir');
const outputDir = outputDirIdx >= 0 ? Deno.args[outputDirIdx + 1] : '.';

const config = await parseScenarioFile(scenarioPath);
console.log(`Target: ${config.target}`);
console.log(`Scenarios: ${config.scenarios.length}`);
console.log(`Auth: ${config.auth?.enabled ? 'enabled' : 'disabled'}`);
console.log('');

const runner = new ScenarioRunner(config);
const results: ScenarioResult[] = [];

for (const scenario of config.scenarios) {
  console.log(`Starting scenario: ${scenario.name} (${scenario.duration}s)`);
  const metrics = await runner.execute(scenario);
  results.push({ name: scenario.name, duration: scenario.duration, stats: metrics.getStats() });
}

runner.closeAll();

// Fetch policy metrics if configured
let policyMetrics: unknown = null;
if (config.metrics_url) {
  try {
    const res = await fetch(config.metrics_url);
    policyMetrics = await res.text();
  } catch {
    console.warn('Failed to fetch metrics from', config.metrics_url);
  }
}

// Write reports
const jsonPath = `${outputDir}/bench-result.json`;
const mdPath = `${outputDir}/bench-result.md`;
await Deno.writeTextFile(jsonPath, formatJsonReport(config.target, results, policyMetrics));
await Deno.writeTextFile(mdPath, formatMarkdownReport(config.target, results));

console.log(`\nReports written to:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  Markdown: ${mdPath}`);

new ProgressDisplay().summary(results);
