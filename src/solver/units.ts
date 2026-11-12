/** 1 LPM = 1/60000 m3/s. */
export const LPM_PER_M3S = 60000;

export const lpmToM3s = (lpm: number): number => lpm / LPM_PER_M3S;
export const m3sToLpm = (q: number): number => q * LPM_PER_M3S;

export const pipeArea = (diameterM: number): number => (Math.PI / 4) * diameterM * diameterM;

/** Hazen-Williams SI constant and exponents. */
export const HW_CONSTANT = 10.67;
export const HW_FLOW_EXPONENT = 1.852;
export const HW_DIAMETER_EXPONENT = 4.87;
