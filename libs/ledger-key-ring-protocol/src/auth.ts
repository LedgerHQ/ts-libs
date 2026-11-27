import { log } from "@ledgerhq/logs";
import { AuthCachePolicy, JWT } from "./types";
import { TrustchainNotAllowed, TrustchainOutdated } from "./errors";

class JwtRefused extends TrustchainNotAllowed {}

export async function genericWithJWT<T>(
  job: (jwt: JWT) => Promise<T>,
  initialJWT: JWT | undefined,
  auth: () => Promise<JWT>,
  refreshAuth: (jw: JWT) => Promise<JWT>,
  policy: AuthCachePolicy = "cache",
): Promise<T> {
  function refresh(jwt: JWT) {
    return refreshAuth(jwt).catch(e => {
      log("trustchain", "JWT refresh failed, reauthenticating", e);
      const { hasExpired } = throwIfJwtRejected(e);
      if (hasExpired) {
        return auth();
      }
      throw e;
    });
  }

  // the recovered jwt is not recovered again, but its errors map as on the first attempt
  function retry(recovered: JWT) {
    return job(recovered).catch(e => {
      throwIfJwtRejected(e);
      throw e;
    });
  }

  // initial jwt depending on the policy
  let jwt =
    policy === "no-cache" || !initialJWT
      ? await auth()
      : policy === "refresh"
        ? await refresh(initialJWT)
        : initialJWT;

  return job(jwt).catch(async e => {
    // JWT expiration handling: if the function fails, we will recover a valid jwt accordingly to spec. https://ledgerhq.atlassian.net/wiki/spaces/BE/pages/4207083687/TCH+Usage+documentation#JWT-expiration-handling
    const { hasExpired, canBeRefreshed, isUncaughtClientError } = throwIfJwtRejected(e);
    if (hasExpired) {
      log("trustchain", "JWT expired -> " + (canBeRefreshed ? "refreshing" : "reauthenticating"));
      jwt = await (jwt && canBeRefreshed ? refresh(jwt) : auth());
      return retry(jwt);
    }
    if (isUncaughtClientError) {
      log("trustchain", "Uncaught client error -> reauthenticating");
      jwt = await auth();
      return retry(jwt);
    }

    throw e;
  });
}

/**
 * True when the backend refused the JWT itself ("JWT contains no permission"), as opposed to a
 * TrustchainNotAllowed raised by the device.
 */
export function isJwtRefusal(error: unknown): boolean {
  return error instanceof JwtRefused;
}

type JwtExpirationCheck = {
  hasExpired: boolean;
  canBeRefreshed: boolean;
  isNotPermitted: boolean;
  isTrustchainOutdated: boolean;
  isUncaughtClientError: boolean;
};

// every attempt maps the backend's refusals the same way, so none of them leaks a raw error
function throwIfJwtRejected(error: unknown): JwtExpirationCheck {
  const check = networkCheckJwtExpiration(error);
  if (check.isNotPermitted) throw new JwtRefused();
  if (check.isTrustchainOutdated) throw new TrustchainOutdated();
  return check;
}

/**
 * Contract for HTTP errors reaching this layer, which any transport used to call the trustchain
 * or cloud-sync backends must satisfy — see `CloudSyncHttpError` in @shared/cloud-sync and
 * `LedgerAPI4xx` in @ledgerhq/live-network:
 *
 *  - `status`: the numeric HTTP status. JWT recovery only engages on a 4xx.
 *  - `message`: the backend's message, verbatim. The backend discriminates JWT failures through
 *    it ("JWT is expired", "JWT contains no permission", "path does not match"), so a transport
 *    that drops the response body silently downgrades every 4xx to a full re-authentication and
 *    stops producing TrustchainNotAllowed / TrustchainOutdated.
 *
 * A transport whose errors are not Error-shaped (RTK Query's FetchBaseQueryError carries the body
 * on `data` and has no `message`) must remap to this shape at its boundary.
 */
function isClientError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

function networkCheckJwtExpiration(error: unknown): JwtExpirationCheck {
  let hasExpired = false;
  let canBeRefreshed = false;
  let isNotPermitted = false;
  let isTrustchainOutdated = false;
  let isUncaughtClientError = false;
  if (isClientError(error)) {
    const message = (error as Error)?.message ?? "";
    if (message.includes("JWT is expired")) {
      hasExpired = true;
      canBeRefreshed = message.includes("/refresh");
    } else if (message.includes("JWT contains no permission")) {
      isNotPermitted = true;
    } else if (message.includes("path does not match")) {
      isTrustchainOutdated = true;
    } else {
      isUncaughtClientError = true;
    }
  }
  return {
    hasExpired,
    canBeRefreshed,
    isNotPermitted,
    isTrustchainOutdated,
    isUncaughtClientError,
  };
}
