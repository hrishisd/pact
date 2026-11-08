import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CreatePact } from "./CreatePact.tsx";
import { answers, renderWithUser, stubApi } from "./testing/render.tsx";

test("a typed Camera name stays after Back, Oura Ring and an in-bed-by time", async () => {
  stubApi({ friends: answers([]), recipients: answers([]) });
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: true, ouraAvailable: true, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Camera/ }));
  await user.type(screen.getByLabelText(/^Name/), "Morning run");
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: /^Oura Ring/ }));
  fireEvent.change(screen.getByLabelText(/^In bed by/), { target: { value: "23:00" } });

  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Morning run");
});

test("with no name typed, an in-bed-by time names the pact", async () => {
  stubApi({ friends: answers([]), recipients: answers([]) });
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: true, ouraAvailable: true, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Oura Ring/ }));
  fireEvent.change(screen.getByLabelText(/^In bed by/), { target: { value: "23:00" } });

  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("In bed by 11pm");
});
