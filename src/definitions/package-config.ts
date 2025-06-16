export interface PackageConfigFile {
  sectorFileFromGNG: boolean;
  publish?: {
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
  } | null;
}

export const defaultPackageConfig: PackageConfigFile = {
  sectorFileFromGNG: true,
  publish: null,
};
