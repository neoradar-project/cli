export const getCurrentAiracCycle = () => {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // Months are 0-indexed in JavaScript
  const cycleMonth = Math.ceil(month / 2) * 2; // AIRAC cycles are every 28 days, so we round up to the nearest even month
  const cycleYear = cycleMonth > 12 ? year + 1 : year; // If the month exceeds December, increment the year
  const cycleMonthStr =
    cycleMonth > 9 ? cycleMonth.toString() : `0${cycleMonth}`;
  return `${cycleYear.toFixed(0).slice(2)}${cycleMonthStr}`;
};
