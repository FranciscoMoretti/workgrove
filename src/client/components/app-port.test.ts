import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppPort, AppPortList } from "./app-port";

describe("app port typography", () => {
  it("renders ports as tabular monospace code", () => {
    expect(renderToStaticMarkup(createElement(AppPort, { port: 3000 }))).toBe(
      '<code class="font-mono tabular-nums">3000</code>'
    );
  });

  it("keeps every port in a labeled list on the shared typography", () => {
    const markup = renderToStaticMarkup(
      createElement(AppPortList, {
        apps: [
          { label: "Chat", port: 3000 },
          { label: "Site", port: 3002 },
        ],
      })
    );

    expect(markup).toContain(
      'Chat <code class="font-mono tabular-nums">3000</code>'
    );
    expect(markup).toContain(
      'Site <code class="font-mono tabular-nums">3002</code>'
    );
  });
});
