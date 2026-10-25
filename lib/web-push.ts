// Dependency-free RFC 8291/8292 Web Push sender. Uses built-in Node cryptography.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function webPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export function validatePushSubscription(value: unknown): BrowserPushSubscription {
  if (!value || typeof value !== "object") throw new Error("Invalid push subscription.");
  const raw = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof raw.endpoint !== "string" || raw.endpoint.length > 2000) throw new Error("Invalid push endpoint.");
  const url = new URL(raw.endpoint);
  const host = url.hostname.toLowerCase();
  // Avoid arbitrary server-side HTTP requests to user-supplied hosts (SSRF).
  const permitted = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" || host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com") || host === "wns2-par02p.notify.windows.com" ||
    host === "push.services.mozilla.com";
  if (url.protocol !== "https:" || !permitted || url.username || url.password || url.port) {
    throw new Error("Unsupported push endpoint.");
  }
  if (typeof raw.keys?.p256dh !== "string" || typeof raw.keys?.auth !== "string") {
    throw new Error("Missing subscription keys.");
  }
  const p256dh = Buffer.from(raw.keys.p256dh, "base64url");
  const auth = Buffer.from(raw.keys.auth, "base64url");
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new Error("Invalid subscription key lengths.");
  return { endpoint: url.toString(), keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth } };
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function expand(key: Buffer, info: Buffer, length: number): Buffer {
  return hmac(key, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export function encryptPushPayload(subscription: BrowserPushSubscription, payload: string): Buffer {
  const receiver = Buffer.from(subscription.keys.p256dh, "base64url");
  const auth = Buffer.from(subscription.keys.auth, "base64url");
  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiver);
  const ikm = expand(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), receiver, senderPublic]), 32);
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const plain = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  // Single-record payload. RFC 8291 max body size recommended <=4096 bytes.
  if (plain.length + 16 + 86 > 4096) throw new Error("Push payload exceeds 4096 bytes.");
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(86);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);
  senderPublic.copy(header, 21);
  return Buffer.concat([header, encrypted]);
}

function vapidToken(endpoint: string): string {
  const publicKey = Buffer.from(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, "base64url");
  const privateKey = Buffer.from(process.env.VAPID_PRIVATE_KEY!, "base64url");
  if (publicKey.length !== 65 || privateKey.length !== 32) throw new Error("Invalid VAPID key pair.");
  const ec = createECDH("prime256v1");
  ec.setPrivateKey(privateKey);
  if (!ec.getPublicKey().equals(publicKey)) throw new Error("VAPID public and private keys do not match.");
  const key = createPrivateKey({ key: {
    kty: "EC", crv: "P-256",
    d: privateKey.toString("base64url"),
    x: publicKey.subarray(1, 33).toString("base64url"),
    y: publicKey.subarray(33).toString("base64url")
  }, format: "jwk" });
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    sub: process.env.VAPID_SUBJECT
  })).toString("base64url");
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${input}.${signature}`;
}

export async function sendWebPush(subscription: BrowserPushSubscription, message: { title: string; body: string; url: string; urgent: boolean }): Promise<number> {
  if (!webPushConfigured()) throw new Error("VAPID keys have not been configured.");
  const validated = validatePushSubscription(subscription);
  const payload = encryptPushPayload(validated, JSON.stringify(message));
  const token = vapidToken(validated.endpoint);
  const response = await fetch(validated.endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `vapid t=${token}, k=${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: message.urgent ? "60" : "7200",
      Urgency: message.urgent ? "high" : "normal"
    },
    body: new Uint8Array(payload),
    signal: AbortSignal.timeout(7000)
  });
  return response.status;
}
