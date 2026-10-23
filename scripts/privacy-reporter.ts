import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep, TestError } from '@playwright/test/reporter';
import fs from 'fs/promises';
import path from 'path';

export function redact(text: string, values = [process.env.NOON_EMAIL, process.env.NOON_EMAIL?.trim(), process.env.NOON_PASSWORD, process.env.NOON_PROFILE_RESTORE_NAME, process.env.NOON_TEST_PHONE]): string {
  const variants = values.filter((v): v is string => !!v).flatMap(value => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]);
  for (const value of [...new Set(variants)].sort((a, b) => b.length - a.length)) text = text.split(value).join('[private]');
  return text;
}
export function redactChunks(chunks: (string | Buffer)[], values?: (string | undefined)[]): string {
  return redact(Buffer.concat(chunks.map(chunk => typeof chunk === 'string' ? Buffer.from(chunk) : chunk)).toString('utf8'), values);
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

// This is the only reporter. Buffer stdout/stderr until the test ends so a secret
// split across chunks cannot reach a downstream console or HTML reporter.
export default class PrivacyReporter implements Reporter {
  private listOnly = process.argv.includes('--list');
  private results: unknown[] = [];
  private flows: { flow: number; title: string; status: string; reason: string; frames: never[] }[] = [];
  private globalErrors: string[] = [];
  private chunks = new Map<TestResult | undefined, { channel: string; value: string | Buffer }[]>();
  private textArtifacts = new Set<string>();
  printsToStdio() { return true; }
  onBegin(_config: FullConfig, suite: Suite) {
    if (this.listOnly) {
      for (const test of suite.allTests()) console.log(redact(test.titlePath().filter(Boolean).join(' > ')));
      console.log(`Total: ${suite.allTests().length} tests`);
    }
  }
  private collect(channel: string, chunk: string | Buffer, result?: TestResult) {
    const chunks = this.chunks.get(result) ?? [];
    chunks.push({ channel, value: chunk });
    this.chunks.set(result, chunks);
  }
  onStdOut(chunk: string | Buffer, _test?: TestCase, result?: TestResult) {
    this.collect('stdout', chunk, result);
    // These literal, value-free prompts must remain visible during manual auth.
    const prompt = chunk.toString().trim();
    if (['Complete any Google CAPTCHA manually. Recording is off; search wait is limited to five minutes.',
      'Complete any visible CAPTCHA/OTP manually in the browser. Recording is disabled.'].includes(prompt))
      console.log(redact(prompt));
  }
  onStdErr(chunk: string | Buffer, _test?: TestCase, result?: TestResult) { this.collect('stderr', chunk, result); }
  private scrub(step: TestStep) {
    if (step.category === 'pw:api' && /fill|pressSequentially|type\(/i.test(step.title)) step.title = 'Populate field (value withheld)';
    else step.title = redact(step.title);
    if (step.error) this.scrubError(step.error);
  }
  private scrubError(error: TestError) {
    if (error.message) error.message = redact(error.message);
    if (error.stack) error.stack = redact(error.stack);
    if (error.snippet) error.snippet = redact(error.snippet);
    if (error.value) error.value = redact(error.value);
  }
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    this.scrub(step);
    if (step.category === 'test.step' && /^(Flow [1-8]\b|Session -)/.test(step.title)) console.log(`START: ${step.title}`);
  }
  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    this.scrub(step);
    if (step.category === 'test.step' && /^(Flow [1-8]\b|Session -)/.test(step.title)) console.log(`${step.error ? 'FAILED' : 'DONE'}: ${step.title}`);
  }
  onError(error: TestError) {
    this.scrubError(error);
    this.globalErrors.push(error.message ?? error.value ?? 'Runner error');
    console.error(error.message ?? error.value ?? 'Runner error');
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments)
      if (attachment.path && /\.(md|txt|json|html)$/i.test(attachment.path)) this.textArtifacts.add(attachment.path);
    for (const error of result.errors) this.scrubError(error);
    const steps = (items: TestStep[]): unknown[] => items.map(step => {
      this.scrub(step);
      return { title: step.title, category: step.category, duration: step.duration,
        error: step.error?.message, steps: steps(step.steps) };
    });
    const record = {
      title: redact(test.titlePath().join(' > ')), status: result.status, duration: result.duration,
      annotations: test.annotations.map(a => ({ type: a.type, description: redact(a.description ?? '') })),
      errors: result.errors.map(e => redact(e.stack ?? e.message ?? e.value ?? 'Test error')),
      stdout: redactChunks((this.chunks.get(result) ?? []).filter(c => c.channel === 'stdout').map(c => c.value)),
      stderr: redactChunks((this.chunks.get(result) ?? []).filter(c => c.channel === 'stderr').map(c => c.value)),
      steps: steps(result.steps),
      attachments: result.attachments.map(a => ({ name: redact(a.name), path: a.path, contentType: a.contentType })),
    };
    this.chunks.delete(result);
    this.results.push(record);
    const visit = (items: TestStep[]) => {
      for (const step of items) {
        const flow = step.category === 'test.step' && step.title.match(/^Flow (\d+)\b/);
        if (flow) this.flows.push({ flow: Number(flow[1]), title: step.title,
          status: step.error ? 'failed' : 'passed', reason: step.error?.message ?? '', frames: [] });
        else visit(step.steps);
      }
    };
    if (result.status !== 'skipped') visit(result.steps);
    console.log(`${result.status.toUpperCase()}: ${record.title}`);
    for (const error of record.errors) console.error(error);
  }
  async onEnd(result: FullResult) {
    if (this.listOnly) return;
    // Playwright writes error-context.md before reporter callbacks; disabling
    // the page snapshot does not suppress its raw error text or source excerpt.
    for (const file of this.textArtifacts) {
      const text = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, redact(text));
    }
    const dir = path.resolve(process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || 'playwright-report');
    await fs.mkdir(dir, { recursive: true });
    const report = {
      runId: process.env.NOON_DEMO_RUN_ID, recordedAt: new Date().toISOString(), status: result.status,
      authenticationMode: process.env.NOON_REUSE_SESSION === '1' ? 'reused-session' : process.env.NOON_LOGIN_MODE === 'manual' || process.env.NOON_MANUAL_AUTH === '1' ? 'human-assisted' : process.env.NOON_LOGIN_MODE ?? 'automatic',
      kind: 'Sanitized execution report; no browser video', flows: this.flows,
      globalErrors: this.globalErrors, tests: this.results,
      output: redactChunks((this.chunks.get(undefined) ?? []).map(c => c.value)),
    };
    const json = JSON.stringify(report, null, 2);
    await fs.writeFile(path.join(dir, 'report.json'), json);
    await fs.writeFile(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Noon test report</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:20px}</style><h1>Noon test report: ${escapeHtml(result.status)}</h1><p>Sanitized execution data. No continuous browser recording.</p><pre>${escapeHtml(json)}</pre>`);
    if (process.env.NOON_DEMO_RUN_ID) {
      await fs.mkdir('private-artifacts/demo', { recursive: true });
      await fs.writeFile('private-artifacts/demo/manifest.json', json);
    }
    console.log(`Run ${result.status}. Report: ${path.join(dir, 'index.html')}`);
  }
}
