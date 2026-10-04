import { envNumber } from './env.js';

/** How long an unpaid checkout keeps its items out of other shoppers' reach. */
export const orderHoldMinutes = () => {
  const minutes = envNumber('ORDER_HOLD_MINUTES', 30);
  return Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : 30;
};

/** How often (minutes) unpaid orders past their hold are expired. */
export const orderExpiryIntervalMinutes = () => envNumber('ORDER_EXPIRY_INTERVAL_MINUTES', 10);
