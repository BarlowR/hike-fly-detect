/** Column-oriented tracklog. All four arrays must have the same length. */
export interface Track {
  /** Epoch milliseconds, non-decreasing. A step of zero or less copies the previous fix's speeds. */
  timeMs: ArrayLike<number>;
  /** Degrees. */
  lat: ArrayLike<number>;
  /** Degrees. */
  lon: ArrayLike<number>;
  /** Metres. One altitude source, chosen by the caller. */
  alt: ArrayLike<number>;
}

export interface Thresholds {
  /** Moving-average window in seconds (centered). Default 10. */
  maPeriodS: number;
  /** Seconds the flight conditions must hold before stateFlight is set. Default 10. */
  flightHoldS: number;
  /** hma (m/s) that starts a flight candidate. Default 6. */
  flightStartHspeed: number;
  /** vma (m/s) that starts a flight candidate. Default 0.3. */
  flightStartVspeed: number;
  /** hma (m/s) below which a flight candidate is dropped. Default 1.5. */
  flightKeepHspeed: number;
  /** vma (m/s) below which a flight candidate is dropped. Default 0.05. */
  flightKeepVspeed: number;
  /** hma (m/s) below which a fix can be stateGround. Default 5. */
  groundMaxHspeed: number;
  /** vma (m/s) below which a fix can be stateGround. Default 0.5. */
  groundMaxVspeed: number;
  /** Per-fix horizontal speed cap (m/s) applied before averaging. Default 30. */
  maxHspeed: number;
  /** Per-fix vertical speed cap (m/s) applied before averaging. Default 10. */
  maxVspeed: number;
  /** stateFlight blocks closer than this are merged. Default 180000. */
  mergeFlightGapMs: number;
  /** A stateGround run must last this long to count as a landing. Default 30000. */
  sustainedGroundMs: number;
  /** Launch walks back to the last fix with hma below this (m/s). Default 1.5. */
  launchHspeedMax: number;
}

/** Index pair into the caller's columns. Fix i is in the air when launch < i < landing. */
export interface Segment {
  launch: number;
  landing: number;
}

export interface Analysis {
  /** Launch/landing index pairs, sorted by launch, non-overlapping. */
  segments: Segment[];
  /** 1 = on foot, 0 = in the air. */
  onGround: Uint8Array;
  /** 1 where the flight conditions held for flightHoldS. */
  stateFlight: Uint8Array;
  /** 1 where both averages are below the ground maxima. */
  stateGround: Uint8Array;
  /** Moving average of horizontal speed, m/s. */
  hma: Float64Array;
  /** Moving average of absolute vertical speed, m/s. */
  vma: Float64Array;
}

export const DEFAULT_THRESHOLDS: Readonly<Thresholds>;

/** Great-circle distance in kilometres (FCC approximation, as igc-xc-score's Point.distanceEarth). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number;

/** Full analysis with every intermediate column. Throws if the track has fewer than 5 fixes. */
export function analyzeTrack(track: Track, opts?: Partial<Thresholds>): Analysis;

/** Only the launch/landing index pairs. Throws if the track has fewer than 5 fixes. */
export function detectFlightSegments(track: Track, opts?: Partial<Thresholds>): Segment[];
