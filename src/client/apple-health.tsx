// Apple Health pieces more than one screen uses: the alert when an Apple
// Health pact's account has no upload key (Today and the pact's page).

import { APP_PATHS } from "../shared/api.ts";
import { RECONNECT_TEXT } from "../shared/types.ts";

/**
 * Apple Health is disconnected while a bedtime pact needs it: set up opens
 * the Apple Health page, which makes a new upload key. It never needs
 * reconnecting: Pact doesn't call Apple Health, its Shortcut posts to Pact.
 */
export function AppleHealthConnectionAlert() {
  return (
    <div className="alert bad" role="status">
      <span>
        <b>Apple Health is disconnected.</b> {RECONNECT_TEXT.apple_health}
      </span>
      <div className="row2">
        <a className="btn sm primary" href={APP_PATHS.appleHealth}>
          Set up Apple Health
        </a>
      </div>
    </div>
  );
}
