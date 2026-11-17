import type { UserEvent } from '@testing-library/user-event';

/**
 * Enters `text` into a field like a user pasting it: focus, then one paste
 * (one input event). `user.type` sends a full key sequence per character, and
 * in the invoice form every keystroke re-renders the form and the live
 * preview, which made these tests slow enough to time out on a loaded
 * machine. Use `user.type` where per-key behaviour is what is under test.
 */
export async function fill(user: UserEvent, element: Element, text: string): Promise<void> {
  await user.click(element);
  await user.paste(text);
}
