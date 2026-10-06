import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTrack, detectFlightSegments, DEFAULT_THRESHOLDS } from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name) {
  return JSON.parse(gunzipSync(readFileSync(join(fixturesDir, name))).toString("utf8"));
}

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json.gz")).sort();

for (const file of fixtureFiles) {
  test(`golden: ${file}`, () => {
    const { timeMs, lat, lon, alt, segments } = loadFixture(file);
    const got = detectFlightSegments({ timeMs, lat, lon, alt });
    assert.deepEqual(got, segments);
  });
}

test("analyzeTrack returns consistent columns", () => {
  const { timeMs, lat, lon, alt, segments } = loadFixture(fixtureFiles[0]);
  const a = analyzeTrack({ timeMs, lat, lon, alt });
  const n = timeMs.length;
  assert.deepEqual(a.segments, segments);
  for (const col of [a.onGround, a.stateFlight, a.stateGround, a.hma, a.vma])
    assert.equal(col.length, n);
  // onGround follows the segments: launch < i < landing is in the air.
  const expected = new Uint8Array(n).fill(1);
  for (const { launch, landing } of segments)
    for (let i = launch + 1; i < landing; i++) expected[i] = 0;
  assert.deepEqual(a.onGround, expected);
});

test("typed-array columns give the same result as plain arrays", () => {
  const { timeMs, lat, lon, alt, segments } = loadFixture(fixtureFiles[0]);
  const got = detectFlightSegments({
    timeMs: Float64Array.from(timeMs),
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    alt: Float64Array.from(alt),
  });
  assert.deepEqual(got, segments);
});

test("core does not change the caller's columns", () => {
  const { timeMs, lat, lon, alt } = loadFixture(fixtureFiles[0]);
  const before = JSON.stringify({ timeMs, lat, lon, alt });
  analyzeTrack({ timeMs, lat, lon, alt });
  assert.equal(JSON.stringify({ timeMs, lat, lon, alt }), before);
});

test("changing a threshold changes the result", () => {
  const { timeMs, lat, lon, alt, segments } = loadFixture(fixtureFiles[0]);
  const track = { timeMs, lat, lon, alt };
  // A start threshold above the horizontal cap can never be exceeded, so no flight is found.
  const none = detectFlightSegments(track, { flightStartHspeed: DEFAULT_THRESHOLDS.maxHspeed + 1 });
  assert.deepEqual(none, []);
  assert.notEqual(segments.length, 0);
  // A different sustained-ground requirement moves at least one landing.
  const moved = detectFlightSegments(track, { sustainedGroundMs: 1 });
  assert.notDeepEqual(moved, segments);
});

test("fewer than 5 fixes throws", () => {
  const four = {
    timeMs: [0, 1000, 2000, 3000],
    lat: [37, 37, 37, 37],
    lon: [-122, -122, -122, -122],
    alt: [100, 100, 100, 100],
  };
  assert.throws(() => detectFlightSegments(four), /at least 5 fixes/);
  assert.throws(() => analyzeTrack(four), /at least 5 fixes/);
});

test("mismatched column lengths throw", () => {
  assert.throws(
    () => detectFlightSegments({ timeMs: [0, 1, 2, 3, 4], lat: [0, 0, 0, 0], lon: [0, 0, 0, 0, 0], alt: [0, 0, 0, 0, 0] }),
    /same length/
  );
});

test("a stationary track has no segments", () => {
  const n = 60;
  const track = {
    timeMs: Array.from({ length: n }, (_, i) => i * 1000),
    lat: new Array(n).fill(37.5),
    lon: new Array(n).fill(-122.1),
    alt: new Array(n).fill(500),
  };
  const a = analyzeTrack(track);
  assert.deepEqual(a.segments, []);
  assert.ok(a.onGround.every((v) => v === 1));
  assert.ok(a.stateGround.every((v) => v === 1));
  assert.ok(a.stateFlight.every((v) => v === 0));
});
