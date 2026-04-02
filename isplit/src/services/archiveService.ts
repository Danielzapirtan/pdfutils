import { gzipSync } from 'fflate';

/**
 * A minimal TAR file creator for the browser.
 * Generates a USTAR compatible TAR archive.
 */
export function createTarGz(files: { name: string; data: Uint8Array }[]): Blob {
  const chunks: Uint8Array[] = [];

  for (const file of files) {
    const header = new Uint8Array(512);
    const name = file.name.slice(0, 100);
    const size = file.data.length.toString(8).padStart(11, '0');
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0');

    // Name
    for (let i = 0; i < name.length; i++) header[i] = name.charCodeAt(i);
    // Mode
    header.set(new TextEncoder().encode('0000644\0'), 100);
    // UID
    header.set(new TextEncoder().encode('0000000\0'), 108);
    // GID
    header.set(new TextEncoder().encode('0000000\0'), 116);
    // Size
    header.set(new TextEncoder().encode(size + '\0'), 124);
    // Mtime
    header.set(new TextEncoder().encode(mtime + '\0'), 136);
    // Typeflag (0 = normal file)
    header[156] = '0'.charCodeAt(0);
    // Magic
    header.set(new TextEncoder().encode('ustar\0'), 257);
    // Version
    header.set(new TextEncoder().encode('00'), 263);

    // Checksum
    header.set(new TextEncoder().encode('        '), 148);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(new TextEncoder().encode(checksumStr), 148);

    chunks.push(header);
    chunks.push(file.data);
    
    // Padding to 512 bytes
    const paddingSize = (512 - (file.data.length % 512)) % 512;
    if (paddingSize > 0) {
      chunks.push(new Uint8Array(paddingSize));
    }
  }

  // End of archive (two 512-byte zero blocks)
  chunks.push(new Uint8Array(1024));

  // Combine all chunks into one Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const tarBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    tarBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  // GZIP the TAR buffer
  const gzipped = gzipSync(tarBuffer);
  
  return new Blob([gzipped], { type: 'application/gzip' });
}
