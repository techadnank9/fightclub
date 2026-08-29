// Shared palette + tuning knobs. No logic here.

export const LANG_COLORS = {
  TypeScript: 0x3178c6,
  JavaScript: 0xf1e05a,
  Rust:       0xdea584,
  Python:     0x3572a5,
  C:          0x555555,
  'C++':      0xf34b7d,
  Go:         0x00add8,
  Ruby:       0x701516,
  Dart:       0x00b4ab,
  Zig:        0xec915c,
  default:    0x8b96c2,
};

export const AGENT_COLORS = {
  sonnet:     0xffb347,
  opus:       0xff8c69,
  haiku:      0xffd97a,
  gpt:        0x7ec8ff,
  'gpt-mini': 0xa5d8ff,
  gemini:     0x6fd68a,
  referee:    0xc9a5ff,
};

export const CITY = {
  blockSize: 26,        // building lot pitch
  streetWidth: 10,
  fightLotIndex: null,  // assigned at layout time (center-ish empty lot)
  fogColor: 0x0a0e1a,
  fogNear: 130,
  fogFar: 950,   // was 420 when the city floated in void; the world extends to ~900
};

export const TOWER = {
  floorHeight: 2.2,
  baseWidth: 9,
  maxFloors: 10,        // fight tower cap
};
