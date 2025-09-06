interface PluginBinary {
  filename: string;
  platform: string;
  architecture: string;
  data: Buffer;
  originalSize: number;
  compressedSize: number;
}

interface PluginMetadata {
  name: string;
  created: string;
}

interface PluginArchiveData {
  metadata: PluginMetadata;
  binaries: Record<
    string,
    {
      originalSize: number;
      compressedSize: number;
      data: string;
      compressed: boolean;
    }
  >;
}
