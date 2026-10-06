/**
 * Checks hand-made labels (test/labels/*.json, written by label_tool.ipynb)
 * against the detector. Unlike the golden tests, these allow a tolerance:
 * every labeled launch and landing must be within TOLERANCE_MS of a detected
 * segment's launch and landing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectFlightSegments } from "../index.js";

const TOLERANCE_MS = 60_000;

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(testDir, "fixtures");
const labelsDir = join(testDir, "labels");

const labelFiles = existsSync(labelsDir)
  ? readdirSync(labelsDir).filter((f) => f.endsWith(".json")).sort()
  : [];

function fmtDiff(ms) {
  const s = Math.round(ms / 1000);
  return s === 0 ? "exact" : `${s > 0 ? "+" : ""}${s}s`;
}

for (const file of labelFiles) {
  test(`labels: ${file}`, () => {
    const labels = JSON.parse(readFileSync(join(labelsDir, file), "utf8"));
    const { timeMs, lat, lon, alt } = JSON.parse(
      gunzipSync(readFileSync(join(fixturesDir, labels.fixture))).toString("utf8")
    );
    const detected = detectFlightSegments({ timeMs, lat, lon, alt });
    assert.ok(detected.length > 0, "expected at least one detected segment");

    const used = new Set();
    for (const [i, exp] of labels.expected.entries()) {
      // Match the detected segment whose launch is closest in time to the label.
      let best = null;
      let bestDiff = Infinity;
      for (const [j, det] of detected.entries()) {
        if (used.has(j)) continue;
        const diff = Math.abs(timeMs[det.launch] - exp.launch_timestamp_ms);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = j;
        }
      }
      assert.notEqual(best, null, `flight ${i + 1}: no unmatched detected segment`);
      used.add(best);
      const det = detected[best];
      const launchDiff = timeMs[det.launch] - exp.launch_timestamp_ms;
      const landingDiff = timeMs[det.landing] - exp.landing_timestamp_ms;
      assert.ok(
        Math.abs(launchDiff) <= TOLERANCE_MS,
        `flight ${i + 1}: launch off by ${fmtDiff(launchDiff)} (label idx ${exp.launch_idx}, detected idx ${det.launch})`
      );
      assert.ok(
        Math.abs(landingDiff) <= TOLERANCE_MS,
        `flight ${i + 1}: landing off by ${fmtDiff(landingDiff)} (label idx ${exp.landing_idx}, detected idx ${det.landing})`
      );
    }
  });
}
