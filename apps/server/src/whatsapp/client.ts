import makeWASocket, { DisconnectReason, extractMessageContent, type WASocket } from "@whiskeysockets/baileys";
import { FieldValue } from "firebase-admin/firestore";
import qrcode from "qrcode-terminal";
import { env } from "../core/env.js";
import { db } from "../core/firebase.js";
import { handleCommand } from "./commands.js";
import { useFirestoreAuthState } from "./authState.js";

export interface WhatsAppTransport { sendText(phone: string, text: string): Promise<void>; connected(): boolean; stop(): Promise<void>; }
const status = db.collection("waStatus").doc("current");
export const reconnectDelay = (attempt: number) => Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));

export async function startWhatsApp(): Promise<WhatsAppTransport> {
  const auth = await useFirestoreAuthState();
  let socket: WASocket | undefined;
  let online = false; let stopped = false; let attempt = 0; let reconnectTimer: NodeJS.Timeout | undefined;
  const connect = () => {
    if (stopped) return;
    socket = makeWASocket({ auth: auth.state, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: true });
    socket.ev.on("creds.update", auth.saveCreds);
    socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr && env.waPrintQr) { console.log("[whatsapp] Scan this QR with the spare WhatsApp SIM:"); qrcode.generate(qr, { small: true }); }
      // The admin WhatsApp page shows this QR so it can be scanned from a screen (organizers only).
      if (qr) void status.set({ state: "qr", qr, qrAt: FieldValue.serverTimestamp() }, { merge: true });
      if (connection === "open") { online = true; attempt = 0; void status.set({ state: "connected", qr: FieldValue.delete(), lastConnectedAt: FieldValue.serverTimestamp() }, { merge: true }); }
      if (connection === "connecting") void status.set({ state: qr ? "qr" : "connecting" }, { merge: true });
      if (connection === "close") {
        online = false;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        void status.set({ state: loggedOut ? "logged_out" : "disconnected", qr: FieldValue.delete(), lastError: String(lastDisconnect?.error ?? "closed") }, { merge: true });
        if (!loggedOut && !stopped) reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
      }
    });
    socket.ev.on("messages.upsert", ({ messages }) => { for (const m of messages) { if (!m.key.fromMe && m.key.remoteJid && m.key.id) { const c = extractMessageContent(m.message); const text = c?.conversation ?? c?.extendedTextMessage?.text; if (text) void handleCommand(m.key.remoteJid, text, m.key.id).catch(console.error); } } });
  };
  connect();
  return {
    connected: () => online,
    sendText: async (phone, text) => { if (!socket || !online) throw new Error("WhatsApp is disconnected"); await socket.sendMessage(`${phone.replace(/\D/g, "")}@s.whatsapp.net`, { text }); },
    stop: async () => { stopped = true; online = false; if (reconnectTimer) clearTimeout(reconnectTimer); await auth.flush(); socket?.end(undefined); },
  };
}
