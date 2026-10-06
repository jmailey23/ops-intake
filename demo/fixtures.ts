/**
 * Oakline Builders is fictional. The shapes of these notes are not: they are
 * the kinds of mail a remodeling company's owner actually sends himself at
 * the end of the day.
 */
import type { Job, Mail, Person } from "../src/types.ts";

export const team: Person[] = [
  { id: "p-dana", name: "Dana Reyes", emails: ["dana@oakline.co", "dana.reyes@gmail.com"], role: "owner" },
  { id: "p-priya", name: "Priya Shah", emails: ["priya@oakline.co"], role: "office" },
  { id: "p-marcus", name: "Marcus Bell", emails: ["marcus@oakline.co"], role: "pm" },
];

export const jobs: Job[] = [
  { id: "j-alder", name: "4412 Alder Ave remodel", aliases: ["alder", "alder ave"] },
  { id: "j-hollis", name: "Hollis kitchen", aliases: ["hollis"] },
  { id: "j-ridge", name: "Ridge Rd addition", aliases: ["ridge", "ridge rd"] },
];

export const mail: Mail[] = [
  {
    messageId: "m1",
    from: "Dana Reyes <dana.reyes@gmail.com>",
    to: "dana@oakline.co",
    subject: "Alder tomorrow",
    body: "- Marcus order the tile for the primary bath\n- confirm dumpster swap Thursday\n- call the client about the change order on the vanity\n\nSent from my iPhone",
    date: "2026-10-06T22:14:00-05:00",
  },
  {
    messageId: "m2",
    from: "dana@oakline.co",
    to: "priya@oakline.co",
    subject: "Hollis",
    body: "Water stain under the sink at Hollis, looks like the supply line is leaking. Get the plumber out asap.",
    date: "2026-10-07T07:02:00-05:00",
  },
  {
    messageId: "m3",
    from: "dana@oakline.co",
    to: "marcus@oakline.co",
    subject: "Ridge walkthrough",
    body: "Let's meet the Okafors at Ridge Rd Thursday at 2 to walk the framing.",
    date: "2026-10-06T16:40:00-05:00",
  },
  {
    messageId: "m4",
    from: "dana@oakline.co",
    to: "marcus@oakline.co",
    subject: "Pull the permit card",
    body: "Need the permit card photographed at both Alder and Ridge before inspection.",
    date: "2026-10-07T08:15:00-05:00",
  },
  {
    messageId: "m5",
    from: "Tile Depot <orders@tiledepot.example>",
    to: "dana@oakline.co",
    subject: "Your quote for Alder Ave",
    body: "Hi Dana, attached is the quote for the porcelain you asked about. Pricing holds 30 days.",
    date: "2026-10-07T09:30:00-05:00",
  },
  {
    messageId: "m6",
    from: "priya@oakline.co",
    to: "dana@oakline.co",
    subject: "Invitation: Hollis design review @ Fri Oct 9 10am",
    body: "You have been invited to the following event.",
    date: "2026-10-07T10:00:00-05:00",
    attachments: [{ name: "invite.ics", mime: "text/calendar" }],
  },
  // A mail pump retrying the first message.
  {
    messageId: "m1",
    from: "Dana Reyes <dana.reyes@gmail.com>",
    to: "dana@oakline.co",
    subject: "Alder tomorrow",
    body: "(repeat delivery)",
    date: "2026-10-06T22:14:00-05:00",
  },
];
