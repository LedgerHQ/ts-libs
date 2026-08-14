# @ledgerhq/auth

> [!CAUTION]
> **Status: UNSTABLE**
> API may change without notice. Not recommended for production use.

Authentication helpers for Ledger applications using Keycloak-based OAuth2/OIDC services.

## Features

- Retrieves identity-provider challenges from Keycloak
- Supports the OAuth2 authorization code flow
- Caches access tokens in memory and re-authenticates when they expire
- Retries an authenticated operation with a fresh token when requested by the caller
- Resolves a static or lazily provided Keycloak base URL

## Usage

```typescript
import { AuthSDK, type IdentityProvider } from "@ledgerhq/auth";

async function fetchProfile(provider: IdentityProvider): Promise<Response> {
  const auth = new AuthSDK(
    {
     clientId: "ledger-keycloak", 
      keycloakBaseUrl: "https://keycloak.example.com",
      keycloakRealm: "ledger",
    },
    { provider },
  );

  return auth.withToken({
    queryFn: token =>
      fetch("https://api.example.com/profile", {
        headers: { Authorization: `${token.tokenType} ${token.accessToken}` },
      }),
    refreshAndRetryWhen: response => response.status === 401,
  });
}
```

## Public API

- `AuthSDK` — runs authenticated operations through `withToken`
- Authentication configuration and provider types
- Authentication error classes
