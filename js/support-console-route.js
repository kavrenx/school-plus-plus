const TARGET_HASH =
  /^#(conversation|request)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseSupportConsoleTarget(hash) {
  const match = TARGET_HASH.exec(hash);
  if (!match) return null;
  return { kind: match[1].toLowerCase(), id: match[2].toLowerCase() };
}
