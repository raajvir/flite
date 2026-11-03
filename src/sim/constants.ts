/** Physical constants (SI). Not tunable — car/surface parameters live in data/. */
export const GRAVITY = 9.81; // m/s^2
export const AIR_DENSITY = 1.225; // kg/m^3, sea level, 15 °C
export const RPM_TO_RADPS = (2 * Math.PI) / 60;

/** Fixed simulation rate. */
export const SIM_HZ = 1000;
export const SIM_DT = 1 / SIM_HZ; // s
