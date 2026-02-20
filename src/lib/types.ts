
import { FieldValue, Timestamp } from 'firebase/firestore';

export type CompanyPlan = 'Free' | 'Pro' | 'Enterprise';
export type CompanyStatus = 'Active' | 'Suspended';

export type Company = {
  id: string;
  name: string;
  status: CompanyStatus;
  plan: CompanyPlan;
  adminEmail: string;
  adminUid: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};

export type MemberRole = 'owner' | 'admin' | 'agent' | 'viewer';

export type Member = {
  id: string;
  email: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'disabled';
};

export type ChannelStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'QR' | 'ERROR';

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
  status: ChannelStatus;
  qr: { raw: string | null; public: string | null } | null;
  qrDataUrl: string | null;
  phoneE164: string | null;
  lastSeenAt: Timestamp | null;
  updatedAt: FieldValue | Timestamp;
  lastError: any;
  linked: boolean;
  companyId?: string | null;
  companyName?: string | null;
  lastBotError?: {
    message: string;
    at: Timestamp;
  } | null;
};

export type FollowupConfig = {
  enabled: boolean;
  businessHours: {
    startHour: number;
    endHour: number;
    timezone: string;
  };
  maxTouches: number;
  cadenceHours: number[];
  stopKeywords: string[];
  resumeKeywords: string[];
  toneProfile: string;
  goal: string;
  updatedAt: Timestamp | FieldValue;
  updatedByUid: string;
  updatedByEmail: string;
};

export type CustomerProfile = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  updatedAt: Timestamp | FieldValue;
  source: "auto-extract" | "manual";
  confidence?: {
    nameConfidence?: "low" | "med" | "high";
    emailConfidence?: "low" | "high";
    phoneConfidence?: "low" | "high";
  };
};

export type Conversation = {
  id: string;
  jid: string;
  type: 'user' | 'group';
  name: string | null;
  lastMessageText: string | null;
  lastMessageAt: Timestamp | FieldValue | null;
  unreadCount: number;
  updatedAt: Timestamp | FieldValue;
  displayName?: string;
  customer?: CustomerProfile;
  // Follow-up fields
  followupEnabled?: boolean;
  followupStage?: number;
  followupNextAt?: Timestamp | null;
  followupLastSentAt?: Timestamp | null;
  followupLastCustomerAt?: Timestamp | null;
  followupStopped?: boolean;
  followupStopReason?: string | null;
  followupStopAt?: Timestamp | null;
};

export type Message = {
  id: string;
  jid: string;
  fromMe: boolean;
  direction: 'IN' | 'OUT';
  text: string | null;
  status: 'received' | 'sent' | 'delivered' | 'read' | null;
  timestamp: number;
  createdAt: Timestamp | FieldValue;
  isBot?: boolean;
};

export type BotConfig = {
  id: string;
  enabled: boolean;
  productDetails: string;
  salesStrategy: string;
  model: string;
  updatedAt: Timestamp | FieldValue;
  updatedByUid: string;
  updatedByEmail: string;
  lastAutoReplyAt?: Timestamp | FieldValue | null;
  lastError?: string | null;
  lastErrorAt?: Timestamp | FieldValue | null;
};
