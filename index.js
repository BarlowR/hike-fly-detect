/**
 * hike-fly-detect: in-air / on-foot detection for hike and fly tracklogs.
 *
 * The algorithm is derived from the launch and landing detection in
 * igc-xc-score (https://github.com/mmomtchev/igc-xc-score, LGPL-3.0-or-later)
 * by Momtchil Momtchev, with modifications made for the NorCal Hike and Fly
 * league. See README.md for the full attribution.
 *
 * Launch and landing are detected on an n-second centered moving average of
 * the horizontal speed (hma) and of the absolute vertical speed (vma):
 *
 * - A fix is in stateFlight when both averages exceed the "start" thresholds
 *   and then stay above the "keep" thresholds for flightHoldS seconds.
 * - A fix is in stateGround when both averages are below the ground maxima.
 * - Contiguous stateFlight blocks less than mergeFlightGapMs apart are merged.
 *   Each block's launch is walked back to the last fix slower than
 *   launchHspeedMax, and its landing is walked forward to the first
 *   stateGround run that lasts at least sustainedGroundMs. Overlapping
 *   segments are merged.
 *
 * The core takes columns, never changes them, and keeps no state between calls.
 */

/** @typedef {import('./index.d.ts').Track} Track */
/** @typedef {import('./index.d.ts').Thresholds} Thresholds */
/** @typedef {import('./index.d.ts').Segment} Segment */
/** @typedef {import('./index.d.ts').Analysis} Analysis */

/** @type {Readonly<Thresholds>} */
export const DEFAULT_THRESHOLDS = Object.freeze({
  maPeriodS: 10,
  flightHoldS: 10,
  flightStartHspeed: 6,
  flightStartVspeed: 0.3,
  flightKeepHspeed: 1.5,
  flightKeepVspeed: 0.05,
  groundMaxHspeed: 5,
  groundMaxVspeed: 0.5,
  maxHspeed: 30,
  maxVspeed: 10,
  mergeFlightGapMs: 180_000,
  sustainedGroundMs: 30_000,
  launchHspeedMax: 1.5,
});

const MIN_FIXES = 5;

function radians(degrees) {
  return degrees / (180 / Math.PI);
}

/**
 * Distance in kilometres between two points, using the FCC approximation
 * (47 CFR 73.208). Same formula as Point.distanceEarth in igc-xc-score.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} kilometres
 */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const df = lat2 - lat1;
  const dg = lon2 - lon1;
  const fm = radians((lat1 + lat2) / 2);
  // Speed up cos computation using:
  // - cos(2x) = 2 * cos(x)^2 - 1
  // - cos(a+b) = 2 * cos(a)cos(b) - cos(a-b)
  const cosfm = Math.cos(fm);
  const cos2fm = 2 * cosfm * cosfm - 1;
  const cos3fm = cosfm * (2 * cos2fm - 1);
  const cos4fm = 2 * cos2fm * cos2fm - 1;
  const cos5fm = 2 * cos2fm * cos3fm - cosfm;
  const k1 = 111.13209 - 0.566605 * cos2fm + 0.00120 * cos4fm;
  const k2 = 111.41513 * cosfm - 0.09455 * cos3fm + 0.00012 * cos5fm;
  return Math.sqrt((k1 * df) * (k1 * df) + (k2 * dg) * (k2 * dg));
}

/**
 * @param {Track} track
 * @param {Partial<Thresholds> | undefined} opts
 * @returns {{ n: number, th: Thresholds }}
 */
function validate(track, opts) {
  const n = track.timeMs.length;
  if (track.lat.length !== n || track.lon.length !== n || track.alt.length !== n)
    throw new Error("Track columns must all have the same length");
  if (n < MIN_FIXES)
    throw new Error(`Track must contain at least ${MIN_FIXES} fixes, ${n} found`);
  const th = { ...DEFAULT_THRESHOLDS };
  if (opts) for (const k of Object.keys(DEFAULT_THRESHOLDS)) if (opts[k] !== undefined) th[k] = opts[k];
  return { n, th };
}

/**
 * Per-fix speeds, capped, then centered moving averages.
 * @param {Track} track @param {number} n @param {Thresholds} th
 */
function prepare(track, n, th) {
  const { timeMs, lat, lon, alt } = track;
  const hspeed = new Float64Array(n);
  const vspeed = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const deltaTimestamp = timeMs[i] - timeMs[i - 1];
    if (deltaTimestamp > 0) {
      const dist = distanceKm(lat[i - 1], lon[i - 1], lat[i], lon[i]);
      hspeed[i] = Math.min(th.maxHspeed, dist * 1000 / deltaTimestamp * 1000);
      vspeed[i] = Math.max(
        -th.maxVspeed,
        Math.min(th.maxVspeed, (alt[i] - alt[i - 1]) / deltaTimestamp * 1000)
      );
    } else {
      hspeed[i] = hspeed[i - 1];
      vspeed[i] = vspeed[i - 1];
    }
  }

  const hma = new Float64Array(n);
  const vma = new Float64Array(n);
  const half = Math.round((th.maPeriodS * 1000) / 2);
  for (let i = 0; i < n; i++) {
    const now = timeMs[i];
    let start, end;
    for (start = i; start > 0 && timeMs[start] > now - half; start--);
    for (end = i; end < n - 1 && timeMs[end] < now + half; end++);
    let hsum = 0, vsum = 0;
    for (let j = start; j <= end; j++) {
      hsum = hsum + hspeed[j];
      vsum = vsum + Math.abs(vspeed[j]);
    }
    const len = end - start + 1;
    hma[i] = hsum / len;
    vma[i] = vsum / len;
  }
  return { hma, vma };
}

