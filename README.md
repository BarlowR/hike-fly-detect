# hike-fly-detect

In-air / on-foot detection for hike and fly paragliding tracklogs.

Given a tracklog as four columns (time, latitude, longitude, altitude), the
package returns the launch and landing index pairs, plus per-fix state columns.
It has no dependencies, no parser, and no build step. It runs in Node and in a
browser bundle.

## Install

The package is installed from a git tag; it is not published to npm.

```sh
npm install github:BarlowR/hike-fly-detect#v0.1.0
```

## Usage

```js
import { detectFlightSegments, analyzeTrack } from "hike-fly-detect";

const track = {
  timeMs: [...], // epoch milliseconds
  lat: [...],    // degrees
  lon: [...],    // degrees
  alt: [...],    // metres, one altitude source chosen by you
};

const segments = detectFlightSegments(track);
// [{ launch: 320, landing: 1699 }, ...]
// Fix i is in the air when launch < i < landing.

const analysis = analyzeTrack(track, { sustainedGroundMs: 60_000 });
// analysis.segments, analysis.onGround, analysis.stateFlight,
// analysis.stateGround, analysis.hma, analysis.vma
```

Rules for the caller:

- All four columns must have the same length, and at least 5 fixes.
- Remove invalid fixes and fixes with a repeated timestamp before the call.
  A time step of zero or less copies the speeds of the previous fix.
- The columns are never modified. Indexes in the result point into them.
- The same input always gives the same output.

## How it works

1. Horizontal and vertical speed are computed for each fix and capped at
   `maxHspeed` / `maxVspeed` so a single bad GPS fix cannot inflate the average.
2. A centered `maPeriodS`-second moving average gives `hma` (horizontal) and
   `vma` (absolute vertical) for each fix.
3. `stateFlight` is set where both averages exceed the start thresholds and
   then stay above the keep thresholds for `flightHoldS` seconds.
4. `stateGround` is set where both averages are below the ground maxima.
5. Contiguous `stateFlight` blocks closer than `mergeFlightGapMs` are merged.
   Each block's launch is walked back to the last fix with `hma` below
   `launchHspeedMax`. Its landing is walked forward to the first `stateGround`
   run that lasts at least `sustainedGroundMs`. Overlapping segments merge.

## Thresholds

Every threshold is an option. The defaults are tuned for GPX uploads from
phone apps and consumer instruments in the NorCal Hike and Fly league.

| Option | Default | Meaning |
| --- | --- | --- |
| `maPeriodS` | 10 | moving-average window, seconds |
| `flightHoldS` | 10 | seconds the flight conditions must hold |
| `flightStartHspeed` | 6 | m/s, `hma` to start a flight candidate |
| `flightStartVspeed` | 0.3 | m/s, `vma` to start a flight candidate |
| `flightKeepHspeed` | 1.5 | m/s, `hma` below which the candidate is dropped |
| `flightKeepVspeed` | 0.05 | m/s, `vma` below which the candidate is dropped |
| `groundMaxHspeed` | 5 | m/s, `hma` below which a fix can be ground |
| `groundMaxVspeed` | 0.5 | m/s, `vma` below which a fix can be ground |
| `maxHspeed` | 30 | m/s, per-fix horizontal speed cap |
| `maxVspeed` | 10 | m/s, per-fix vertical speed cap |
| `mergeFlightGapMs` | 180000 | merge flight blocks closer than this |
| `sustainedGroundMs` | 30000 | ground run needed to confirm a landing |
| `launchHspeedMax` | 1.5 | m/s, launch walks back to `hma` below this |

## Tests

```sh
npm test
```

`test/fixtures/` holds gzipped column fixtures with golden `segments` output
from the NorCal Hike and Fly league tracks. The golden tests require an exact
index match.

## Attribution and license

The detection algorithm is derived from the launch and landing detection in
[igc-xc-score](https://github.com/mmomtchev/igc-xc-score) by Momtchil Momtchev,
with modifications for hike and fly use (speed caps, block merging, launch
walk-back, sustained-ground landing). The distance formula is the FCC
approximation used by igc-xc-score's `Point.distanceEarth`.

igc-xc-score is licensed under the LGPL-3.0-or-later, and so is this package.
See `LICENSE` (LGPL) and `COPYING` (GPL, which the LGPL supplements).
