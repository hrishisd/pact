// The dom project's setup file cleans up after every test, even in a file
// that renders with Testing Library directly instead of through render.tsx.

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("a screen one test renders…", () => {
  render(<p>left over</p>);
  expect(screen.getByText("left over")).toBeTruthy();
});

test("…is gone in the next", () => {
  expect(document.body.innerHTML).toBe("");
});
