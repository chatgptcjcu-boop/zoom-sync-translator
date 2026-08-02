/**
 * 讀取環境變數（支援別名、去除空白／零寬字元）
 */
function normalizeKey(name) {
  return String(name || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .trim();
}

function envGet(...names) {
  for (const name of names) {
    const direct = process.env[name];
    if (direct != null && String(direct).trim() !== '') {
      return String(direct).trim();
    }
  }

  // 模糊比對：避免名稱含隱藏字元
  const wanted = names.map((n) => normalizeKey(n).toUpperCase());
  for (const [rawKey, rawVal] of Object.entries(process.env)) {
    const norm = normalizeKey(rawKey).toUpperCase();
    if (wanted.includes(norm) && rawVal != null && String(rawVal).trim() !== '') {
      return String(rawVal).trim();
    }
  }
  return '';
}

function envHas(...names) {
  return envGet(...names).length > 0;
}

module.exports = { envGet, envHas, normalizeKey };
