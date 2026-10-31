import { createHmac, timingSafeEqual } from "crypto";

const PHONE_CHANGE_TICKET_TTL_MS = 15 * 60 * 1000;

type CurrentPhoneTicketPayload = {
  version: 1;
  stage: "current-verified";
  userId: number;
  currentPhone: string;
  expiresAt: number;
};

type TargetPhoneTicketPayload = {
  version: 1;
  stage: "target-code-sent";
  userId: number;
  currentPhone: string;
  newPhone: string;
  expiresAt: number;
};

export type PhoneChangeTicketPayload =
  | CurrentPhoneTicketPayload
  | TargetPhoneTicketPayload;

function ticketSecret(): string {
  return process.env.JWT_SECRET || "phone-change-ticket-dev-secret";
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", ticketSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createPhoneChangeTicket(
  payload:
    | Omit<CurrentPhoneTicketPayload, "version" | "expiresAt">
    | Omit<TargetPhoneTicketPayload, "version" | "expiresAt">,
): string {
  const complete: PhoneChangeTicketPayload = {
    ...payload,
    version: 1,
    expiresAt: Date.now() + PHONE_CHANGE_TICKET_TTL_MS,
  } as PhoneChangeTicketPayload;
  const encodedPayload = Buffer.from(JSON.stringify(complete), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyPhoneChangeTicket(
  ticket: string,
  expectedStage: PhoneChangeTicketPayload["stage"],
): PhoneChangeTicketPayload {
  const [encodedPayload, suppliedSignature, extra] = ticket.split(".");
  if (!encodedPayload || !suppliedSignature || extra) {
    throw new Error("换号验证已失效，请重新开始");
  }

  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("换号验证已失效，请重新开始");
  }

  let payload: PhoneChangeTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("换号验证已失效，请重新开始");
  }

  if (
    payload.version !== 1 ||
    payload.stage !== expectedStage ||
    !Number.isInteger(payload.userId) ||
    payload.userId <= 0 ||
    !/^1[3-9]\d{9}$/.test(payload.currentPhone) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt <= Date.now()
  ) {
    throw new Error("换号验证已失效，请重新开始");
  }
  if (
    payload.stage === "target-code-sent" &&
    !/^1[3-9]\d{9}$/.test(payload.newPhone)
  ) {
    throw new Error("换号验证已失效，请重新开始");
  }
  return payload;
}

export const PHONE_CHANGE_TICKET_TTL_SECONDS =
  PHONE_CHANGE_TICKET_TTL_MS / 1000;
