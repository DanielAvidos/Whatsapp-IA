# **App Name**: Whatsapp IA

## Core Features:

- Multi-tenant Dashboard: Dashboard to manage multiple tenants (companies/teams) with secure data isolation.
- Tenant Management: Ability to create, update, and suspend tenants through a user-friendly interface. Includes the ability to define tenant name, status, and plan.
- Member Management: Invite, manage, and assign roles (owner, admin, agent, viewer) to members within a tenant. Tracks status (active, invited, disabled).
- Channel Management: Create and manage communication channels (e.g., WhatsApp numbers) within each tenant. Supports tracking channel status (CONNECTED, DISCONNECTED, CONNECTING).
- API Key Generation (Dummy): Generate placeholder API keys for each tenant with specified scopes (e.g., messages:send, channels:read). Keys are dummy in this phase, with a key prefix shown and the full key as a hash placeholder.
- Role-Based Access Control: Implement strict Firestore rules to enforce role-based access control, ensuring that users can only access and modify data according to their assigned roles (owner, admin, agent, viewer) within their tenant.
- Demo Data Generation: Admin function to populate the active tenant with pre-defined channels, API keys, and invited members to quickly showcase the application's capabilities.

## Style Guidelines:

- Primary color: Light desaturated blue (#A7C4E0), reflecting communication and connectivity, fitting with a light color scheme.
- Background color: Very light desaturated blue (#F0F4F7) for a clean, calming backdrop.
- Accent color: Muted violet (#B1AEE3), adding a touch of sophistication and contrast to highlight interactive elements.
- Body and headline font: 'Inter' sans-serif, for a modern, neutral, and readable interface.
- Sidebar navigation for easy access to Tenant, Channels, API Keys, and Members sections.
- Simple, professional icons for key features (Tenants, Channels, API Keys, Members).
- Subtle transitions for page loads and data updates to enhance user experience.