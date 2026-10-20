import { parseSupabaseConnection } from '../config/supabase.js';

export function connectionWithPassword(config, uri, password) {
  const connection = parseSupabaseConnection({ ...config, supabaseDatabaseUrl: uri }, { allowPasswordPrompt: true });
  // Encode before assigning: the URL setter preserves literal percent signs.
  connection.password = encodeURIComponent(password);
  return parseSupabaseConnection({ ...config, supabaseDatabaseUrl: connection.toString() });
}

export function updateDatabaseUri(contents, uri) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const assignment = `SUPABASE_DATABASE_URL=${JSON.stringify(uri)}`;
  let replaced = false;
  const lines = contents.split(/\r?\n/).filter(line => {
    if (!/^\s*(?:export\s+)?SUPABASE_DATABASE_URL\s*=/.test(line)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  }).map(line => /^\s*(?:export\s+)?SUPABASE_DATABASE_URL\s*=/.test(line) ? assignment : line);
  if (!replaced) {
    if (lines.at(-1) === '') lines.pop();
    lines.push(assignment, '');
  }
  return lines.join(newline) + (lines.at(-1) === '' ? '' : newline);
}
