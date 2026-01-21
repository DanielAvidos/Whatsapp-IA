import { FieldValue, Timestamp } from 'firebase/firestore';

export type Tenant = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  plan: 'free' | 'pro' | 'enterprise';
};

export type MemberRole = 'owner' | 'admin' | 'agent' | 'viewer';

export type Member = {
  id: string;
  email: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'disabled';
};

export type ChannelStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'QR';

export type Channel = {
  id: string;
  name: string;
  type: 'whatsapp';
  identifier: string;
  status: ChannelStatus;
};

export type ApiKeyScope = 'messages:send' | 'channels:read';

export type ApiKey = {
  id:string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  createdAt: string;
};

export type WhatsappChannel = {
  id: string;
  displayName: string;
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'QR' | 'ERROR';
  qr: string | null;
  qrDataUrl: string | null;
  phoneE164: string | null;
  lastSeenAt: Timestamp | null;
  updatedAt: FieldValue | Timestamp;
  lastError: any;
};
