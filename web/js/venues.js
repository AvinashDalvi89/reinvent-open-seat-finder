// re:Invent campus: rough travel minutes between venues, door to door.
// Estimates, not official: walking within a cluster, shuttle to/from MGM Grand.
// Edit TRAVEL if your on-site experience differs.

// Listed north -> south along the Strip; `short` labels the route diagram,
// `maps` is the destination text handed to Google Maps directions.
export const VENUES = {
  wynn:    { name: 'Wynn/Encore',    short: 'Wynn',     cluster: 'north',  maps: 'Wynn Las Vegas' },
  venetian:{ name: 'Venetian',       short: 'Venetian', cluster: 'north',  maps: 'The Venetian Resort Las Vegas' },
  forum:   { name: 'Caesars Forum',  short: 'Forum',    cluster: 'center', maps: 'Caesars Forum, 3911 Koval Ln, Las Vegas, NV' },
  caesars: { name: 'Caesars Palace', short: 'Caesars',  cluster: 'center', maps: 'Caesars Palace Las Vegas' },
  paris:   { name: 'Paris',          short: 'Paris',    cluster: 'center', maps: 'Paris Las Vegas' },
  mgm:     { name: 'MGM Grand',      short: 'MGM',      cluster: 'south',  maps: 'MGM Grand Las Vegas' },
  mandalay:{ name: 'Mandalay Bay',   short: 'Mandalay', cluster: 'south',  maps: 'Mandalay Bay Las Vegas' },
};
export const STRIP_ORDER = Object.keys(VENUES);

/** Google Maps walking directions between two venues (plain URL, no API key). */
export function directionsUrl(a, b) {
  const qs = new URLSearchParams({ api: '1', origin: VENUES[a].maps, destination: VENUES[b].maps, travelmode: 'walking' });
  return `https://www.google.com/maps/dir/?${qs}`;
}

const TRAVEL = {
  'wynn|venetian': 15, 'forum|venetian': 15, 'forum|wynn': 25,
  'caesars|forum': 15, 'caesars|venetian': 20, 'caesars|wynn': 25,
  'caesars|paris': 10, 'forum|paris': 15, 'paris|venetian': 20, 'paris|wynn': 25,
  'mgm|paris': 30, 'caesars|mgm': 35, 'forum|mgm': 35, 'mgm|venetian': 40, 'mgm|wynn': 45,
  'mandalay|mgm': 20, 'mandalay|paris': 40, 'caesars|mandalay': 45, 'forum|mandalay': 45,
  'mandalay|venetian': 50, 'mandalay|wynn': 55,
};

const PATTERNS = [
  ['wynn', /wynn|encore/i],
  ['venetian', /venetian|palazzo/i],
  ['forum', /caesars forum|koval/i],
  ['caesars', /caesars palace|caesars/i],
  ['paris', /paris|mon ami gabi/i],
  ['mgm', /mgm/i],
  ['mandalay', /mandalay/i],
];

/** Venue key from free text (session venue or calendar location), or null if unknown/TBC. */
export function venueKey(text) {
  if (!text) return null;
  const hit = PATTERNS.find(([, re]) => re.test(text));
  return hit ? hit[0] : null;
}

/** Minutes to get from a to b; null when either end is unknown. */
export function travelMinutes(a, b) {
  if (!a || !b) return null;
  if (a === b) return 0; // same building: back-to-back is fine
  return TRAVEL[[a, b].sort().join('|')] ?? 30;
}

export const venueName = (key) => VENUES[key]?.name || 'Venue TBD';
