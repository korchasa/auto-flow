import { assertEquals } from "@std/assert";
import { buildUpdateCommand, checkForUpdate } from "./version.ts";

/**
 * Build a fake fetch() returning a Response with the given body JSON and status.
 * Used to isolate checkForUpdate() from network.
 */
function fakeFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

Deno.test("buildUpdateCommand — format with jsr specifier and version", () => {
  assertEquals(
    buildUpdateCommand("1.2.3"),
    "deno install -g -A -f jsr:@korchasa/flowai-workflow@1.2.3",
  );
});

Deno.test("checkForUpdate — newer remote version sets updateAvailable=true", async () => {
  const result = await checkForUpdate("0.1.6", {
    fetch: fakeFetch({ latest: "0.2.0" }),
  });
  assertEquals(result?.updateAvailable, true);
  assertEquals(result?.currentVersion, "0.1.6");
  assertEquals(result?.latestVersion, "0.2.0");
  assertEquals(
    result?.updateCommand,
    "deno install -g -A -f jsr:@korchasa/flowai-workflow@0.2.0",
  );
});

Deno.test("checkForUpdate — same version sets updateAvailable=false", async () => {
  const result = await checkForUpdate("0.1.6", {
    fetch: fakeFetch({ latest: "0.1.6" }),
  });
  assertEquals(result?.updateAvailable, false);
});

Deno.test("checkForUpdate — older remote version sets updateAvailable=false", async () => {
  const result = await checkForUpdate("0.2.0", {
    fetch: fakeFetch({ latest: "0.1.6" }),
  });
  assertEquals(result?.updateAvailable, false);
});

Deno.test("checkForUpdate — non-200 response returns null (fail-open)", async () => {
  const result = await checkForUpdate("0.1.6", {
    fetch: fakeFetch({ error: "not found" }, 404),
  });
  assertEquals(result, null);
});

Deno.test("checkForUpdate — invalid JSON returns null (fail-open)", async () => {
  const brokenFetch: typeof globalThis.fetch = () =>
    Promise.resolve(
      new Response("not json at all", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const result = await checkForUpdate("0.1.6", { fetch: brokenFetch });
  assertEquals(result, null);
});

Deno.test("checkForUpdate — missing 'latest' field returns null", async () => {
  const result = await checkForUpdate("0.1.6", {
    fetch: fakeFetch({ versions: { "0.1.6": {} } }),
  });
  assertEquals(result, null);
});

Deno.test("checkForUpdate — network error returns null (fail-open)", async () => {
  const erroringFetch: typeof globalThis.fetch = () =>
    Promise.reject(new TypeError("network down"));
  const result = await checkForUpdate("0.1.6", { fetch: erroringFetch });
  assertEquals(result, null);
});

Deno.test("checkForUpdate — abort/timeout returns null (fail-open)", async () => {
  const hangingFetch: typeof globalThis.fetch = (
    _url,
    init?: RequestInit,
  ): Promise<Response> => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }
    });
  };
  const result = await checkForUpdate("0.1.6", {
    fetch: hangingFetch,
    timeoutMs: 10,
  });
  assertEquals(result, null);
});

Deno.test("checkForUpdate — unparseable current version returns null (fail-open)", async () => {
  const result = await checkForUpdate("dev", {
    fetch: fakeFetch({ latest: "0.1.6" }),
  });
  assertEquals(result, null);
});
