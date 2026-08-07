import { expect, it } from "bun:test";
import { createServer } from "node:http";

import {
  isPortlessRoutePublished,
  observePortlessRoute,
} from "./portless-observation";

it("treats unavailable as published once Portless owns the hostname", () => {
  expect(isPortlessRoutePublished("routed")).toBe(true);
  expect(isPortlessRoutePublished("unavailable")).toBe(true);
  expect(isPortlessRoutePublished("unregistered")).toBe(false);
});

it("classifies the observable Portless route contract", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/unregistered") {
      response.statusCode = 404;
      response.end("No app registered for <strong>127.0.0.1</strong>");
      return;
    }
    if (request.url === "/unavailable") {
      response.statusCode = 502;
      response.end("Bad Gateway");
      return;
    }
    response.statusCode = request.url === "/other-404" ? 404 : 200;
    response.end("upstream response");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Observation fixture did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await expect(observePortlessRoute(`${origin}/unregistered`)).resolves.toBe(
      "unregistered"
    );
    await expect(observePortlessRoute(`${origin}/unavailable`)).resolves.toBe(
      "unavailable"
    );
    await expect(observePortlessRoute(`${origin}/routed`)).resolves.toBe(
      "routed"
    );
    await expect(observePortlessRoute(`${origin}/other-404`)).resolves.toBe(
      "routed"
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await expect(observePortlessRoute(`${origin}/closed`)).resolves.toBe(
    "unavailable"
  );
});

it("classifies a route that does not respond within 500 ms as unavailable", async () => {
  const server = createServer(() => {
    // Leave the request open so the observer's timeout determines the result.
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Observation fixture did not expose a port");
  }
  const startedAt = performance.now();

  try {
    await expect(
      observePortlessRoute(`http://127.0.0.1:${address.port}/slow`)
    ).resolves.toBe("unavailable");
    expect(performance.now() - startedAt).toBeLessThan(1500);
  } finally {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
