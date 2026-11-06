import dns from 'dns/promises';
import net from 'net';
import { AppError } from '../middleware/error.middleware';

const blocked = new net.BlockList();
for (const [range, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
] as const) blocked.addSubnet(range, bits, 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addAddress('::', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

/**
 * Backup targets are typed in by each organization's admin. Without this check they could
 * point the server at its own database, Redis or a cloud metadata service. Returns the
 * address to connect to, so the name can't resolve differently a moment later.
 */
export async function resolvePublicHost(host: string): Promise<string> {
  if (process.env.ALLOW_PRIVATE_BACKUP_TARGETS === 'true') return host;

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new AppError('Could not resolve the backup server address', 400);
  }
  for (const { address, family } of addresses) {
    const ip = address.replace(/^::ffff:/i, '');
    if (blocked.check(ip, family === 6 && !net.isIPv4(ip) ? 'ipv6' : 'ipv4')) {
      throw new AppError('Backup targets must be public servers', 400);
    }
  }
  return addresses[0].address;
}
