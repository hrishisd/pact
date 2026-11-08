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

test("a pact that's created keeps Create pact disabled while the page goes to it", async () => {
  stubApi({
    friends: answers([{ id: "ana", name: "Ana" }]),
    recipients: answers([{ id: "sam", name: "Sam" }]),
    firstOccurrence: answers({ ok: true, firstOccurrence: { date: "2026-01-05", dueAt: "2026-01-06T05:00:00Z" } }),
    createPact: answers({ ok: true, pactId: "gym" }),
  });
  const onCreated = vi.fn();
  const { user } = renderWithUser(
    <CreatePact
      connections={{ ouraConnected: false, ouraAvailable: false, ankiConnected: false, ankiAvailable: false }}
      onCancel={vi.fn()}
      onCreated={onCreated}
      onInvite={vi.fn()}
    />,
  );
  const next = () => user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: /^Camera/ }));
  await user.type(screen.getByLabelText(/^Name/), "Gym");
  await user.type(screen.getByLabelText(/^What will your photo show/), "Me at the gym");
  await next();
  await user.click(screen.getByRole("button", { name: "Every day" }));
  await next();
  await user.type(screen.getByLabelText(/^Penalty per miss/), "5");
  await next();
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await next();
  await next();
  const create = screen.getByRole("button", { name: "Create pact" });
  await user.click(create);

  expect(onCreated).toHaveBeenCalledWith("gym", "Gym");
  expect((create as HTMLButtonElement).disabled).toBe(true);
});
