import { assertEquals } from "@std/assert";
import { nextPause } from "./self_runner.ts";

Deno.test("nextPause doubles current value", () => {
  assertEquals(nextPause(30), 60);
  assertEquals(nextPause(60), 120);
});

Deno.test("nextPause caps at 4 hours", () => {
  const fourHours = 4 * 60 * 60;
  assertEquals(nextPause(fourHours), fourHours);
  assertEquals(nextPause(fourHours / 2), fourHours);
  assertEquals(nextPause(10000), fourHours);
});

Deno.test("nextPause progression from 30s", () => {
  const max = 4 * 60 * 60;
  const expected = [60, 120, 240, 480, 960, 1920, 3840, 7680, max];
  let p = 30;
  for (const exp of expected) {
    p = nextPause(p);
    assertEquals(p, exp);
  }
});
