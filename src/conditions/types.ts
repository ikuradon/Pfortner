// src/conditions/types.ts

export type SimpleCondition = {
  authenticated?: boolean;
  pubkey?: string;
  client_ip?: string;
  message_type?: 'EVENT' | 'REQ' | 'CLOSE';
  event_kind?: number;
  event_pubkey?: string;
  has_search?: boolean;
};

export type Condition =
  | SimpleCondition
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

export interface EvalContext {
  authenticated: boolean;
  pubkey: string;
  clientIp: string;
  messageType: string;
  eventKind: number | null;
  eventPubkey: string | null;
  hasSearch: boolean;
}
