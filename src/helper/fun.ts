function isHalloweenWeek() {
  const today = new Date();
  const start = new Date(today.getFullYear(), 9, 14);
  const end = new Date(today.getFullYear(), 9, 31);
  return today >= start && today <= end;
}
