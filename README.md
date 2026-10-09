# Platform Event Verification

A Vercel-hosted demo console for authenticating to Salesforce and watching a
Platform Event topic. It decodes event payloads and presents the JSON stored in
`Changes__c` as a compact field-by-field change list.

## Architecture

- Salesforce OAuth Authorization Code flow with PKCE. No client secret is used.
- Access and refresh tokens are encrypted in an HTTP-only cookie with
  `SESSION_SECRET`.
- The server connects to Salesforce Pub/Sub API over gRPC. Because a Vercel
  function is not a permanent process, it opens a 50-second subscription
  window and the browser reconnects using the last replay ID.
- `openapi.yaml` is the contract for the app's HTTP API.

This reconnecting model is suitable for a demonstration, not for the production
Avantos subscriber. Production should run one long-lived gRPC service.

## Salesforce setup

Create an External Client App or Connected App:

1. Enable OAuth.
2. Add scopes `Manage user data via APIs (api)` and
   `Perform requests at any time (refresh_token, offline_access)`.
3. Require PKCE and do not require a client secret for the authorization code
   or refresh-token flow.
4. Add callback URLs:
   - Local: `http://localhost:3000/api/auth/callback`
   - Vercel: `https://YOUR-DOMAIN.vercel.app/api/auth/callback`
5. Give the Salesforce user API access and Read permission on
   `Avantos_Integration__e`.

The app asks for the org's My Domain URL and OAuth consumer key. Do not use
`login.salesforce.com` or `test.salesforce.com` as the My Domain URL.

## Run locally

```bash
cp .env.example .env.local
openssl rand -base64 32
# Put the generated value in SESSION_SECRET in .env.local
npm install
npm run dev
```

Open http://localhost:3000, connect Salesforce, and subscribe to:

```text
/event/Avantos_Integration__e
```

## Deploy to Vercel

1. Import this GitHub repository in Vercel.
2. Set `SESSION_SECRET` to a random value of at least 32 characters.
3. Deploy.
4. Add the final Vercel callback URL to the Salesforce OAuth app.

## Verification

```bash
npm test
npm run lint
npm run build
```

The app keeps up to 100 events in browser memory. It doesn't store event
payloads in a database or logs.
