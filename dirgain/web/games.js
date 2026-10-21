// Degrees of camera rotation per mouse count at in-game sensitivity 1. These are the widely
// cited engine constants; check them against your game if your cm/360 looks off.
export const GAMES = [
  { id: "valorant", name: "Valorant", yaw: 0.07, fov: 103, sens: 0.35 },
  { id: "cs2", name: "Counter-Strike 2", yaw: 0.022, fov: 106.26, sens: 1.2 },
  { id: "apex", name: "Apex Legends", yaw: 0.022, fov: 110, sens: 1.5 },
  { id: "ow2", name: "Overwatch 2", yaw: 0.0066, fov: 103, sens: 5 },
  { id: "cod", name: "Call of Duty (MW / Warzone)", yaw: 0.0066, fov: 100, sens: 5 },
  { id: "custom", name: "Other game (enter cm/360)", yaw: null, fov: 100, sens: null },
];

export function gameById(id) {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

// Camera degrees per mouse count for the current settings.
export function degPerCount(settings) {
  const g = gameById(settings.game);
  if (g.yaw === null) return 360 / ((settings.cm360 / 2.54) * settings.dpi);
  return g.yaw * settings.sens;
}

export function cm360(settings) {
  return (360 / (degPerCount(settings) * settings.dpi)) * 2.54;
}
