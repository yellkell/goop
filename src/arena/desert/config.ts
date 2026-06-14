/**
 * Papercraft western desert — art-direction knobs. Ported from the `vrenv`
 * Paper Frontier project (yellkell/vrenv, claude/papercraft-desert): a golden
 * hour desert of folded-paper dunes, layered mesas, saguaro cacti and rolling
 * tumbleweeds, dropped in behind FIRE FIGHT's platforms as an optional arena.
 *
 * Almost every "feeling" of the scene is a number in here.
 */

export const CONFIG = {
  /** Overall art direction. */
  mood: {
    /** Sun height: 0 = on the horizon (long shadows), 1 = overhead. */
    sunElevation: 0.22,
    exposure: 1.0,
    haze: 0.5,
    viewDistance: 1500,
  },

  /** Warm golden-hour sky gradient (the inward-facing dome). */
  sky: {
    top: '#5f93cf', // warm daytime blue overhead
    horizon: '#f6cf94', // golden dust band at the horizon
    bottom: '#caa676', // sandy glow below
    intensity: 1.0,
  },

  /** Image-based lighting tint — warm, so paper glows at golden hour. */
  ibl: {
    sky: '#ffe9c6',
    ground: '#a98353',
    intensity: 1.05,
  },

  /** The construction-paper palette. */
  palette: {
    sandLight: '#e8c992',
    sandDark: '#cda86e',
    sun: '#ffdf8a',
    rockStrata: ['#a85638', '#c06b41', '#cf8350', '#b85a3a', '#9d4a30'],
    boulder: ['#bd7048', '#a9603c', '#caa06a'],
    cactus: '#6f9a5b',
    cactusDark: '#5b8049',
    flower: '#ec6a86',
    tumbleweed: ['#b59257', '#9a7842', '#caa978'],
    wood: '#875432',
    bone: '#ece2cb',
  },

  /** The folded-paper ground. */
  terrain: {
    seed: 23,
    size: 240, // width of the desert (meters)
    segments: 56, // facet density
    duneHeight: 3.2,
    flatRadius: 14, // level clearing around the platforms
  },

  /** Scattered boulders + the big horizon mesas. */
  rocks: {
    boulders: 64,
    mesas: 7,
    mesaRingMin: 70,
    mesaRingMax: 112,
  },

  /** Cacti. */
  cacti: {
    saguaro: 11,
    barrel: 8,
    pricklyPear: 7,
    clearRadius: 9, // keep clear of the platforms
  },

  /** Rolling plants — wind blows them mostly along +X. */
  tumbleweeds: {
    count: 9,
    windSpeed: 2.6,
    radius: 0.55,
  },
} as const;