/** @param {ArrayLike<number>} timeMs @param {Float64Array} hma @param {Float64Array} vma @param {number} n @param {Thresholds} th */
function detectFlight(timeMs, hma, vma, n, th) {
  const stateFlight = new Uint8Array(n);
  let start;
  for (let i = 0; i < n - 1; i++) {
    if (start === undefined && hma[i] > th.flightStartHspeed && vma[i] > th.flightStartVspeed)
      start = i;
    if (start !== undefined)
      if (hma[i] > th.flightKeepHspeed && vma[i] > th.flightKeepVspeed) {
        if (timeMs[i] > timeMs[start] + th.flightHoldS * 1000)
          for (let j = start; j <= i; j++) stateFlight[j] = 1;
      } else {
        start = undefined;
      }
  }
  return stateFlight;
}

/** @param {Float64Array} hma @param {Float64Array} vma @param {number} n @param {Thresholds} th */
function detectGround(hma, vma, n, th) {
  const stateGround = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    if (hma[i] < th.groundMaxHspeed && vma[i] < th.groundMaxVspeed) stateGround[i] = 1;
  return stateGround;
}

/**
 * @param {ArrayLike<number>} timeMs @param {Float64Array} hma
 * @param {Uint8Array} stateFlight @param {Uint8Array} stateGround
 * @param {number} n @param {Thresholds} th
 * @returns {Segment[]}
 */
function detectLaunchLanding(timeMs, hma, stateFlight, stateGround, n, th) {
  // 1. Find contiguous stateFlight blocks.
  /** @type {Array<{ start: number, end: number }>} */
  const blocks = [];
  let blockStart = -1;
  for (let i = 0; i < n; i++) {
    if (blockStart < 0 && stateFlight[i]) {
      blockStart = i;
    } else if (blockStart >= 0 && !stateFlight[i]) {
      blocks.push({ start: blockStart, end: i - 1 });
      blockStart = -1;
    }
  }
  if (blockStart >= 0) blocks.push({ start: blockStart, end: n - 1 });

  // 2. Merge adjacent blocks whose gap is within mergeFlightGapMs.
  //    This handles brief slow sections mid-flight that drop below thresholds.
  /** @type {typeof blocks} */
  const merged = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && timeMs[block.start] - timeMs[prev.end] <= th.mergeFlightGapMs) {
      prev.end = block.end;
    } else {
      merged.push({ ...block });
    }
  }

  // 3. For each merged block find launch and landing.
  /** @type {Segment[]} */
  const ll = [];
  for (const { start, end } of merged) {
    // Launch: walk back from block start to the last fix where the pilot was
    // clearly on the ground (hma < launchHspeedMax ≈ walking speed).
    let launch = 0;
    for (let j = start - 1; j >= 0; j--) {
      if (hma[j] < th.launchHspeedMax) {
        launch = j;
        break;
      }
    }

    // Landing: walk forward from block end to the first stateGround fix that
    // is sustained for at least sustainedGroundMs (avoids slow mid-flight
    // sections being mistaken for a landing).
    let landing = n - 1;
    for (let j = end; j < n; j++) {
      if (stateGround[j]) {
        const t0 = timeMs[j];
        let k = j + 1;
        while (k < n && stateGround[k]) k++;
        const duration = timeMs[k - 1] - t0;
        if (duration >= th.sustainedGroundMs || k >= n) {
          landing = j;
          break;
        }
        j = k - 1; // not sustained — skip past this ground section
      }
    }

    ll.push({ launch, landing });
  }

  // 4. Merge overlapping segments. The launch walk-back of a later block can
  //    extend into the flight range of an earlier block.
  ll.sort((a, b) => a.launch - b.launch);
  /** @type {Segment[]} */
  const merged2 = [];
  for (const seg of ll) {
    const prev = merged2[merged2.length - 1];
    if (prev && seg.launch <= prev.landing) {
      prev.landing = Math.max(prev.landing, seg.landing);
    } else {
      merged2.push({ ...seg });
    }
  }
  return merged2;
}

/**
 * Run the full analysis and return every intermediate state column.
 * @param {Track} track
 * @param {Partial<Thresholds>} [opts]
 * @returns {Analysis}
 */
export function analyzeTrack(track, opts) {
  const { n, th } = validate(track, opts);
  const { hma, vma } = prepare(track, n, th);
  const stateFlight = detectFlight(track.timeMs, hma, vma, n, th);
  const stateGround = detectGround(hma, vma, n, th);
  const segments = detectLaunchLanding(track.timeMs, hma, stateFlight, stateGround, n, th);

  // A fix i is in the air when launch < i < landing.
  const onGround = new Uint8Array(n).fill(1);
  for (const { launch, landing } of segments)
    for (let i = launch + 1; i < landing; i++) onGround[i] = 0;

  return { segments, onGround, stateFlight, stateGround, hma, vma };
}

/**
 * Return only the { launch, landing } index pairs.
 * @param {Track} track
 * @param {Partial<Thresholds>} [opts]
 * @returns {Segment[]}
 */
export function detectFlightSegments(track, opts) {
  return analyzeTrack(track, opts).segments;
}
