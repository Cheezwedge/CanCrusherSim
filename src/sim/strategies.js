// The six standard crushing strategies compared by "Run 6 strategies" and by
// the precomputed reference table. Values are in UI units (mm, degrees).
export const STRATEGIES = [
  { key: 'axial', name: 'Top-down, full plate', over: { tilt: 0, tool: 'plate', plateW: 100, plateL: 100, dent: 0, gap: 25 } },
  { key: 'dent', name: 'Top-down after a 3 mm side dent', over: { tilt: 0, tool: 'plate', plateW: 100, plateL: 100, dent: 3, dentH: 50, dentFace: 'side', gap: 25 } },
  { key: 'tilt', name: 'Top-down, can tilted 15°', over: { tilt: 15, tool: 'plate', plateW: 100, plateL: 100, dent: 0, gap: 25 } },
  { key: 'punch', name: 'Top-down, Ø40 punch on the lid', over: { tilt: 0, tool: 'punch', punchD: 40, edgeR: 3, dent: 0, gap: 25 } },
  { key: 'sidePlate', name: 'Side, full plate', over: { tilt: 90, tool: 'plate', plateW: 100, plateL: 100, dent: 0, gap: 12 } },
  { key: 'sideBar', name: 'Side, Ø20 bar across the middle', over: { tilt: 90, tool: 'bar', barD: 20, barL: 120, dent: 0, gap: 12 } },
];

/** Second-press platen shapes offered in the UI (see tools/study-platen-shapes.mjs). */
export const PLATEN_SHAPES = {
  flat: { shape: 'flat' },
  convex400: { shape: 'convex', radius: 0.4 },
  convex250: { shape: 'convex', radius: 0.25 },
  concave400: { shape: 'concave', radius: 0.4 },
  roof5: { shape: 'roof', angleDeg: 5 },
  valley5: { shape: 'valley', angleDeg: 5 },
  tilt8: { shape: 'tilt', angleDeg: 8 },
  hinge: { shape: 'hinge' },
};

export const UI_DEFAULTS = {
  canPreset: 'std355', wall: 0.097, imperf: 0.08, dent: 0, dentH: 50, dentFace: 'side', seed: 7,
  tilt: 0, tool: 'plate', plateW: 100, plateL: 100, plateT: 20, barD: 20, barL: 120, punchD: 40, punchH: 30, edgeR: 3,
  yaw: 0, offX: 0, offZ: 0, mu: 0.25, gap: 25, res: 'standard', rod: 18,
  platen: false, platenGap: 6, platenShape: 'flat',
};

/** Convert UI settings (mm, degrees) into physics parameters (SI units). */
export function uiToParams(u) {
  const tool = { type: u.tool, yawDeg: u.yaw, offsetX: u.offX / 1000, offsetZ: u.offZ / 1000, ramDiameter: (u.rod ?? 18) / 1000 };
  if (u.tool === 'plate') Object.assign(tool, { width: u.plateW / 1000, length: u.plateL / 1000, thickness: u.plateT / 1000, edgeRadius: 0.003 });
  if (u.tool === 'bar') Object.assign(tool, { diameter: u.barD / 1000, length: u.barL / 1000 });
  if (u.tool === 'punch') Object.assign(tool, { diameter: u.punchD / 1000, height: u.punchH / 1000, edgeRadius: u.edgeR / 1000 });
  const dentAz = u.dentFace === 'crusher' && u.tilt > 45 ? 90 : 0;
  return {
    can: u.canPreset,
    canOverrides: { wall: u.wall },
    resolution: u.res,
    tiltDeg: u.tilt,
    tool,
    friction: u.mu,
    imperfection: u.imperf,
    seed: u.seed,
    dent: { depth: u.dent, heightFrac: u.dentH / 100, azimuthDeg: dentAz, width: 5 },
    finalGap: u.gap / 1000,
    secondPress: { enabled: !!u.platen, size: 0.16, finalGap: (u.platenGap ?? 6) / 1000, ...PLATEN_SHAPES[u.platenShape || 'flat'] },
  };
}

/** Physics parameters for a strategy applied on top of base UI settings. */
export function strategyParams(s, base = {}) {
  const u = { ...UI_DEFAULTS, ...base, ...s.over, yaw: 0, offX: 0, offZ: 0, platen: false };
  if (base.resolution) u.res = base.resolution;
  return uiToParams(u);
}
