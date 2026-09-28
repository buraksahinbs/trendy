import dns from "node:dns";
import net from "node:net";

/**
 * SSRF koruması: tedarikçi URL'si iç ağa, loopback'e, link-local'e (bulut metadata servisleri dahil)
 * veya ayrılmış aralıklara çözülüyorsa bağlantı kurulmaz.
 *
 * Kontrol DNS çözümlemesi sırasında (`lookup`) yapılır; böylece DNS rebinding ile kontrol ve
 * bağlantı arasında adres değiştirilemez.
 */
const blockList = new net.BlockList();

for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockList.addSubnet(net4, prefix, "ipv4");
}

for (const [net6, prefix] of [
  ["::", 128],
  ["::1", 128],
  // IPv4-mapped (::ffff:a.b.c.d) adresleri BlockList IPv4 kurallarıyla zaten kontrol eder.
  // ::ffff:0:0/96 eklenirse tüm IPv4 adresleri engellenir.
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockList.addSubnet(net6, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class BlockedAddressError extends Error {
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`İzin verilmeyen adres: ${host} -> ${address}`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** `http.request({ lookup })` için; çözülen adreslerden biri bile yasaklıysa hata verir. */
export function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked) return callback(new BlockedAddressError(hostname, blocked.address), "");
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error(`Adres çözülemedi: ${hostname}`), "");
    callback(null, first.address, first.family);
  });
}
