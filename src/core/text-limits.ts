// The caps on free text: a name has MAX_NAME_CHARS, any other text
// MAX_TEXT_CHARS, both counted once trimmed. Every command that takes free
// text refuses longer text with `text-too-long`.

import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../shared/types.ts";

/** Whether trimmed `text` (none counts as empty) is over the cap for other text. */
export function textTooLong(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > MAX_TEXT_CHARS;
}

/** Whether trimmed `name` is over the cap for a name. */
export function nameTooLong(name: string): boolean {
  return name.trim().length > MAX_NAME_CHARS;
}
