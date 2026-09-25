const fs = require('fs');
const path = require('path');

function stripQuotes(value) {
  if (value.length >= 2) {
    const start = value[0];
    const end = value[value.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function applyEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(line.slice(eq + 1).trim());
  }
}

function loadConfigEnv(fromDir) {
  const candidates = [
    path.resolve(fromDir, '../config/.env'),
    path.resolve(fromDir, 'config/.env'),
    '/app/config/.env',
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    applyEnvFile(filePath);
    return filePath;
  }
  return '';
}

module.exports = { loadConfigEnv };
