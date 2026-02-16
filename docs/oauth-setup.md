# OAuth Provider Setup Guide

CreditCardTracker supports OAuth/SSO login with several providers. This guide walks through setting up each one.

## General Information

**Redirect URI format:**
```
https://<your-domain>/auth/callback?provider=<provider-name>
```

For example, if your instance is at `https://cct.example.com` and you're setting up Google:
```
https://cct.example.com/auth/callback?provider=google
```

For local development:
```
http://localhost:3000/auth/callback?provider=google
```

After creating the OAuth app with your provider, you'll need:
- **Client ID** — public identifier for your app
- **Client Secret** — private key (never share this)

Enter both in the CCT Admin Panel under the OAuth tab.

---

## Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. If prompted, configure the **OAuth consent screen** first:
   - User type: External (or Internal for Google Workspace orgs)
   - App name: CreditCardTracker (or your preference)
   - Scopes: `openid`, `email`, `profile`
6. Back in Credentials, create an OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://<your-domain>/auth/callback?provider=google`
7. Copy the **Client ID** and **Client Secret**

**Notes:**
- Google OAuth works immediately in "testing" mode for up to 100 users
- For unlimited users, submit the consent screen for verification

---

## GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App** (under OAuth Apps)
3. Fill in the form:
   - Application name: CreditCardTracker
   - Homepage URL: `https://<your-domain>`
   - Authorization callback URL: `https://<your-domain>/auth/callback?provider=github`
4. Click **Register application**
5. Copy the **Client ID**
6. Click **Generate a new client secret** and copy the **Client Secret**

**Notes:**
- GitHub OAuth apps have no usage limits
- The user's primary email must be verified for CCT to receive it

---

## Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it CreditCardTracker and create
4. Go to **OAuth2** in the left sidebar
5. Under **Redirects**, add: `https://<your-domain>/auth/callback?provider=discord`
6. Copy the **Client ID** from the OAuth2 page
7. Click **Reset Secret** and copy the **Client Secret**

**Notes:**
- Scopes used: `identify` and `email`
- The user must have a verified email on Discord

---

## Facebook

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **Create App** and select **Consumer** (or **None**)
3. Name it CreditCardTracker
4. In the app dashboard, add **Facebook Login** product
5. Go to **Facebook Login > Settings**
6. Add to **Valid OAuth Redirect URIs**: `https://<your-domain>/auth/callback?provider=facebook`
7. Go to **App Settings > Basic** for the **App ID** (Client ID) and **App Secret** (Client Secret)

**Notes:**
- App must be in "Live" mode for non-developers to use it
- Scopes used: `email` and `public_profile`

