import { GATE_MODES, type GateMode } from './types';

/** §6.4 — clicking the permission button cycles locked → ask → unlocked → locked. */
export function nextGateMode(mode: GateMode): GateMode {
  const i = GATE_MODES.indexOf(mode);
  return GATE_MODES[(i + 1) % GATE_MODES.length]!;
}

interface OptionLike {
  optionId?: string;
  name?: string;
  kind?: string;
}

/**
 * `kind` is the strongest signal — per the ACP spec options carry allow_once,
 * allow_always, reject_once, or reject_always. Name matching is a fallback for
 * servers that omit it. Harvested from prototype acpClient.js:50-53.
 */
export function isAllowOption(o: OptionLike): boolean {
  if (o.kind?.startsWith('allow')) return true;
  return /\b(allow|approve|yes|accept|permit)\b/i.test(o.name ?? o.optionId ?? '');
}

export function isRejectOption(o: OptionLike): boolean {
  if (o.kind?.startsWith('reject')) return true;
  return /\b(reject|deny|no|cancel|decline|refuse)\b/i.test(o.name ?? o.optionId ?? '');
}
