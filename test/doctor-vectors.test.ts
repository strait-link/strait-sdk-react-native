import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { doctorFindings } from '../src/index.js';

// doctor-vectors.json (contract B23, ADR 0002) is generated from this SDK's doctorFindings
// (scripts/doctor-vectors.mjs) and carried byte for byte by the Android, Flutter, Swift and Unity
// SDKs. A wording change here means: regenerate it and copy it to each of them.
const { vectors } = JSON.parse(readFileSync(new URL('./doctor-vectors.json', import.meta.url), 'utf8'));

describe('doctor-vectors.json', () => {
  it('has a vector for every ADR row', () => expect(vectors.length).toBeGreaterThanOrEqual(40));
  it.each(vectors.map((v: any) => [v.name, v]))('%s', (_name, v: any) => {
    const { file, appId, ...rest } = v.input;
    const report = doctorFindings({
      ...rest,
      appId: appId ?? undefined,
      file: file === null ? undefined : { status: file.status ?? undefined, body: file.body ?? undefined },
    });
    expect(report).toEqual({ ok: v.ok, findings: v.findings });
  });
});
