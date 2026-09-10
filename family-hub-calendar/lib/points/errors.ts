/**
 * Turns the ledger RPCs' raised exceptions into something readable on a wall
 * tablet. `redeem_reward` raises `insufficient_points: have 5, need 8` and
 * `reward_not_available`; anything else is unexpected and shown as-is rather
 * than swallowed.
 */
export function redeemErrorMessage(raw: string, memberName: string): string {
  const shortfall = /insufficient_points:\s*have\s*(-?\d+),\s*need\s*(\d+)/i.exec(raw);
  if (shortfall) {
    const have = Number(shortfall[1]);
    const need = Number(shortfall[2]);
    const missing = Math.max(need - have, 1);
    return `${memberName} needs ${missing} more point${missing === 1 ? '' : 's'} for that.`;
  }

  if (/insufficient_points/i.test(raw)) {
    return `${memberName} does not have enough points for that yet.`;
  }

  if (/reward_not_available/i.test(raw)) {
    return 'That reward is no longer available.';
  }

  if (/member_not_found/i.test(raw)) {
    return 'That family member no longer exists.';
  }

  return raw;
}
