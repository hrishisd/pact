// The daily summary's words: plain text and simple HTML, as the email
// notifications prototype (round 2) has them. What goes in it is decided in
// stale-items.ts; this only writes it.

import { APP_PATHS } from "../shared/api.ts";
import type { Email } from "./ports.ts";

/** One item or question in a section: who and what, then what it's about and how long it has waited. */
export interface SummaryLine {
  /** "Sam's evidence", or "Sam asked about your evidence". */
  title: string;
  /** The pact, a payment's "To Oxfam", or a vacation's dates. */
  about: string;
  /** "waited 2 days", or "asked 2 days ago". */
  age: string;
}

interface Section {
  heading: string;
  intro: string;
  lines: SummaryLine[];
  link: { label: string; path: string };
}

const SUBJECT = "Pact daily summary";
const FOOTER =
  "You're getting this because you turned on the daily summary in Pact. It comes at 9am your time, only on days something has waited more than a day.";
const TURN_OFF = "Turn it off in Profile";

/**
 * The daily summary to `to`, with a section for each list that has
 * something, oldest first as given. Links start with `appUrl`.
 */
export function summaryEmail(
  to: string,
  appUrl: string,
  lists: { waiting: SummaryLine[]; questions: SummaryLine[] },
): Email {
  const { waiting, questions } = lists;
  const lead = [
    waiting.length > 0 && `${count(waiting.length, "item is waiting", "items are waiting")} for your review.`,
    questions.length > 0 &&
      `${count(questions.length, "question is waiting", "questions are waiting")} for your reply.`,
  ]
    .filter(Boolean)
    .join(" ");
  const sections: Section[] = [];
  if (waiting.length > 0) {
    sections.push({
      heading: "Items waiting for your review",
      intro: "Each has waited more than a day.",
      lines: waiting,
      link: { label: "Open your Review Queue", path: APP_PATHS.review },
    });
  }
  if (questions.length > 0) {
    sections.push({
      heading: "Questions waiting for your reply",
      intro: "Your reviewers asked about these instead of deciding them. Reply so they can decide.",
      lines: questions,
      link: { label: "Open Today", path: APP_PATHS.today },
    });
  }
  const url = (path: string) => new URL(path, appUrl).toString();
  return {
    to,
    subject: SUBJECT,
    text: plainText(lead, sections, url),
    html: html(lead, sections, url),
  };
}

function plainText(lead: string, sections: Section[], url: (path: string) => string): string {
  const parts = [
    lead,
    ...sections.map(({ heading, intro, lines, link }) =>
      [
        `${heading}\n${intro}`,
        ...lines.map(({ title, about, age }) => `${title}\n${about} · ${age}`),
        `${link.label}: ${url(link.path)}`,
      ].join("\n\n"),
    ),
    `--\n${FOOTER}\n${TURN_OFF}: ${url(APP_PATHS.profile)}`,
  ];
  return `${parts.join("\n\n")}\n`;
}

// Email clients drop <style>, so every style is inline. The colours are the app's (styles.css).
const C = {
  paper: "#f1f4f0",
  surface: "#ffffff",
  ink: "#17221d",
  muted: "#56645c",
  line: "#d2dad4",
  accent: "#22457a",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function html(lead: string, sections: Section[], url: (path: string) => string): string {
  const row = ({ title, about, age }: SummaryLine, first: boolean) =>
    `<tr><td style="padding:11px 0;${first ? "" : `border-top:1px solid ${C.line};`}font-family:${FONT};">` +
    `<div style="font-size:16px;font-weight:600;color:${C.ink};line-height:1.35;">${escape(title)}</div>` +
    `<div style="font-size:14px;color:${C.muted};line-height:1.4;">${escape(about)} · ${escape(age)}</div>` +
    `</td></tr>`;
  const section = ({ heading, intro, lines, link }: Section) =>
    `<tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:14px;padding:18px 18px 20px;">` +
    `<h2 style="margin:0 0 4px;font-family:${FONT};font-size:19px;line-height:1.25;font-weight:700;color:${C.ink};">${heading}</h2>` +
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.45;color:${C.muted};">${intro}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">` +
    lines.map((line, i) => row(line, i === 0)).join("") +
    `</table>` +
    `<p style="margin:14px 0 0;font-family:${FONT};font-size:15px;line-height:1.45;">` +
    `<a href="${escape(url(link.path))}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px;">${link.label}</a>` +
    `</p></td></tr>` +
    `<tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`;
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:${C.paper};">` +
    // Mail shows the first text as the preview: the lead line, hidden here because the body repeats it.
    `<div style="display:none;max-height:0;overflow:hidden;">${lead}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${C.paper};border-collapse:collapse;">` +
    `<tr><td style="padding:20px 14px 28px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:separate;border-spacing:0;">` +
    `<tr><td style="padding:0 4px 4px;font-family:${FONT};font-size:20px;font-weight:700;color:${C.accent};letter-spacing:-0.01em;">Pact</td></tr>` +
    `<tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:15px;line-height:1.45;color:${C.ink};">${lead}</td></tr>` +
    sections.map(section).join("") +
    `<tr><td style="padding:2px 4px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">` +
    `${FOOTER}<br><a href="${escape(url(APP_PATHS.profile))}" style="color:${C.accent};">${TURN_OFF}</a>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

/** "1 item is waiting", "4 items are waiting". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Text as HTML: names and pacts are the people's own words. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
