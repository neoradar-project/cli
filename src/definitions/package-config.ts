export interface PackageConfigFile {
  sectorFileFromGNG: boolean;
  publish?: {
    bucketName: string;
    region: string;
    endpoint: string;
    envVariableAccessKeyId: string;
    envVariableSecretAccessKey: string;
  } | null;
}

export const defaultPackageConfig: PackageConfigFile = {
  sectorFileFromGNG: true,
  publish: null,
};
