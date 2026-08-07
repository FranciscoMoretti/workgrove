export type PortlessRouteObservation =
  | "routed"
  | "unavailable"
  | "unregistered";

/** True once Portless owns the hostname; backend health is readiness, not routing. */
export function isPortlessRoutePublished(
  observation: PortlessRouteObservation
): boolean {
  return observation !== "unregistered";
}

export async function observePortlessRoute(
  url: string
): Promise<PortlessRouteObservation> {
  try {
    const hostname = new URL(url).hostname;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(500),
    });
    const body = await response.text();
    if (
      response.status === 404 &&
      body.includes(`No app registered for <strong>${hostname}</strong>`)
    ) {
      return "unregistered";
    }
    return response.status === 502 ? "unavailable" : "routed";
  } catch {
    return "unavailable";
  }
}
