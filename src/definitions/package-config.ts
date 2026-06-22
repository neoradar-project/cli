export interface PackageConfigFile {
  sectorFileFromGNG: boolean;
  publish?: {
    // "s3" (default) targets AWS S3; "r2" targets Cloudflare R2 (S3-compatible).
    provider?: "s3" | "r2";
    bucketName: string;
    // Required for S3. Ignored for R2 (the client uses region "auto").
    region?: string;
    // Required for R2: https://<account-id>.r2.cloudflarestorage.com
    endpoint?: string;
    s3Path?: string;
    makePublic?: boolean;
    // Optional Cache-Control applied to every uploaded file EXCEPT manifest.json
    // (which is always sent no-cache so update checks see fresh data). Leave unset
    // to keep the safe no-cache default; set e.g. "public, max-age=31536000, immutable"
    // only when your file paths are versioned/immutable.
    cacheControl?: string;
    envVariableAccessKeyId?: string;
    envVariableSecretAccessKey?: string;
    downloadUrl?: string;
    baseUrl?: string;
    keepDeploy?: boolean;
    // When set, the manifest (and downloadUrl) are purged from Cloudflare's cache
    // after a successful publish so clients see the update immediately.
    cloudflare?: {
      zoneId: string;
      // Env var holding a Cloudflare API token with Zone > Cache Purge. Default: CF_API_TOKEN
      envVariableApiToken?: string;
    };
    // Extra absolute URLs to purge alongside the manifest (e.g. a top-level providers.json).
    purgeUrls?: string[];
  } | null;
}

export const defaultPackageConfig: PackageConfigFile = {
  sectorFileFromGNG: true,
  publish: null,
};
