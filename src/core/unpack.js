// The production build embeds the map data deflated + base64 ({ packed }); dev and Node use the
// plain JSON object. Returns the world object either way.
export async function unpackWorld(raw) {
  if (!raw || !raw.packed) return raw;
  const bin = atob(raw.packed), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return JSON.parse(await new Response(stream).text());
}
