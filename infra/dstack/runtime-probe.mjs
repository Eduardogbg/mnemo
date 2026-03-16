/**
 * runtime-probe.mjs
 *
 * Minimal probe that validates connectivity to the dstack simulator.
 * In the real harness this will be replaced by the Mnemo runtime.
 * For now it just confirms the simulator is reachable and the
 * attestation / key-derivation APIs respond.
 */

const ENDPOINT = process.env.DSTACK_SIMULATOR_ENDPOINT || 'http://localhost:8090';

async function probe(path, body = '{}') {
  const url = `${ENDPOINT}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} returned ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`[runtime-probe] Connecting to simulator at ${ENDPOINT}`);

  // 1. Info
  try {
    const info = await probe('/prpc/Tappd.Info');
    console.log('[runtime-probe] Tappd.Info OK:', JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('[runtime-probe] Tappd.Info FAILED:', e.message);
  }

  // 2. Key derivation
  try {
    const key = await probe('/prpc/Tappd.GetKey', JSON.stringify({ path: '/mnemo/test/probe' }));
    console.log('[runtime-probe] Tappd.GetKey OK — key derived for /mnemo/test/probe');
  } catch (e) {
    console.error('[runtime-probe] Tappd.GetKey FAILED:', e.message);
  }

  // 3. Attestation quote (empty report data)
  try {
    const quote = await probe('/prpc/Tappd.GetQuote', JSON.stringify({ report_data: '' }));
    console.log('[runtime-probe] Tappd.GetQuote OK — dummy attestation received');
    if (quote.quote) {
      console.log(`[runtime-probe]   quote length: ${quote.quote.length} chars`);
    }
    if (quote.event_log) {
      console.log(`[runtime-probe]   event_log entries: ${Array.isArray(quote.event_log) ? quote.event_log.length : 'N/A'}`);
    }
  } catch (e) {
    console.error('[runtime-probe] Tappd.GetQuote FAILED:', e.message);
  }

  console.log('[runtime-probe] Probe complete. Container staying alive.');

  // Keep container running so docker compose doesn't restart it
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('[runtime-probe] Fatal:', e);
  process.exit(1);
});
