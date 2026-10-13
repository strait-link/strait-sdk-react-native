/**
 * `fromPlayInstallReferrer(PlayInstallReferrer)` must typecheck against the
 * library's own declarations, as the quick start shows it. 2.0.1 types
 * `installReferrer: string | null`; the SDK's adapter type once said
 * `installReferrer?: string`, so every TS app showed a red error (13 Oct).
 */
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { fromPlayInstallReferrer } from '../src/index.js';

const SRC = fileURLToPath(new URL('../src/index.js', import.meta.url));

// The library's index.d.ts shapes, verbatim (2.0.1, and 1.1.9 for older apps).
const FIXTURE = `
import { fromPlayInstallReferrer } from ${JSON.stringify(SRC)};

type V2Info = {
  installReferrer: string | null; installVersion: string | null; googlePlayInstant: boolean;
  installBeginTimestampSeconds: number; installBeginTimestampServerSeconds: number;
  referrerClickTimestampSeconds: number; referrerClickTimestampServerSeconds: number;
};
type V2Error = { message: string; responseCode?: number };
declare const v2: { getInstallReferrerInfo: (callback: (info: V2Info | null, error: V2Error | null) => void) => void };

type V1Info = {
  googlePlayInstant: boolean; installBeginTimestampSeconds: string; installBeginTimestampServerSeconds: string;
  installReferrer: string; installVersion: string; referrerClickTimestampSeconds: string; referrerClickTimestampServerSeconds: string;
};
declare class V1Error extends Error { responseCode: string }
declare const v1: { getInstallReferrerInfo: (callback: (info: V1Info | null, error: V1Error | null) => void) => void };

export const a: () => Promise<string | null> = fromPlayInstallReferrer(v2);
export const b: () => Promise<string | null> = fromPlayInstallReferrer(v1);
`;

describe('fromPlayInstallReferrer', () => {
  it('typechecks against react-native-play-install-referrer 2.0.1 and 1.1.9 (strict)', () => {
    const file = fileURLToPath(new URL('./__referrer-fixture.ts', import.meta.url));
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const getSource = host.getSourceFile.bind(host);
    host.fileExists = ((exists) => (f: string) => f === file || exists(f))(host.fileExists.bind(host));
    host.readFile = (f) => (f === file ? FIXTURE : read(f));
    host.getSourceFile = (f, lang, ...rest) =>
      f === file ? ts.createSourceFile(f, FIXTURE, lang) : getSource(f, lang, ...rest);
    const program = ts.createProgram([file], options, host);
    const errors = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  });

  it('a null installReferrer (2.0.1) resolves null; an error resolves null', async () => {
    const reply = (info: { installReferrer: string | null } | null, error: unknown) => ({
      getInstallReferrerInfo: (cb: (i: typeof info, e: unknown) => void) => cb(info, error),
    });
    expect(await fromPlayInstallReferrer(reply({ installReferrer: null }, null))()).toBeNull();
    expect(await fromPlayInstallReferrer(reply({ installReferrer: 'strait_link=lnk_7' }, null))()).toBe('strait_link=lnk_7');
    expect(await fromPlayInstallReferrer(reply(null, { message: 'SERVICE_UNAVAILABLE', responseCode: 1 }))()).toBeNull();
  });
});
