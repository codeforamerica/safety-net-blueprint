/**
 * What the explorer answers in the page for Whisper in this page, the
 * transcription session adapter it ships (whisper-adapter.js): the
 * credentials its credentials part would issue. Whisper needs none, so where to
 * connect names nothing real. routing.js sends the session adapter's API here
 * while Whisper is the session's adapter.
 */
export async function whisperCredentials(request) {
  const { metadata, provider } = await request.json();
  return Response.json({ metadata, provider, protocol: 'websocket', url: 'wss://whisper.invalid/in-this-page', expiresIn: 3600 });
}
