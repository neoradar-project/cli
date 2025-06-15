export interface PackageFile {
  path: string;
  size: number;
  checksum: string;
  isRequired?: boolean;
}

export interface PackageChecksums {
  sha256?: string;
  md5?: string;
}

export interface ProviderPackage {
  id: string;
  name: string;
  description?: string;
  version: string;
  namespace?: string;
  createdAt?: string;
  downloadUrl: string;
  fileBaseUrl?: string;
  deltaFilesBaseUrl: string;
  size?: number;
  checksums?: PackageChecksums;
  files?: PackageFile[];
}

export interface ProviderManifest {
  schemaVersion: string;
  updatedAt?: string;
  packageInfo: ProviderPackage;
}

export interface PublishConfig {
  bucketName: string;
  region: string;
  endpoint?: string;
  s3Path?: string;
  makePublic?: boolean;
  envVariableAccessKeyId?: string;
  envVariableSecretAccessKey?: string;
  downloadUrl?: string;
  baseUrl?: string;
  keepDeploy?: boolean;
}
