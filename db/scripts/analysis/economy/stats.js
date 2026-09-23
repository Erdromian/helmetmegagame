// Small arithmetic the analysis modules share, so each figure is worked out one way.

// The middle value, or the mean of the two middle values; null when there is no number to take it of.
function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

module.exports = { median };
