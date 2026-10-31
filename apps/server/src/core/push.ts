import { getMessaging } from "firebase-admin/messaging";
import { env } from "./env.js";
import { app } from "./firebase.js";

// FCM web push to topics (plan D18). There is no FCM emulator, so in dev and
// tests the pushes are recorded instead of sent.

export const sentPushes: { topic: string; title: string; body: string }[] = [];

export async function pushToTopics(topics: string[], msg: { title: string; body: string; emergency?: boolean }) {
  if (env.usingEmulators) {
    for (const topic of topics) sentPushes.push({ topic, title: msg.title, body: msg.body });
    return topics.length;
  }
  const messaging = getMessaging(app);
  let sent = 0;
  for (const topic of topics) {
    try {
      await messaging.send({
        topic,
        notification: { title: msg.title, body: msg.body },
        webpush: { headers: { Urgency: msg.emergency ? "high" : "normal" } },
      });
      sent++;
    } catch (err) {
      console.error(`[push] topic ${topic} failed`, err);
    }
  }
  return sent;
}
