// Plain server-rendered pages for sign-in failures. They work without the SPA.

export function inviteRequiredPage(): string {
  return page(
    "You need an invite",
    `<h1>You need an invite</h1>
     <p>Pact is invite-only, and this Google account doesn't have one.</p>
     <p>Ask a friend who uses Pact to send you an invite link, then open it to sign in.</p>
     <p><a href="/">Back to sign in</a></p>`,
  );
}

export function signInFailedPage(): string {
  return page(
    "Sign-in didn't work",
    `<h1>Sign-in didn't work</h1>
     <p>Something went wrong while signing in with Google. Please try again.</p>
     <p><a href="/">Back to sign in</a></p>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#F1F4F0">
<title>${title} · Pact</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #F1F4F0; color: #17221D;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
             max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
    box-sizing: border-box;
  }
  main { max-width: 360px; background: #fff; border: 1px solid #D2DAD4; border-radius: 16px; padding: 20px; }
  h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -.01em; }
  p { margin: 0 0 12px; color: #56645C; }
  a { color: #22457A; font-weight: 600; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
