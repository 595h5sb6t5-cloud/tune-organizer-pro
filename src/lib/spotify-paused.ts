/** Clear message when Spotify has paused requests for the app (429 / quota). */
export function spotifyPausedMessage(data: any): string | null {
  if (data?.error_code !== "spotify_paused") return null;
  const at = data.retry_at ? new Date(data.retry_at) : null;
  const when = at ? at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "a while";
  return `Spotify paused requests for this app. Try again after ${when}.`;
}
