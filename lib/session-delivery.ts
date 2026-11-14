// lib/session-delivery.ts
//
// In person or online — how a session was coached (migration 036).
//
// Max, 2026-11-14: "some option to say whether it was done online or in
// person … it's another visual cue, I think, is really important." The
// recorder asks with a two-way switch, in person green and online white, and
// the answer is shown wherever the session is.
//
// One parser for everything that receives it from outside (the save route, a
// recording queued offline before the update). Anything else, including an
// absent field, is null: "not recorded", never a guess.

export type Delivery = 'in_person' | 'online'

export const DELIVERY_LABEL: Record<Delivery, string> = {
  in_person: 'In person',
  online: 'Online',
}

export function parseDelivery(v: unknown): Delivery | null {
  return v === 'in_person' || v === 'online' ? v : null
}
