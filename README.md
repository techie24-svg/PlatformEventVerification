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
  window and the browser reconnects.
- Salesforce keeps track of what the app consumed. If the org has a managed
  event subscription named `PEV_<event name>`, for example
  `PEV_Avantos_Integration` for `/event/Avantos_Integration__e`, the app
  subscribes through it and commits the replay ID of each event it streamed to
  the browser. After the app was offline, Salesforce sends every event
  published since the last commit, for up to 72 hours.
- Without a managed subscription, the app starts from the latest event and
  only replays between windows of one listening session.
- If the page reloads while listening, or the network drops and returns, the
  app reconnects on its own.
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
6. To keep events published while the app is offline, deploy a managed event
   subscription for each topic. The signed-in user needs View Setup and
   Configuration to look it up, and one managed subscription serves one client
   at a time. Managed event subscriptions are a Salesforce beta feature.

```xml
<!-- managedEventSubscriptions/PEV_Avantos_Integration.managedEventSubscription-meta.xml -->
<ManagedEventSubscription xmlns="http://soap.sforce.com/2006/04/metadata">
    <defaultReplay>LATEST</defaultReplay>
    <errorRecoveryReplay>EARLIEST</errorRecoveryReplay>
    <label>Platform Event Verification - Avantos Integration</label>
    <state>RUN</state>
    <topicName>/event/Avantos_Integration__e</topicName>
</ManagedEventSubscription>
```

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
