/**
 * Papercraft western desert — art-direction knobs. Ported from the `vrenv`
 * Paper Frontier project (yellkell/vrenv, claude/papercraft-desert): a low-sun
 * desert of folded-paper dunes, layered mesas, saguaro cacti and rolling
 * tumbleweeds, dropped in behind FIRE FIGHT's platforms as an optional arena.
 *
 * Almost every "feeling" of the scene is a number in here.
 */

export const CONFIG = {
  /** Overall art direction. */
  mood: {
    /** Sun height: 0 = on the horizon (long shadows), 1 = overhead. */
    sunElevation: 0.13,
    exposure: 0.86,
    haze: 0.5,
    viewDistance: 1500,
  },

  /** Dawn-or-dusk sky gradient (the inward-facing dome). */
  sky: {
    top: '#3d5f91', // muted blue-violet overhead, not midday cyan
    horizon: '#eda36f', // peach dust band at the low sun line
    bottom: '#8d6a69', // rosy earth glow below the horizon
    intensity: 1.0,
  },

  /** Image-based lighting tint — warm enough for dawn, cool enough for dusk. */
  ibl: {
    sky: '#f3b895',
    ground: '#76545c',
    intensity: 0.82,
  },

  /** The construction-paper palette. */
  palette: {
    sandLight: '#d9aa72',
    sandDark: '#a8684f',
    sun: '#ffb36f',
    rockStrata: ['#a85638', '#c06b41', '#cf8350', '#b85a3a', '#9d4a30'],
    boulder: ['#bd7048', '#a9603c', '#caa06a'],
    cactus: '#6f9a5b',
    cactusDark: '#5b8049',
    flower: '#ec6a86',
    tumbleweed: ['#b59257', '#9a7842', '#caa978'],
    wood: '#875432',
    bone: '#ece2cb',
    agave: '#8aa86a',
    cloud: '#f4e8d4',
    dust: ['#d8bd92', '#c2a072', '#cdb487'],
  },

  /** The folded-paper ground. */
  terrain: {
    seed: 23,
    size: 240, // width of the desert (meters)
    segments: 56, // facet density
    duneHeight: 3.2,
    flatRadius: 14, // level clearing around the platforms
    platformReveal: 0.14, // lower the clearing so the platform slabs read as raised
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

  /** Splayed agave rosettes that sway in the wind near the clearing. */
  agave: {
    count: 15,
    clearRadius: 7,
    spread: 46, // kept mid-ground so distant sand stays clean
  },

  /** Slow paper clouds drifting above the mesas. */
  clouds: {
    count: 6,
    heightMin: 36,
    heightMax: 58,
    spread: 110,
    drift: 0.55, // base x-speed (m/s)
  },

  /** Occasional dust devils that spin up, wander and dissipate. */
  dustDevils: {
    maxActive: 2,
    firstAt: 9, // seconds after the desert first shows
    intervalMin: 16,
    intervalMax: 30,
    fieldHalf: 92,
  },
} as const;
