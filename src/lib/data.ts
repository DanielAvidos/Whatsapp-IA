"use client"
import type { Tenant, Member, Channel, ApiKey, MemberRole, ChannelStatus, ApiKeyScope } from './types';
import { useState, useEffect } from 'react';

// --- Data Stores ---
let tenantsStore: Tenant[] = [
  { id: 't1', name: 'Innovate Corp', status: 'active', plan: 'pro' },
  { id: 't2', name: 'Solutions Inc', status: 'suspended', plan: 'free' },
  { id: 't3', name: 'QuantumLeap', status: 'active', plan: 'enterprise' },
];

let membersStore: Member[] = [
  { id: 'm1', email: 'owner@innovate.com', role: 'owner', status: 'active' },
  { id: 'm2', email: 'admin@innovate.com', role: 'admin', status: 'invited' },
  { id: 'm3', email: 'agent@innovate.com', role: 'agent', status: 'active' },
  { id: 'm4', email: 'viewer@innovate.com', role: 'viewer', status: 'disabled' },
];

let channelsStore: Channel[] = [
  { id: 'c1', name: 'Main Support', type: 'whatsapp', identifier: '+15551234567', status: 'CONNECTED' },
  { id: 'c2', name: 'Sales Team', type: 'whatsapp', identifier: '+15557654321', status: 'DISCONNECTED' },
  { id: 'c3', name: 'Dev Alerts', type: 'whatsapp', identifier: '+15550009999', status: 'CONNECTING' },
];

let apiKeysStore: ApiKey[] = [
  { id: 'k1', name: 'Primary Integration', prefix: 'ia_pk_a1b2', keyHash: 'dummy_hash_1', scopes: ['messages:send', 'channels:read'], createdAt: new Date('2023-01-15T10:00:00Z').toISOString() },
  { id: 'k2', name: 'Reporting System', prefix: 'ia_pk_c3d4', keyHash: 'dummy_hash_2', scopes: ['channels:read'], createdAt: new Date('2023-03-20T14:30:00Z').toISOString() },
];

export const availableRoles: MemberRole[] = ['owner', 'admin', 'agent', 'viewer'];
export const availablePlans: Tenant['plan'][] = ['free', 'pro', 'enterprise'];
export const availableTenantStatus: Tenant['status'][] = ['active', 'suspended'];
export const availableChannelStatus: ChannelStatus[] = ['CONNECTED', 'DISCONNECTED', 'CONNECTING'];
export const availableMemberStatus: Member['status'][] = ['active', 'invited', 'disabled'];
export const availableApiKeyScopes: ApiKeyScope[] = ['messages:send', 'channels:read'];

// --- Reactivity System ---
const listeners = {
  tenants: new Set<() => void>(),
  members: new Set<() => void>(),
  channels: new Set<() => void>(),
  apiKeys: new Set<() => void>(),
};
type StoreName = keyof typeof listeners;

const notify = (store: StoreName) => listeners[store].forEach(l => l());

function useStore<T>(storeName: StoreName, store: T[]): T[] {
  const [data, setData] = useState(store);
  useEffect(() => {
    const listener = () => setData([...store]);
    listeners[storeName].add(listener);
    return () => void listeners[storeName].delete(listener);
  }, [storeName, store]);
  return data;
}

export const useTenants = () => useStore('tenants', tenantsStore);
export const useMembers = () => useStore('members', membersStore);
export const useChannels = () => useStore('channels', channelsStore);
export const useApiKeys = () => useStore('apiKeys', apiKeysStore);

// --- Mutations ---
const createId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

export const addTenant = (data: Omit<Tenant, 'id'>) => {
  tenantsStore.unshift({ ...data, id: createId() });
  notify('tenants');
};

export const updateTenant = (updated: Tenant) => {
  tenantsStore = tenantsStore.map(t => t.id === updated.id ? updated : t);
  notify('tenants');
};

export const addMember = (data: Omit<Member, 'id' | 'status'>) => {
  membersStore.unshift({ ...data, id: createId(), status: 'invited' });
  notify('members');
};

export const updateMember = (updated: Member) => {
  membersStore = membersStore.map(m => m.id === updated.id ? updated : m);
  notify('members');
};

export const addChannel = (data: Omit<Channel, 'id' | 'status'>) => {
  channelsStore.unshift({ ...data, id: createId(), status: 'CONNECTING' });
  notify('channels');
};

export const updateChannel = (updated: Channel) => {
  channelsStore = channelsStore.map(c => c.id === updated.id ? updated : c);
  notify('channels');
};

export const addApiKey = (data: Pick<ApiKey, 'name' | 'scopes'>) => {
  const key = createId();
  apiKeysStore.unshift({
    ...data,
    id: key,
    prefix: `ia_pk_${key.slice(0, 4)}`,
    keyHash: `wha_****************_${key.slice(-4)}`,
    createdAt: new Date().toISOString(),
  });
  notify('apiKeys');
};

export const deleteApiKey = (id: string) => {
  apiKeysStore = apiKeysStore.filter(k => k.id !== id);
  notify('apiKeys');
};

export const generateDemoData = () => {
  const demoTenants = [
    { id: 't-demo-1', name: 'Demo Retail', status: 'active', plan: 'pro' },
    { id: 't-demo-2', name: 'Demo Healthcare', status: 'active', plan: 'enterprise' },
  ];
  const demoMembers = [
    { id: 'm-demo-1', email: 'demo-admin@example.com', role: 'admin', status: 'invited' },
    { id: 'm-demo-2', email: 'demo-agent@example.com', role: 'agent', status: 'invited' },
  ];
  const demoChannels = [
    { id: 'c-demo-1', name: 'Demo Sales Line', type: 'whatsapp', identifier: '+15554443333', status: 'CONNECTED' },
  ];
  const demoApiKeys = [
    { id: 'k-demo-1', name: 'Demo Bot API', prefix: 'ia_pk_dem0', keyHash: 'wha_****************_d3m0', scopes: ['messages:send'], createdAt: new Date().toISOString() },
  ];
  
  tenantsStore = [...demoTenants, ...tenantsStore];
  membersStore = [...demoMembers, ...membersStore];
  channelsStore = [...demoChannels, ...channelsStore];
  apiKeysStore = [...demoApiKeys, ...apiKeysStore];
  
  notify('tenants');
  notify('members');
  notify('channels');
  notify('apiKeys');
};
